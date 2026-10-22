// Start/Stop Accumulation: стоянки — таблица + маркеры (короткие ≤5 мин меньше),
// справочник локаций (marker cols из reinit-ответа) — POI на карте и имена в таблице.

import { onPacket, sendRequest } from '../core/ws.js';
import { auth } from '../core/auth.js';
import { LOCATION_RADIUS_M } from '../core/config.js';
import { getParkingLayer, getMarkerLayer, getMap } from '../core/map-core.js';
import { populateTable, showToast, escapeHtml, haversineM } from '../core/utils.js';
import { state, emit, on } from './state.js';
import { registerTab } from './tabs.js';
import { mileageStopCoords } from './mileage.js';

let rawRows = [];
let rendered = false;
let markerDict = new Map(); // key -> {name, lat, lng, addr}

export function getMarkerDict() { return markerDict; }

export function initStops() {
  // Справочник локаций: reinit-ответ Startstop accumulation (cols поля marker)
  onPacket('Startstop accumulation', (data) => {
    if (data.act !== 'reinit') return false;
    const cols = data.res && data.res[0] && data.res[0].cols;
    if (!Array.isArray(cols)) return false;
    const applied = applyMarkerCols(cols);
    return applied; // поглощаем только если это действно справочник
  }, { priority: 10 });

  onPacket('Startstop accumulation', (data) => {
    // cols со справочником могут прийти и внутри других актов
    const cols = data.res && data.res[0] && data.res[0].cols;
    if (Array.isArray(cols)) applyMarkerCols(cols);
    const rows = data.res && data.res[0] && data.res[0].f;
    if (!Array.isArray(rows)) return false;
    rawRows = rows;
    processRows(rows);
    return false; // отчёты (reports) тоже слушают — не поглощаем
  }, { priority: 1 });

  registerTab({
    id: 'stops',
    title: 'Остановки',
    getRows: () => state.stops.slice(),
    render: renderStopsTable,
  });

  // Пересчёт видимых локаций при изменении маршрута (пробег/трек/очистка)
  on('mileage', rebuildLocationMarkers);
  on('track', rebuildLocationMarkers);
  on('cleared', rebuildLocationMarkers);
}

/** Запрос справочника локаций (act reinit, по пользователю). */
export function requestMarkerDict() {
  if (!auth.loggedIn) return;
  sendRequest({
    name: 'Startstop accumulation', type: 'etbl', mid: 5, act: 'reinit',
    filter: [{ selecteduid: [auth.uid] }],
    lang: 'en',
  });
}

function applyMarkerCols(cols) {
  const markerCol = cols.find((c) => c && c.f === 'marker' && Array.isArray(c.k) && c.k.length);
  if (!markerCol) return false;
  state.markerLocations = markerCol.k
    .filter((e) => e && e.key !== undefined && isFinite(Number(e.latitude)) && isFinite(Number(e.longitude)))
    .map((e) => ({
      key: e.key,
      name: e.val != null ? String(e.val) : String(e.key),
      lat: Number(e.latitude),
      lng: Number(e.longitude),
      addr: e.addr ? String(e.addr) : '',
      icon: e.icon ? String(e.icon) : '',
      opacity: e.opacity != null ? Number(e.opacity) : null,
    }));
  markerDict = new Map(state.markerLocations.map((l) => [l.key, l]));
  rebuildLocationMarkers();
  if (rendered) renderStopsTable(); // подмена имён локаций в уже показанной таблице
  refreshStopMarkers();             // попапы стоянок — с именами локаций
  emit('marker-dict');
  return true;
}

// Координаты текущего маршрута (пробег + трек) — для фильтра локаций
function collectRouteCoords() {
  const coords = [];
  (state.mileageSegments || []).forEach((s) => {
    if (Array.isArray(s.coordinates)) {
      s.coordinates.forEach((c) => { if (Array.isArray(c) && isFinite(c[0]) && isFinite(c[1])) coords.push(c); });
    }
  });
  (state.trackPoints || []).forEach((p) => coords.push([p.lat, p.lng]));
  return coords;
}

// Локация «на маршруте», если маршрут проходит в пределах LOCATION_RADIUS_M
// от её точки (быстрая предпроверка по bbox, затем haversine)
function isLocationOnRoute(loc, coords) {
  if (!coords.length) return false;
  const dLat = LOCATION_RADIUS_M / 111320;
  const cosLat = Math.cos((loc.lat * Math.PI) / 180);
  const dLng = dLat / Math.max(0.01, Math.abs(cosLat));
  const minLat = loc.lat - dLat; const maxLat = loc.lat + dLat;
  const minLng = loc.lng - dLng; const maxLng = loc.lng + dLng;
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i];
    if (c[0] < minLat || c[0] > maxLat || c[1] < minLng || c[1] > maxLng) continue;
    if (haversineM(loc.lat, loc.lng, c[0], c[1]) <= LOCATION_RADIUS_M) return true;
  }
  return false;
}

// POI-локации на карте: только те, что входят в маршрут выбранного ТС за период
function rebuildLocationMarkers() {
  const group = getMarkerLayer();
  if (!group) return;
  group.clearLayers();
  if (!state.markerLocations.length) return;
  const coords = collectRouteCoords();
  if (!coords.length) return; // маршрут не загружен — локации не показываем
  state.markerLocations.forEach((loc) => {
    if (!isLocationOnRoute(loc, coords)) return;
    const icon = L.divIcon({
      className: '',
      html: '<div class="location-dot"></div>',
      iconSize: [11, 11],
      iconAnchor: [5.5, 5.5],
    });
    const m = L.marker([loc.lat, loc.lng], { icon }).addTo(group);
    m.bindTooltip(escapeHtml(loc.name), {
      permanent: true, direction: 'top', offset: [0, -6], className: 'location-label',
    });
    m.bindPopup(
      `<div class="popup-title">${escapeHtml(loc.name)}</div>` +
      (loc.addr ? escapeHtml(loc.addr) + '<br>' : '') +
      `Координаты: ${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`
    );
  });
}

// Полный сброс стоянок (смена дат/устройства): маркеры + таблица
export function resetStopsState() {
  rawRows = [];
  state.stops = [];
  refreshStopMarkers();
  if (rendered) renderStopsTable();
}

export function requestStartstop() {
  const fromEl = document.getElementById('startDate');
  const toEl = document.getElementById('endDate');
  const build = (raw, isEnd) => {
    if (!raw) return '';
    if (raw.length === 16) raw += isEnd ? ':59' : ':00';
    return raw;
  };
  sendRequest({
    name: 'Startstop accumulation', type: 'etbl', mid: 5, act: 'filter',
    filter: [
      { selectedpgdatefrom: [build(fromEl ? fromEl.value : '', false)] },
      { selectedvihicleid: [state.deviceId] },
      { selectedpgdateto: [build(toEl ? toEl.value : '', true)] },
    ],
    lang: 'en',
  });
}

function processRows(rows) {
  const result = [];
  let cumulative = 0;
  let lastStopCumulative = 0;
  rows.forEach((item) => {
    const destValue = parseFloat(String(item.dest || '').replace(',', '.'));
    if (!isNaN(destValue)) cumulative += destValue;
    if (item.rcls === 'asstopped') {
      const segmentDest = cumulative - lastStopCumulative;
      result.push({
        '#': result.length + 1,
        fdate: item.fdate || '',
        period: item.period || '',
        segment_dest: segmentDest.toFixed(2),
        dest: cumulative.toFixed(2),
        marker: item.marker != null ? item.marker : '',
      });
      lastStopCumulative = cumulative;
    }
  });
  state.stops = result;
  if (result.length) state.lastOkDest = result[result.length - 1].dest;
  emit('stops');
  if (rendered) renderStopsTable();
  refreshStopMarkers();
}

export function renderStopsTable() {
  rendered = true;
  const thead = document.getElementById('stopsThead');
  const tbody = document.getElementById('stopsTbody');
  if (!thead || !tbody) return;
  populateTable(tbody, thead, state.stops, {
    headers: ['#', 'fdate', 'period', 'segment_dest', 'dest', 'marker'],
    emptyMessage: 'Нет стоянок.',
    renderCell: (key, value) => {
      if (key === 'marker') {
        const loc = markerDict.get(Number(value));
        if (loc) return `<span class="text-purple-300" title="${escapeHtml(loc.addr || loc.name)}">${escapeHtml(loc.name)}</span>`;
        return value ? String(value) : '';
      }
      return null; // дефолтный рендер
    },
    onRowClick: (row) => {
      if (row.markerRef) {
        const ll = row.markerRef.getLatLng();
        const map = getMap();
        map.setView(ll, Math.max(map.getZoom(), 15));
        setTimeout(() => row.markerRef.openPopup(), 50);
        pulseMarker(row.markerRef);
      } else {
        showToast('Маркер стоянки не найден (нет координат в пробеге)');
      }
    },
  });
}

function pulseMarker(marker) {
  const el = marker.getElement();
  if (!el) return;
  const div = el.querySelector('.stop-marker');
  if (div) {
    div.classList.add('pulsed');
    setTimeout(() => div.classList.remove('pulsed'), 2500);
  }
}

export function refreshStopMarkers() {
  const group = getParkingLayer();
  if (!group) return;
  group.clearLayers();
  if (!state.stops.length) return;

  state.stops.forEach((stop) => {
    const meta = mileageStopCoords[(stop.fdate || '').slice(0, 19)];
    if (!meta || !Array.isArray(meta.coord)) return;
    const period = stop.period || meta.period || '';
    let isShort = false;
    const pm = /^\d{1,2}:\d{2}:\d{2}$/.exec(period);
    if (pm) {
      const parts = period.split(':').map((n) => parseInt(n, 10));
      isShort = (parts[0] * 60 + parts[1] + parts[2] / 60) <= 5;
    }
    const icon = L.divIcon({
      className: '',
      html: `<div class="stop-marker ${isShort ? 'stop-marker-short' : 'stop-marker-long'}">${stop['#']}</div>`,
      iconSize: isShort ? [20, 20] : [24, 24],
      iconAnchor: isShort ? [10, 10] : [12, 12],
    });
    const loc = markerDict.get(Number(stop.marker));
    const popupHtml =
      `<b>${isShort ? 'Короткая стоянка' : 'Стоянка'} №${stop['#']}</b><br>` +
      (loc ? `<span style="color:#c4b5fd">Локация: ${escapeHtml(loc.name)}</span><br>` : '') +
      `Начало: ${stop.fdate}<br>Длительность: ${period || '-'}<br>` +
      `Сегмент: ${stop.segment_dest || '-'} км<br>Кумулятив: ${stop.dest || '-'} км`;
    const marker = L.marker(meta.coord, { icon }).addTo(group).bindPopup(popupHtml);
    stop.markerRef = marker;
  });
}

export function getStopByIndex(i) {
  return state.stops[i];
}
