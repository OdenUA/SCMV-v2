// Ручной маршрут (точки на карте → OSRM → ссылка Google Maps), линейка + track-cut.

import { getMap, getRouteLayer, setRouteHandlers, setRulerHandlers, setContextHandlers, updateRouteButton, updateRouteResetEnabled, updateRulerButton, setRouteRoadPolyline, currentLineWidth } from '../core/map-core.js';
import { parseTrackDate, formatDateSql, splitRangeByDays, buildRecalcStatements, openSqlModal, showToast, copyToClipboard } from '../core/utils.js';
import { state, on } from './state.js';

const MAX_POINTS = 25;

let routeModeActive = false;
let points = [];       // {lat,lng,marker}
let roadPolyline = null;
let builtUrl = null;
let clickHandler = null;
let popupGuard = null;

let rulerModeActive = false;
let rulerPoints = [];
let rulerPolyline = null;
let rulerTooltip = null;
let rulerClickHandler = null;
let rulerPopupGuard = null;
let rulerEscapeHandler = null;

// track-cut состояние
let cutFirst = null;
let cutFirstBtn = null;

export function initRoute() {
  setRouteHandlers({ onToggle: toggleRouteMode, onReset: resetManualRoute });
  setRulerHandlers({ onToggle: toggleRulerMode });
  setContextHandlers({
    copyCoords: (text) => copyToClipboard(text).then((ok) => showToast(ok ? 'Координаты скопированы' : 'Ошибка копирования')),
    routeStart: (latlng) => { if (!routeModeActive) startRouteMode(); addRoutePoint(latlng); },
    routeAdd: (latlng) => { if (!routeModeActive) startRouteMode(); addRoutePoint(latlng); },
    routeFinish: () => { if (routeModeActive && points.length >= 2) buildGoogleMapsRouteManual(); },
  });
  on('cleared', () => {
    if (rulerModeActive || rulerPoints.length) stopRulerMode();
  });
}

// ---------- Режим маршрута ----------
function toggleRouteMode() {
  if (routeModeActive) {
    if (points.length >= 2) {
      buildGoogleMapsRouteManual();
    } else {
      stopRouteMode();
    }
  } else {
    startRouteMode();
  }
}

export function startRouteMode() {
  if (routeModeActive) return;
  if (rulerModeActive) stopRulerMode();
  routeModeActive = true;
  window.__routeModeActive = true;
  document.body.classList.add('route-mode-active');
  updateRouteButton(true);
  showToast(`Режим маршрута: кликайте по карте (до ${MAX_POINTS} точек)`);

  const map = getMap();
  clickHandler = (e) => {
    if (e.originalEvent && e.originalEvent.target &&
        e.originalEvent.target.closest && e.originalEvent.target.closest('.leaflet-control')) return;
    addRoutePoint(e.latlng);
  };
  map.on('click', clickHandler);

  // глушим попапы в режиме маршрута
  popupGuard = (e) => {
    if (routeModeActive && e.popup && e.popup._source && e.popup._source.getLatLng) {
      // разрешаем попапы ручных точек маршрута
      if (!points.some((p) => p.marker === e.popup._source)) {
        map.closePopup();
      }
    }
  };
  map.on('popupopen', popupGuard);
}

export function stopRouteMode() {
  routeModeActive = false;
  window.__routeModeActive = false;
  document.body.classList.remove('route-mode-active');
  updateRouteButton(false);
  const map = getMap();
  if (clickHandler) { map.off('click', clickHandler); clickHandler = null; }
  if (popupGuard) { map.off('popupopen', popupGuard); popupGuard = null; }
}

export function resetManualRoute() {
  const layer = getRouteLayer();
  points.forEach((p) => { try { layer.removeLayer(p.marker); } catch (e) {} });
  points = [];
  if (roadPolyline) { try { layer.removeLayer(roadPolyline); } catch (e) {} roadPolyline = null; setRouteRoadPolyline(null); }
  builtUrl = null;
  updateRouteResetEnabled(false);
  renderManualRouteInfo();
  if (!routeModeActive) showToast('Маршрут сброшен');
}

function addRoutePoint(latlng) {
  if (points.length >= MAX_POINTS) {
    showToast(`Максимум ${MAX_POINTS} точек — строим маршрут`);
    buildGoogleMapsRouteManual();
    return;
  }
  const n = points.length + 1;
  const marker = L.marker([latlng.lat, latlng.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div style="width:22px;height:22px;border-radius:50%;background:#2563eb;border:2px solid #fff;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.5)">${n}</div>`,
      iconSize: [22, 22], iconAnchor: [11, 11],
    }),
  }).addTo(getRouteLayer());
  points.push({ lat: latlng.lat, lng: latlng.lng, marker });
  updateRouteResetEnabled(true);

  if (points.length >= MAX_POINTS) {
    buildGoogleMapsRouteManual();
  }
}

// ---------- Построение ----------
async function buildRoadRoute() {
  if (points.length < 2) return 0;
  let totalKm = 0;
  const all = [];
  const layer = getRouteLayer();

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    try {
      const resp = await fetch(url);
      const json = await resp.json();
      if (json.code === 'Ok' && json.routes && json.routes[0]) {
        totalKm += json.routes[0].distance / 1000;
        json.routes[0].geometry.coordinates.forEach((c) => all.push([c[1], c[0]]));
      } else {
        all.push([a.lat, a.lng], [b.lat, b.lng]);
      }
    } catch (e) {
      console.warn('OSRM failed', e);
      all.push([a.lat, a.lng], [b.lat, b.lng]);
    }
  }

  if (roadPolyline) { try { layer.removeLayer(roadPolyline); } catch (e) {} }
  if (all.length) {
    roadPolyline = L.polyline(all, { color: '#0d6efd', weight: currentLineWidth() + 1, opacity: 0.9 }).addTo(layer);
    setRouteRoadPolyline(roadPolyline);
    const b = roadPolyline.getBounds();
    if (b.isValid()) getMap().fitBounds(b, { padding: [50, 50] });
  }
  return totalKm;
}

export async function buildGoogleMapsRouteManual() {
  if (points.length < 2) { showToast('Нужно минимум 2 точки'); return; }
  showToast('Построение маршрута по дорогам...');
  const km = await buildRoadRoute();
  const coords = points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('/');
  builtUrl = `https://www.google.com/maps/dir/${coords}/`;
  renderManualRouteInfo(km);
  stopRouteMode();
}

function renderManualRouteInfo(km) {
  const el = document.getElementById('manualRouteInfo');
  if (!el) return;
  if (!points.length) { el.classList.remove('open'); el.innerHTML = ''; return; }
  el.classList.add('open');
  el.innerHTML =
    `<b>Точек маршрута:</b> ${points.length}` +
    (km != null ? `<br><b>Дистанция по дорогам:</b> ${km.toFixed(2)} км` : '') +
    (builtUrl ? `<br><a href="${builtUrl}" target="_blank" rel="noopener">Открыть в Google Maps</a>` : '');
}

// ---------- Линейка ----------
function toggleRulerMode() {
  if (rulerModeActive) stopRulerMode();
  else startRulerMode();
}

function startRulerMode() {
  if (rulerModeActive) return;
  if (routeModeActive) stopRouteMode();
  rulerModeActive = true;
  window.__rulerModeActive = true;
  document.body.classList.add('ruler-mode-active');
  updateRulerButton(true);
  showToast('Линейка: кликайте по карте. Esc или повторный клик по иконке — очистить');

  const map = getMap();
  rulerClickHandler = (e) => {
    if (e.originalEvent && e.originalEvent.target &&
        e.originalEvent.target.closest && e.originalEvent.target.closest('.leaflet-control')) return;
    addRulerPoint(e.latlng);
  };
  map.on('click', rulerClickHandler);

  rulerPopupGuard = () => { if (rulerModeActive) map.closePopup(); };
  map.on('popupopen', rulerPopupGuard);
  rulerEscapeHandler = (e) => {
    if (e.key !== 'Escape' || document.querySelector('.modal-overlay.open')) return;
    stopRulerMode();
  };
  document.addEventListener('keydown', rulerEscapeHandler);
}

function stopRulerMode() {
  rulerModeActive = false;
  window.__rulerModeActive = false;
  document.body.classList.remove('ruler-mode-active');
  updateRulerButton(false);
  const map = getMap();
  if (map && rulerClickHandler) map.off('click', rulerClickHandler);
  if (map && rulerPopupGuard) map.off('popupopen', rulerPopupGuard);
  if (rulerEscapeHandler) document.removeEventListener('keydown', rulerEscapeHandler);
  rulerClickHandler = null;
  rulerPopupGuard = null;
  rulerEscapeHandler = null;
  clearRulerDrawing();
}

function clearRulerDrawing() {
  const layer = getRouteLayer();
  if (rulerTooltip && rulerTooltip._source) rulerTooltip._source.unbindTooltip();
  if (layer) {
    rulerPoints.forEach((p) => { try { layer.removeLayer(p.marker); } catch (e) {} });
    if (rulerPolyline) { try { layer.removeLayer(rulerPolyline); } catch (e) {} }
  }
  rulerPoints = [];
  rulerPolyline = null;
  rulerTooltip = null;
}

function addRulerPoint(latlng) {
  const n = rulerPoints.length + 1;
  const marker = L.marker([latlng.lat, latlng.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div class="ruler-point-marker">${n}</div>`,
      iconSize: [20, 20], iconAnchor: [10, 10],
    }),
  }).addTo(getRouteLayer());
  rulerPoints.push({ lat: latlng.lat, lng: latlng.lng, marker });
  if (rulerPoints.length >= 2) updateRulerDrawing();
}

function updateRulerDrawing() {
  const layer = getRouteLayer();
  if (rulerPolyline) layer.removeLayer(rulerPolyline);
  if (rulerTooltip && rulerTooltip._source) rulerTooltip._source.unbindTooltip();
  const latlngs = rulerPoints.map((p) => [p.lat, p.lng]);
  rulerPolyline = L.polyline(latlngs, {
    color: '#f59e0b', weight: 3, opacity: 0.95, dashArray: '8 6',
  }).addTo(layer);

  let totalM = 0;
  for (let i = 1; i < latlngs.length; i++) totalM += getMap().distance(latlngs[i - 1], latlngs[i]);
  const totalText = totalM < 1000 ? `${Math.round(totalM)} м` : `${(totalM / 1000).toFixed(2)} км`;
  const lastMarker = rulerPoints[rulerPoints.length - 1].marker;
  lastMarker.bindTooltip(`<b>Линейка:</b> ${totalText}`, {
    permanent: true, direction: 'top', offset: [0, -12], className: 'ruler-total-tooltip',
  }).openTooltip();
  rulerTooltip = lastMarker.getTooltip();
}

// ---------- Track-cut ----------
export function createTrackCutButton(lat, lng, wdate) {
  const btn = document.createElement('button');
  btn.className = 'btn btn-danger btn-xs';
  btn.innerHTML = '<i class="fa-solid fa-scissors"></i> Вырезать';
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    handleTrackCutSelection(lat, lng, wdate, btn);
  });
  return btn;
}

function handleTrackCutSelection(lat, lng, wdate, btn) {
  if (!cutFirst) {
    cutFirst = { lat, lng, wdate };
    cutFirstBtn = btn;
    btn.classList.add('!bg-amber-500');
    showToast(`Точка 1 (${wdate}). Выберите вторую точку диапазона.`);
    return;
  }
  if (cutFirstBtn) cutFirstBtn.classList.remove('!bg-amber-500');
  const second = { lat, lng, wdate };
  const first = cutFirst;
  cutFirst = null;
  cutFirstBtn = null;
  showTrackCutSql(first, second);
}

function showTrackCutSql(a, b) {
  const start = parseTrackDate(a.wdate);
  const end = parseTrackDate(b.wdate);
  if (!start || !end) { showToast('Не удалось распознать время точек'); return; }
  if (end < start) { const t = start; start = end; end = t; }
  start.setSeconds(start.getSeconds() - 1);
  end.setSeconds(end.getSeconds() + 1);

  const lines = [`-- Вырезание диапазона трека (${a.wdate} — ${b.wdate})`];
  splitRangeByDays(start, end).forEach((p) => {
    lines.push(
      `DELETE FROM snsrmain WHERE deviceid='${state.deviceId}' AND wdate >= '${formatDateSql(p.from)}' AND wdate <= '${formatDateSql(p.to)}';`
    );
  });
  lines.push(...buildRecalcStatements(state.deviceId, splitRangeByDays(start, end).map((p) => p.dateStr)));
  openSqlModal(lines.join('\n'));
}
