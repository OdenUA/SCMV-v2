// Карта: инициализация Leaflet, подложки, слои, «умные стрелки», контролы, контекст-меню.
// Упрощённый перенос map.js v2 (без MapLibre).

import { debounce } from './utils.js';

let map = null;
let currentTile = null;
let tileKey = 'dark';

export const trackLayerGroup = { ref: null };
export const parkingLayerGroup = { ref: null };
export const routeLayerGroup = { ref: null };
export const anomalyLayerGroup = { ref: null };
export const markerLayerGroup = { ref: null }; // справочник локаций (POI)
export const fuelLayerGroup = { ref: null };   // события топлива (заправки/сливы)
let directionGroup = null;

const MAP_TILES = {
  osm: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};

export const directions = { visible: true };

export function getMap() { return map; }
export function getTrackLayer() { return trackLayerGroup.ref; }
export function getParkingLayer() { return parkingLayerGroup.ref; }
export function getRouteLayer() { return routeLayerGroup.ref; }
export function getAnomalyLayer() { return anomalyLayerGroup.ref; }
export function getMarkerLayer() { return markerLayerGroup.ref; }
export function getFuelLayer() { return fuelLayerGroup.ref; }

export function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: false }).setView([49.33, 28.35], 7);
  L.control.zoom({ position: 'topright' }).addTo(map);

  currentTile = L.tileLayer(MAP_TILES.osm, { maxZoom: 19 }).addTo(map);
  tileKey = 'osm';

  trackLayerGroup.ref = L.layerGroup().addTo(map);
  parkingLayerGroup.ref = L.layerGroup().addTo(map);
  routeLayerGroup.ref = L.layerGroup().addTo(map);
  anomalyLayerGroup.ref = L.layerGroup().addTo(map);
  markerLayerGroup.ref = L.layerGroup().addTo(map);
  fuelLayerGroup.ref = L.layerGroup().addTo(map);
  directionGroup = L.layerGroup().addTo(map);

  addVisibilityControl();
  addRouteControl();
  addDisplayPanelControl();
  addFullscreenControl();
  initContextMenu();

  map.on('zoomend', debounce(rebuildDirections, 150));
  map.on('moveend', debounce(rebuildDirections, 120));
  map.on('overlayadd overlayremove', debounce(rebuildDirections, 100));
  return map;
}

export function setTileProvider(key) {
  if (!MAP_TILES[key] || key === tileKey || !map) return;
  map.removeLayer(currentTile);
  currentTile = L.tileLayer(MAP_TILES[key], { maxZoom: 19 }).addTo(map);
  tileKey = key;
  currentTile.bringToBack();
}

// ---------- Маркеры (общие) ----------
export function makeStartIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="start-marker"><i class="fa-solid fa-play" style="font-size:8px"></i></div>',
    iconSize: [22, 22], iconAnchor: [11, 11],
  });
}
export function makeFinishIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="finish-marker"><i class="fa-solid fa-flag-checkered" style="font-size:8px"></i></div>',
    iconSize: [22, 22], iconAnchor: [11, 11],
  });
}

// ---------- Толщина линий ----------
export function currentLineWidth() {
  const el = document.getElementById('lineWidthSlider');
  const v = el ? parseInt(el.value, 10) : 2;
  return isFinite(v) ? v : 2;
}

export function updateAllLineWidths() {
  if (!map) return;
  const base = currentLineWidth();
  const apply = (layer) => {
    if (!layer || !layer.setStyle) return;
    if (layer._trackRawArrows) return; // невидимые носители стрелок
    let w = base;
    if (layer._isAnalysisAnomaly) w = base * 3 + 2;
    else if (layer._isAnalysisPolyline) w = base * 3;
    else if (layer === routeRoadPolyline) w = base + 1;
    if (layer._selectedTrack) w = base + 3;
    layer.setStyle({ weight: w });
  };
  trackLayerGroup.ref && trackLayerGroup.ref.eachLayer(apply);
  routeLayerGroup.ref && routeLayerGroup.ref.eachLayer(apply);
  rebuildDirections();
}

let routeRoadPolyline = null;
export function setRouteRoadPolyline(layer) { routeRoadPolyline = layer; }

// ---------- Умные стрелки направления (порт логики v2) ----------
// Интервал задан в метрах через масштаб зума; стрелки только на значимых
// сегментах (>=10 м) и линиях (>=300 м); бюджет 3000 стрелок с квотами
// пропорционально длине; при >100 стрелок на линию — только видимая область.
const DIR = {
  MIN_SEG_M: 10,
  SPACING_PX: 55,
  MIN_SPACING_M: 25,
  MAX_PER_LINE: 1200,
  MIN_LINE_M: 300,
  TOTAL_BUDGET: 3000,
  VIEWPORT_MIN: 100,
  VIEWPORT_PAD_PX: 80,
};

const smartArrowRegistry = []; // {owner, layer, color}

function metersPerPixel() {
  try {
    const lat = map.getCenter().lat;
    return 156543.03392 * Math.cos((lat * Math.PI) / 180) / Math.pow(2, map.getZoom());
  } catch (e) { return 1; }
}

function arrowBaseSize() {
  return Math.max(3, Math.round(currentLineWidth() * 3));
}

function flattenLatLngs(input, out) {
  if (!input) return;
  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (Array.isArray(item)) flattenLatLngs(item, out);
    else if (item && typeof item.lat === 'number') out.push(item);
  }
}

function polylineLengthM(latlngs) {
  if (latlngs.length < 2) return -1;
  let total = 0;
  for (let i = 1; i < latlngs.length; i++) total += latlngs[i - 1].distanceTo(latlngs[i]);
  return total > 0 && isFinite(total) ? total : -1;
}

export function registerSmartArrows(owner, layer, color) {
  try {
    smartArrowRegistry.push({ owner, layer, color: color || '#111111' });
    rebuildDirections();
  } catch (e) { console.warn('registerSmartArrows failed', e); }
  return null;
}

export function unregisterSmartArrows(owner, layer) {
  for (let i = smartArrowRegistry.length - 1; i >= 0; i--) {
    const e = smartArrowRegistry[i];
    if (owner && e.owner !== owner) continue;
    if (layer && e.layer !== layer) continue;
    smartArrowRegistry.splice(i, 1);
  }
  rebuildDirections();
}

// Декоратор со стрелками: позиции считаются в метрах вдоль пути (шумовые
// сегменты пропускаются), offset'ы пересчитываются в пиксели текущего зума.
function createSmartArrowDecorator(layer, color, maxArrows) {
  try {
    const latlngs = [];
    flattenLatLngs(layer.getLatLngs(), latlngs);
    if (latlngs.length < 2) return null;
    const mpp = metersPerPixel();
    if (!(mpp > 0) || !isFinite(mpp)) return null;
    let spacingM = Math.max(DIR.SPACING_PX * mpp, DIR.MIN_SPACING_M);
    const cum = new Array(latlngs.length);
    cum[0] = 0;
    for (let i = 1; i < latlngs.length; i++) cum[i] = cum[i - 1] + latlngs[i - 1].distanceTo(latlngs[i]);
    const totalM = cum[latlngs.length - 1];
    if (!(totalM > 0) || !isFinite(totalM)) return null;
    if (totalM < DIR.MIN_LINE_M) return null; // короткие линии не помечаем
    if (totalM / spacingM > maxArrows) spacingM = totalM / maxArrows;

    let viewBounds = null;
    if (Math.floor(totalM / spacingM) > DIR.VIEWPORT_MIN) {
      const size = map.getSize();
      const padF = DIR.VIEWPORT_PAD_PX / Math.max(200, Math.min(size.x, size.y));
      viewBounds = map.getBounds().pad(padF);
    }

    const positionsM = [];
    let nextM = spacingM * 0.5;
    for (let j = 1; j < latlngs.length && nextM <= totalM; j++) {
      const segStartM = cum[j - 1];
      const segEndM = cum[j];
      const segLenM = segEndM - segStartM;
      if (segLenM < DIR.MIN_SEG_M) continue; // GPS-шум
      if (nextM < segStartM) nextM = segStartM;
      while (nextM <= segEndM) {
        let inView = true;
        if (viewBounds) {
          const t = (nextM - segStartM) / segLenM;
          const la = latlngs[j - 1];
          const lb = latlngs[j];
          inView = viewBounds.contains([la.lat + (lb.lat - la.lat) * t, la.lng + (lb.lng - la.lng) * t]);
        }
        if (inView) positionsM.push(nextM);
        nextM += spacingM;
      }
    }
    // Интервал больше длины линии — одна стрелка посередине значимого сегмента
    if (!positionsM.length && !viewBounds) {
      const midM = totalM * 0.5;
      for (let m = 1; m < latlngs.length; m++) {
        if (cum[m] >= midM) {
          if (cum[m] - cum[m - 1] >= DIR.MIN_SEG_M) positionsM.push(midM);
          break;
        }
      }
    }
    if (!positionsM.length) return null;

    const arrowSize = arrowBaseSize();
    const patterns = positionsM.map((pos) => ({
      offset: Math.max(1, Math.round(pos / mpp)),
      symbol: L.Symbol.arrowHead({ pixelSize: arrowSize, pathOptions: { fillOpacity: 1, weight: 0, color } }),
    }));
    const deco = L.polylineDecorator(layer, { patterns });
    deco.redraw = () => {}; // пересборку делаем сами (zoom/move), иначе плагин экстраполирует
    return deco;
  } catch (e) {
    console.warn('createSmartArrowDecorator failed', e);
    return null;
  }
}

export function rebuildDirections() {
  if (!map || !directionGroup) return;
  directionGroup.clearLayers();
  if (!directions.visible) return;

  // Кандидаты: зарегистрированные живые слои + невидимые carrier-полилинии raw-трека
  const seen = new Set();
  const candidates = [];
  const pushCandidate = (layer, color) => {
    if (seen.has(layer)) return;
    if (layer._ownDirectionArrows === false) return;
    if (trackLayerGroup.ref && !trackLayerGroup.ref.hasLayer(layer)) return;
    const latlngs = [];
    flattenLatLngs(layer.getLatLngs ? layer.getLatLngs() : null, latlngs);
    const totalM = polylineLengthM(latlngs);
    if (totalM < DIR.MIN_LINE_M) return;
    seen.add(layer);
    candidates.push({ layer, color, totalM });
  };
  for (const entry of smartArrowRegistry) pushCandidate(entry.layer, entry.color);
  if (trackLayerGroup.ref) {
    trackLayerGroup.ref.eachLayer((l) => {
      if (l._trackRawArrows) pushCandidate(l, l._arrowColor || '#111111');
    });
  }
  if (!candidates.length) return;

  // Квоты пропорционально длине в пределах общего бюджета
  const spacingM = Math.max(DIR.SPACING_PX * metersPerPixel(), DIR.MIN_SPACING_M);
  const natural = candidates.map((c) => Math.min(Math.floor(c.totalM / spacingM), DIR.MAX_PER_LINE));
  const totalNatural = natural.reduce((a, b) => a + b, 0);
  let quotas;
  if (totalNatural <= DIR.TOTAL_BUDGET) {
    quotas = natural.map((n) => Math.max(n, 1));
  } else {
    const scale = DIR.TOTAL_BUDGET / totalNatural;
    quotas = natural.map((n) => Math.max(1, Math.floor(n * scale)));
  }

  candidates.forEach((c, i) => {
    const deco = createSmartArrowDecorator(c.layer, c.color, Math.min(DIR.MAX_PER_LINE, quotas[i]));
    if (deco) directionGroup.addLayer(deco);
  });
}

// ---------- Кастомные контролы ----------
function addVisibilityControl() {
  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-control-custom-group');
      const mkBtn = (icon, title, active, onClick) => {
        const b = L.DomUtil.create('button', 'map-icon-btn' + (active ? ' active' : ''), container);
        b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
        b.title = title;
        L.DomEvent.disableClickPropagation(b);
        b.addEventListener('click', (ev) => {
          ev.preventDefault();
          onClick(b);
        });
        return b;
      };
      const trackBtn = mkBtn('fa-route', 'Показать/скрыть треки', true, (b) => {
        toggleLayerOnMap(trackLayerGroup.ref, b);
      });
      const parkingBtn = mkBtn('fa-square-parking', 'Показать/скрыть стоянки', true, (b) => {
        toggleLayerOnMap(parkingLayerGroup.ref, b);
      });
      const dirBtn = mkBtn('fa-location-arrow', 'Показать/скрыть направления', true, (b) => {
        directions.visible = !directions.visible;
        b.classList.toggle('active', directions.visible);
        rebuildDirections();
      });
      map.on('overlayadd', (e) => {
        if (e.layer === trackLayerGroup.ref) trackBtn.classList.add('active');
        if (e.layer === parkingLayerGroup.ref) parkingBtn.classList.add('active');
      });
      map.on('overlayremove', (e) => {
        if (e.layer === trackLayerGroup.ref) trackBtn.classList.remove('active');
        if (e.layer === parkingLayerGroup.ref) parkingBtn.classList.remove('active');
      });
      return container;
    },
  });
  map.addControl(new Control());
}

function toggleLayerOnMap(layerGroup, btn) {
  if (!map.hasLayer(layerGroup)) {
    layerGroup.addTo(map);
    btn.classList.add('active');
  } else {
    map.removeLayer(layerGroup);
    btn.classList.remove('active');
  }
}

// Контрол ручного маршрута
let routeHandlers = { onToggle: null, onReset: null };
let routeToggleBtn = null;
let routeResetBtn = null;

export function setRouteHandlers(handlers) {
  routeHandlers = handlers || {};
}
export function updateRouteButton(active) {
  if (routeToggleBtn) routeToggleBtn.classList.toggle('active', !!active);
}
export function updateRouteResetEnabled(enabled) {
  if (routeResetBtn) routeResetBtn.disabled = !enabled;
}

function addRouteControl() {
  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-control-custom-group');
      routeToggleBtn = L.DomUtil.create('button', 'map-icon-btn', container);
      routeToggleBtn.innerHTML = '<i class="fa-solid fa-location-dot"></i>';
      routeToggleBtn.title = 'Режим ручного маршрута';
      L.DomEvent.disableClickPropagation(routeToggleBtn);
      routeToggleBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (routeHandlers.onToggle) routeHandlers.onToggle();
      });
      routeResetBtn = L.DomUtil.create('button', 'map-icon-btn', container);
      routeResetBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i>';
      routeResetBtn.title = 'Сбросить маршрут';
      routeResetBtn.disabled = true;
      L.DomEvent.disableClickPropagation(routeResetBtn);
      routeResetBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (routeHandlers.onReset) routeHandlers.onReset();
      });
      return container;
    },
  });
  map.addControl(new Control());
}

// Контрол «Отображение на карте»: кнопка на карте + плавающая панель
let displayPanel = null;
let displayBtn = null;

function addDisplayPanelControl() {
  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const wrap = L.DomUtil.create('div', 'leaflet-control-custom-group');
      displayBtn = L.DomUtil.create('button', 'map-icon-btn', wrap);
      displayBtn.innerHTML = '<i class="fa-solid fa-layer-group"></i>';
      displayBtn.title = 'Отображение на карте (подложка, толщина линий)';
      L.DomEvent.disableClickPropagation(displayBtn);
      displayBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        toggleDisplayPanel();
      });
      return wrap;
    },
  });
  map.addControl(new Control());

  displayPanel = L.DomUtil.create('div', '', map.getContainer());
  displayPanel.id = 'mapDisplayPanel';
  displayPanel.className = 'glass-panel rounded-xl p-3 space-y-2.5 text-xs text-gray-300';
  displayPanel.style.cssText = 'position:absolute;top:10px;left:96px;z-index:1200;width:235px;display:none;';
  displayPanel.innerHTML = `
    <div class="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Отображение на карте</div>
    <div>
      <span class="text-[11px] text-gray-400 block mb-1">Подложка карты:</span>
      <select id="mapTileSelect" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2 py-1.5 text-gray-200 focus:outline-none focus:border-brand-500">
        <option value="osm">OpenStreetMap (Схема)</option>
        <option value="satellite">Esri World Imagery (Спутник)</option>
      </select>
    </div>
    <div class="flex items-center space-x-2 pt-1">
      <span class="whitespace-nowrap text-[11px]">Толщина линий</span>
      <input type="range" id="lineWidthSlider" min="1" max="10" value="2" class="flex-1 accent-brand-500" />
      <span id="lineWidthValue" class="w-4 text-center font-mono">2</span>
    </div>`;
  L.DomEvent.disableClickPropagation(displayPanel);
  L.DomEvent.disableScrollPropagation(displayPanel);

  // закрытие по клику на карту
  map.on('click', () => {
    if (displayPanel.style.display === 'block') toggleDisplayPanel(false);
  });

  // обработчики
  displayPanel.querySelector('#mapTileSelect').addEventListener('change', (e) => setTileProvider(e.target.value));
  const slider = displayPanel.querySelector('#lineWidthSlider');
  slider.addEventListener('input', () => {
    displayPanel.querySelector('#lineWidthValue').textContent = slider.value;
    updateAllLineWidths();
  });
}

function toggleDisplayPanel(force) {
  if (!displayPanel) return;
  const show = force !== undefined ? force : displayPanel.style.display !== 'block';
  displayPanel.style.display = show ? 'block' : 'none';
  if (displayBtn) displayBtn.classList.toggle('active', show);
}

// ---------- Полноэкранный режим карты ----------
// Карта (контейнер #mapBlock) разворачивается на весь экран поверх шапки,
// но под правой панелью (#sidebar, z-30) — панель остаётся видимой.
// Вход — плавающая кнопка #mapFullscreenEnterBtn в правом нижнем углу карты
// (в режиме скрыта). Выход — единственная кнопка «Свернуть» в группе
// #mapFullscreenBar рядом с бейджем «Общий пробег» (плюс Escape).
function addFullscreenControl() {
  // плавающая кнопка разворачивания (рендерится в шаблоне дашборда)
  const enterBtn = document.getElementById('mapFullscreenEnterBtn');
  if (enterBtn) {
    enterBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      toggleMapFullscreen(true);
    });
  }

  // плавающая кнопка «Свернуть» в шапке полноэкранной карты
  const exitBtn = document.getElementById('mapFullscreenExitBtn');
  if (exitBtn) {
    exitBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      toggleMapFullscreen(false);
    });
  }

  // выход из режима по Escape (если не открыта модалка — она закрывается своим обработчиком)
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !mapFullscreenActive()) return;
    if (document.querySelector('.modal-overlay.open')) return;
    toggleMapFullscreen(false);
  });
}

export function mapFullscreenActive() {
  const block = document.getElementById('mapBlock');
  return !!(block && block.classList.contains('map-fullscreen'));
}

export function toggleMapFullscreen(force) {
  const block = document.getElementById('mapBlock');
  if (!block || !map) return;
  const on = force !== undefined ? force : !block.classList.contains('map-fullscreen');
  block.classList.toggle('map-fullscreen', on);
  // Leaflet сам не отслеживает смену размеров контейнера без ресайза окна
  setTimeout(() => { if (map) map.invalidateSize(); }, 60);
}

// ---------- Контекстное меню ----------
let contextHandlers = {
  copyCoords: null, routeStart: null, routeAdd: null, routeFinish: null, isRouteMode: () => false,
};
export function setContextHandlers(handlers) {
  contextHandlers = { ...contextHandlers, ...(handlers || {}) };
}

function initContextMenu() {
  const menu = document.createElement('div');
  menu.className = 'map-context-menu';
  menu.innerHTML = `
    <button data-ctx="copy">Копировать координаты</button>
    <div class="ctx-separator"></div>
    <button data-ctx="route-start">Маршрут: начать отсюда</button>
    <button data-ctx="route-add">Маршрут: добавить точку</button>
    <button data-ctx="route-finish">Маршрут: завершить и построить</button>`;
  document.body.appendChild(menu);

  map.on('contextmenu', (e) => {
    const rect = map.getContainer().getBoundingClientRect();
    menu.style.left = (rect.left + e.containerPoint.x) + 'px';
    menu.style.top = (rect.top + e.containerPoint.y) + 'px';
    menu.style.display = 'block';
    menu._latlng = e.latlng;
  });
  const hide = () => { menu.style.display = 'none'; };
  map.on('click', hide);
  map.on('movestart', hide);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });

  menu.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-ctx]');
    if (!btn) return;
    const latlng = menu._latlng;
    hide();
    if (!latlng) return;
    const ll = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
    switch (btn.dataset.ctx) {
      case 'copy':
        if (contextHandlers.copyCoords) contextHandlers.copyCoords(ll);
        break;
      case 'route-start':
        if (contextHandlers.routeStart) contextHandlers.routeStart(latlng);
        break;
      case 'route-add':
        if (contextHandlers.routeAdd) contextHandlers.routeAdd(latlng);
        break;
      case 'route-finish':
        if (contextHandlers.routeFinish) contextHandlers.routeFinish();
        break;
    }
  });
}

// ---------- Helpers ----------
export function fitToTrack() {
  const layers = [];
  if (trackLayerGroup.ref) trackLayerGroup.ref.eachLayer((l) => { if (l.getBounds) layers.push(l); });
  if (!layers.length) return;
  const bounds = layers[0].getBounds();
  let valid = layers[0].getBounds().isValid();
  for (let i = 1; i < layers.length; i++) {
    const b = layers[i].getBounds();
    if (b.isValid()) { bounds.extend(b); valid = true; }
  }
  if (valid) map.fitBounds(bounds, { padding: [50, 50] });
}
