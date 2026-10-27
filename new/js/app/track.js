// Vehicle Track: загрузка, детект аномалий (Time Gap / Speed Spike / Position Jump / Out of Bounds),
// отрисовка (полилиния или точки), таблица аномалий + SQL, массовое удаление.

import { onPacket, sendRequest } from '../core/ws.js';
import { auth } from '../core/auth.js';
import {
  getTrackLayer, getAnomalyLayer, getMap, makeStartIcon, makeFinishIcon,
  registerSmartArrows, rebuildDirections,
} from '../core/map-core.js';
import { getAnomalySettings, isOutOfBounds } from '../core/config.js';
import {
  populateTable, parseTrackDate, formatDate, getField, haversineM,
  generateAnomalySql, generateBulkAnomalySql, openSqlModal, showToast, debounce,
} from '../core/utils.js';
import { state, emit } from './state.js';
import { registerTab } from './tabs.js';
import { requestMileageReport } from './mileage.js';
import { requestStartstop, requestMarkerDict } from './stops.js';
import { requestFuel } from './fuel.js';
import { clearAnalysis } from './analysis.js';
import * as logs from './logs.js';
import * as route from './route.js';
import * as playback from './playback.js';
import * as speedChart from './speed-chart.js';

let renderMode = 'polyline'; // 'polyline' | 'points'
let renderToken = 0;
let selectedLayer = null;
let focusMarker = null;
let trackLayers = []; // слои, принадлежащие треку (чанки, маркеры, старт/финиш)
let trackMarkersByTs = {}; // 'HH:MM:SS' -> [markers]
let rawHiddenMode = false; // телеметрия: точки в плеер/график, но НЕ на карту

const RAW_STYLES = {
  gap: { color: '#ff4136', weight: 4, dashArray: '8,6', title: 'Разрыв' },
  spike: { color: '#ffdc00', weight: 4, dashArray: '6,4', title: 'Скачок скорости' },
  jump: { color: '#ff4136', weight: 4, dashArray: '10,5', title: 'Прыжок позиции' },
  bounds: { color: '#800080', weight: 4, title: 'Вне границ' },
};

export function initTrack() {
  onPacket('Vehicle Track', (data) => {
    const rows = data.res && data.res[0] && data.res[0].f;
    if (!Array.isArray(rows)) return false;
    handleTrackResponse(rows);
    return true;
  });

  // Startstop Sum Result → итоговый пробег для бейджа и шаблона «ok»
  onPacket('Startstop Sum Result', (data) => {
    const rows = data.res && data.res[0] && data.res[0].f;
    if (!Array.isArray(rows)) return false;
    const last = rows.length ? rows[rows.length - 1] : null;
    const rawDest = last && last.dest != null ? String(last.dest) : '';
    const dest = parseFloat(rawDest.replace(',', '.'));
    state.lastOkDest = rawDest || '0';
    state.startstopTotalKm = isFinite(dest) ? dest : 0;
    emit('mileage');
    return false;
  }, { priority: 1 });

  registerTab({
    id: 'anomalies',
    title: 'Аномалии',
    getRows: () => state.anomalies.map((a) => {
      const out = {};
      for (const k of Object.keys(a)) {
        if (k.startsWith('_') || k === 'layer') continue;
        out[k] = a[k];
      }
      return out;
    }),
    render: renderAnomaliesTab,
  });

  const bulkBtn = document.getElementById('bulkDeleteAnomaliesBtn');
  if (bulkBtn) {
    bulkBtn.addEventListener('click', () => {
      if (!state.anomalies.length) { showToast('Нет аномалий для удаления'); return; }
      document.getElementById('bulkDeleteModal').classList.add('open');
    });
  }

  const bulkForm = document.getElementById('bulkDeleteForm');
  if (bulkForm) {
    bulkForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const bySpeed = document.getElementById('bulkDeleteSpeedCheck').checked;
      const speedVal = parseFloat(document.getElementById('bulkDeleteSpeedValue').value);
      const byDist = document.getElementById('bulkDeleteDistanceCheck').checked;
      const distVal = parseFloat(document.getElementById('bulkDeleteDistanceValue').value);
      if (!bySpeed && !byDist) { showToast('Выберите хотя бы один критерий'); return; }

      const filtered = state.anomalies.filter((a) => {
        let match = false;
        if (bySpeed) {
          const s = parseFloat(String(a['Calculated Speed (km/h)']).replace(',', '.'));
          if (isFinite(s) && s > speedVal) match = true;
        }
        if (byDist) {
          const d = parseFloat(String(a['Distance (km)']).replace(',', '.'));
          if (isFinite(d) && d > distVal) match = true;
        }
        return match;
      });
      if (!filtered.length) { showToast('Аномалий по критериям не найдено'); return; }

      const criteria = [
        bySpeed ? `Calculated Speed > ${speedVal} km/h` : null,
        byDist ? `Distance > ${distVal} km` : null,
      ].filter(Boolean).join(' OR ');
      const sql = generateBulkAnomalySql(filtered, state.deviceId, criteria);
      document.getElementById('bulkDeleteModal').classList.remove('open');
      openSqlModal(sql);
    });
  }
}

// ---------- Загрузка ----------
function requestBaseData() {
  requestMileageReport();
  requestStartstop();
  requestStartstopSums();
  requestMarkerDict(); // справочник локаций (act reinit)
}

// «Загрузить трек»: пробег (Mileage Report) + стоянки (Startstop). БЕЗ Vehicle Track.
// Vehicle Track загружается только кнопками «Сырой» (админка) и «Телеметрия» (дашборд).
export function loadTrack() {
  if (!state.deviceId) { showToast('⚠ Сначала выберите ТС'); return; }
  clearTrack();
  requestBaseData();
  showToast(`Загрузка пробега и стоянок: ${state.selectedVehicle ? state.selectedVehicle.number : state.deviceId}...`);
}

export function loadRawTrack(opts = {}) {
  if (!state.deviceId) { showToast('⚠ Сначала выберите ТС'); return; }
  clearTrack();
  renderMode = 'points';
  rawHiddenMode = !!opts.hidden;
  requestTrack();
  requestFuel(); // топливо запрашивается вместе с телеметрией/сырым треком
  showToast(rawHiddenMode
    ? 'Загрузка телеметрии (Vehicle Track + Fuel Litres)...'
    : 'Загрузка сырого трека (Vehicle Track + Fuel Litres)...');
}

// «Телеметрия» (дашборд): сырой трек в плеер/график без отрисовки на карте;
// если обычный трек (пробег) не загружен — подгружает и его.
export function loadTelemetry() {
  if (!state.deviceId) { showToast('⚠ Сначала выберите ТС'); return; }
  if (!state.mileageSegments.length) {
    requestBaseData();
  }
  loadRawTrack({ hidden: true });
}

function requestTrack() {
  const { dateFrom, dateTo } = getDates();
  sendRequest({
    name: 'Vehicle Track', type: 'map', mid: 2, act: 'filter',
    filter: [
      { selectedpgdateto: [dateTo] },
      { selectedpgdatefrom: [dateFrom] },
      { selectedvihicleid: [state.deviceId] },
    ],
    lang: 'en',
  });
}

function requestStartstopSums() {
  const { dateFrom, dateTo } = getDates();
  sendRequest({
    name: 'Startstop Sum Result', type: 'etbl', mid: 7, act: 'filter',
    filter: [
      { selecteduid: [auth.uid] },
      { selectedvihicleid: [state.deviceId] },
      { selectedpgdatefrom: [dateFrom] },
      { selectedpgdateto: [dateTo] },
    ],
    lang: 'en',
  });
}

function getDates() {
  const fromEl = document.getElementById('startDate');
  const toEl = document.getElementById('endDate');
  const build = (raw, isEnd) => {
    if (!raw) return '';
    if (raw.length === 16) raw += isEnd ? ':59' : ':00';
    return raw;
  };
  return {
    dateFrom: build(fromEl ? fromEl.value : '', false),
    dateTo: build(toEl ? toEl.value : '', true),
  };
}

export function clearTrack() {
  renderToken += 1;
  rawHiddenMode = false;
  clearAnalysis(); // линии анализа принадлежат треку — грузим новый, старый анализ стираем
  const tl = getTrackLayer();
  if (tl) {
    trackLayers.forEach((l) => { try { tl.removeLayer(l); } catch (e) {} });
  }
  trackLayers = [];
  const al = getAnomalyLayer();
  if (al) al.clearLayers();
  // убрать стрелки направлений вместе с треком: пересобираем декораторы
  // по реестру (слои предыдущего ТС уже удалены из группы)
  rebuildDirections();
  state.trackPoints = [];
  state.anomalies = [];
  trackMarkersByTs = {};
  if (focusMarker) { try { getMap().removeLayer(focusMarker); } catch (e) {} focusMarker = null; }
  selectedLayer = null;
  emit('track');
  emit('cleared');
}

// ---------- Парсинг ----------
function parsePoints(rows) {
  const parsed = [];
  rows.forEach((row, idx) => {
    const lat = parseFloat(getField(row, ['latitude', 'lat']));
    const lng = parseFloat(getField(row, ['longitude', 'lon', 'lng']));
    const wdate = getField(row, ['wdate', 'sdate', 'date']);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    const ts = (() => { const d = parseTrackDate(String(wdate || '')); return d ? d.getTime() : 0; })();
    parsed.push({
      lat, lng, wdate: String(wdate || ''), ts,
      speed: parseFloat(getField(row, ['speed'])) || 0,
      raw: row, idx,
    });
  });
  parsed.sort((a, b) => a.ts - b.ts);
  parsed.forEach((p, i) => { p.index = i; });
  return parsed;
}

// ---------- Обработка ответа ----------
function handleTrackResponse(rows) {
  const parsed = parsePoints(rows);
  if (!parsed.length) {
    showToast('Трек пустой (нет валидных координат)');
    return;
  }
  state.trackPoints = parsed;
  const result = analyzeTrack(parsed);
  state.anomalies = result.anomalies;
  emit('track');

  playback.setPoints(parsed);
  speedChart.setTrack(parsed);
  emit('telemetry');
  // Телеметрия (дашборд): данные только в плеер/график, на карту не рисуем
  if (rawHiddenMode) return;

  drawTrack(parsed, () => {
    drawAnomalyLayers(result.layerSpecs);
    renderAnomaliesTable();
    rebuildDirections();
  });

  playback.setPoints(parsed);
  speedChart.setTrack(parsed);

  if (state.anomalies.length) {
    showToast(`Найдено аномалий: ${state.anomalies.length}`);
  }
}

// ---------- Анализ аномалий ----------
function analyzeTrack(parsed) {
  const s = getAnomalySettings();
  const anomalies = [];
  const layerSpecs = [];
  const n = parsed.length;

  // Out-of-bounds группы
  let boundsGroup = null;
  const flushBounds = () => {
    if (!boundsGroup || !boundsGroup.points.length) { boundsGroup = null; return; }
    const pts = boundsGroup.points;
    if (boundsGroup.prev) pts.unshift(boundsGroup.prev);
    anomalies.push({
      'Start Time': formatDate(new Date(pts[0]._ts)),
      'End Time': formatDate(new Date(pts[pts.length - 1]._ts)),
      'Anomaly Type': 'Out of Bounds',
      'Calculated Speed (km/h)': 'N/A',
      'Reported Speed (km/h)': String(pts[pts.length - 1].speed != null ? pts[pts.length - 1].speed : ''),
      'Duration': '',
      'Distance (km)': '',
    });
    layerSpecs.push({
      type: 'bounds',
      latlngs: pts.map((p) => [p.lat, p.lng]),
      info: { start: pts[0].wdate, end: pts[pts.length - 1].wdate },
    });
    boundsGroup = null;
  };

  for (let i = 0; i < n; i++) {
    const cur = parsed[i];
    if (isOutOfBounds(cur.lat, cur.lng)) {
      if (!boundsGroup) boundsGroup = { points: [], prev: i > 0 ? parsed[i - 1] : null };
      boundsGroup.points.push({ lat: cur.lat, lng: cur.lng, _ts: cur.ts, wdate: cur.wdate, speed: cur.speed });
      continue;
    }
    flushBounds();
    if (i === 0) continue;

    const prev = parsed[i - 1];
    const timeDiffMs = cur.ts - prev.ts;
    const distanceM = haversineM(prev.lat, prev.lng, cur.lat, cur.lng);
    const speedKph = timeDiffMs > 0 ? (distanceM / 1000) / (timeDiffMs / 3600000) : 0;
    const reportedSpeed = cur.speed != null ? cur.speed : 0;

    const isGap = timeDiffMs > s.gapThresholdMs;
    const isSpike = !isGap && timeDiffMs > 0 && speedKph > s.speedThresholdKph;
    const isJumpSpeed = !isGap && timeDiffMs > 0 && speedKph > s.jumpSpeedThresholdKph && reportedSpeed < s.realSpeedThresholdKph;
    const isJumpDist = distanceM >= s.positionJumpDistanceM;

    if (!isGap && !isSpike && !isJumpSpeed && !isJumpDist) continue;
    if (distanceM < s.tableMinDistanceM && !isGap) continue;

    // Длительность и расстояние «с запасом»: от точки ДО аномалии до точки ПОСЛЕ —
    // как в v2/Analyze. Внутренние точки аномального сегмента часто имеют нулевую/
    // неверную дельту времени, а для одиночного выброса (скачок туда-обратно) путь
    // через аномалию с соседями даёт корректные значения.
    const beforeIdx = i >= 2 ? i - 2 : i - 1;
    const afterIdx = i < n - 1 ? i + 1 : i;
    const beforeTs = parsed[beforeIdx].ts;
    const afterTs = parsed[afterIdx].ts;
    const durMs = (afterTs > beforeTs) ? afterTs - beforeTs : timeDiffMs;
    let extDistanceM = 0;
    for (let k = beforeIdx + 1; k <= afterIdx; k++) {
      extDistanceM += haversineM(parsed[k - 1].lat, parsed[k - 1].lng, parsed[k].lat, parsed[k].lng);
    }

    const types = [];
    if (isGap) types.push(['Time Gap', 'gap']);
    if (isSpike) types.push(['Speed Spike', 'spike']);
    if (isJumpSpeed || isJumpDist) types.push(['Position Jump', 'jump']);

    types.forEach(([typeName, key]) => {
      anomalies.push({
        'Start Time': formatDate(new Date(prev.ts)),
        'End Time': formatDate(new Date(cur.ts)),
        'Anomaly Type': typeName,
        'Calculated Speed (km/h)': speedKph ? speedKph.toFixed(2) : '0',
        'Reported Speed (km/h)': String(reportedSpeed),
        'Duration': msToHms(durMs),
        'Distance (km)': (extDistanceM / 1000).toFixed(3),
        _key: key,
        _startW: prev.wdate,
        _endW: cur.wdate,
      });
      layerSpecs.push({
        type: key,
        latlngs: [[prev.lat, prev.lng], [cur.lat, cur.lng]],
        info: { start: prev.wdate, end: cur.wdate, speed: speedKph, distance: extDistanceM },
      });
    });
  }
  flushBounds();
  return { anomalies, layerSpecs };
}

function msToHms(ms) {
  if (!isFinite(ms) || ms < 0) return '';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const p = (x) => (x < 10 ? '0' : '') + x;
  return `${h}:${p(m)}:${p(sec)}`;
}

// ---------- Отрисовка ----------
const BATCH = 750;

function drawTrack(parsed, onDone) {
  const tl = getTrackLayer();
  const map = getMap();
  const token = ++renderToken;

  const latlngs = parsed.map((p) => [p.lat, p.lng]);
  if (!latlngs.length) { onDone && onDone(); return; }

  // Не дёргаем fitBounds, если пробег только что отфитил карту (избегаем двойного скачка)
  if (!state.lastFitAt || Date.now() - state.lastFitAt > 4000) {
    const bounds = L.latLngBounds(latlngs);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
  }

  // Старт/финиш (принадлежат треку)
  addStartEndMarkers(parsed);

  let progress = 0;

  const step = () => {
    if (token !== renderToken) return; // устарело
    const from = Math.max(0, progress - 1); // общая точка для непрерывности
    const to = Math.min(latlngs.length, progress + BATCH);
    const chunk = latlngs.slice(from, to);
    if (chunk.length >= 2) {
      if (renderMode === 'polyline') {
        const seg = L.polyline(chunk, { color: '#0074D9', weight: 4, opacity: 0.9 }).addTo(tl);
        seg._dtPoints = parsed.slice(from, to);
        bindTrackClick(seg, parsed);
        trackLayers.push(seg);
      } else {
        for (let i = (progress === 0 ? 0 : 1); i < chunk.length; i++) {
          const p = parsed[from + i];
          const cm = L.circleMarker(chunk[i], { radius: 3, color: '#0074D9', weight: 1, fill: true, fillOpacity: 0.9 }).addTo(tl);
          cm.bindPopup(buildPointPopup(p));
          trackLayers.push(cm);
          const key = p.wdate.slice(11, 19);
          if (!trackMarkersByTs[key]) trackMarkersByTs[key] = [];
          trackMarkersByTs[key].push(cm);
        }
        const carrier = L.polyline(chunk, { opacity: 0, weight: 0 }).addTo(tl);
        carrier._trackRawArrows = true;
        carrier._arrowColor = '#111111';
        trackLayers.push(carrier);
      }
    }
    progress = to;
    if (progress < latlngs.length) {
      requestAnimationFrame(step);
    } else {
      onDone && onDone();
    }
  };
  requestAnimationFrame(step);
}

function addStartEndMarkers(parsed) {
  const tl = getTrackLayer();
  // «Перехватываем» маркеры пробега, чтобы не было дублей
  tl.eachLayer((l) => {
    if (l._mileageEndpoint) {
      try { tl.removeLayer(l); } catch (e) { /* ignore */ }
      const i = trackLayers.indexOf(l);
      if (i !== -1) trackLayers.splice(i, 1);
    }
  });
  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  const m1 = L.marker([first.lat, first.lng], { icon: makeStartIcon(), zIndexOffset: 1000 })
    .bindPopup(`<b>Старт маршрута</b><br>${first.wdate}`)
    .addTo(tl);
  const m2 = L.marker([last.lat, last.lng], { icon: makeFinishIcon(), zIndexOffset: 1000 })
    .bindPopup(`<b>Финиш маршрута</b><br>${last.wdate}`)
    .addTo(tl);
  trackLayers.push(m1, m2);
}

function buildPointPopup(p) {
  const container = document.createElement('div');
  container.innerHTML =
    `<div class="popup-title">Точка трека</div>` +
    `Время: ${p.wdate}<br>Скорость: ${p.speed != null ? p.speed : '-'} км/ч` +
    `<div class="popup-actions"></div>`;
  const actions = container.querySelector('.popup-actions');

  // «В Dev Log» — только если на странице есть таблица Device Log (админка)
  if (document.getElementById('deviceLogTbody')) {
    const fullBtn = document.createElement('button');
    fullBtn.className = 'btn btn-secondary btn-xs';
    fullBtn.innerHTML = '<i class="fa-solid fa-table-list"></i> В Dev Log';
    fullBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      logs.focusFullTrackAtTimestamp(p.wdate);
    });
    actions.appendChild(fullBtn);
  }

  const cutBtn = route.createTrackCutButton(p.lat, p.lng, p.wdate);
  actions.appendChild(cutBtn);

  return container;
}

function bindTrackClick(seg, parsed) {
  seg.on('click', (e) => {
    if (window.__routeModeActive || window.__rulerModeActive) return; // клик обрабатывает активный инструмент карты
    const nearest = findNearest(parsed, e.latlng);
    if (!nearest) return;
    showFocusMarker(nearest);
  });
}

function findNearest(parsed, latlng) {
  let best = null;
  let bestDist = Infinity;
  parsed.forEach((p) => {
    const d = haversineM(latlng.lat, latlng.lng, p.lat, p.lng);
    if (d < bestDist) { bestDist = d; best = p; }
  });
  return best;
}

function showFocusMarker(p) {
  const map = getMap();
  if (focusMarker) map.removeLayer(focusMarker);
  focusMarker = L.marker([p.lat, p.lng], {
    icon: L.divIcon({ className: '', html: '<div class="point-focus-marker"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
    zIndexOffset: 1000,
  }).addTo(map);
  focusMarker.bindPopup(buildPointPopup(p)).openPopup();
}

// ---------- Слои аномалий ----------
function drawAnomalyLayers(specs) {
  const al = getAnomalyLayer();
  if (!al) return;
  al.clearLayers();
  // Привязка слоёв к строкам таблицы (по порядку layerSpecs соответствует аномалиям с _key)
  const keyed = state.anomalies.filter((a) => a._key);
  let k = 0;
  specs.forEach((spec) => {
    const style = RAW_STYLES[spec.type];
    if (!style) return;
    const line = L.polyline(spec.latlngs, {
      color: style.color, weight: style.weight, opacity: 0.95,
      dashArray: style.dashArray || null,
    }).addTo(al);
    line.bindPopup(
      `<div class="popup-title">Аномалия: ${style.title}</div>` +
      `Начало: ${spec.info.start}<br>Конец: ${spec.info.end}` +
      (spec.info.speed ? `<br>Расчётная скорость: ${spec.info.speed.toFixed(2)} км/ч` : '') +
      (spec.info.distance ? `<br>Расстояние: ${(spec.info.distance / 1000).toFixed(3)} км` : '')
    );
    if (spec.type === 'bounds') {
      // последняя Out-of-Bounds в anomalies — найдём по индексу
      const anom = state.anomalies.find((a) => a['Anomaly Type'] === 'Out of Bounds' && !a._layer);
      if (anom) anom._layer = line;
    } else if (k < keyed.length) {
      keyed[k]._layer = line;
      k += 1;
    }
  });
}

// ---------- Таблица аномалий ----------
let anomaliesRendered = false;

function renderAnomaliesTab() {
  anomaliesRendered = true;
  renderAnomaliesTable();
}

export function renderAnomaliesTable() {
  if (!anomaliesRendered) return;
  const thead = document.getElementById('anomaliesThead');
  const tbody = document.getElementById('anomaliesTbody');
  if (!thead || !tbody) return;
  const headers = ['Start Time', 'End Time', 'Anomaly Type', 'Calculated Speed (km/h)', 'Reported Speed (km/h)', 'Duration', 'Distance (km)'];
  populateTable(tbody, thead, state.anomalies, {
    headers,
    emptyMessage: 'Аномалий не обнаружено.',
    rowClass: (a) => a['Anomaly Type'] === 'Out of Bounds' ? 'text-purple-300' : '',
    actionButtons: [{
      title: 'Сформировать SQL для удаления',
      icon: '<i class="fa-solid fa-scissors"></i>',
      className: 'btn btn-danger btn-xs',
      onClick: (row) => {
        const sql = generateAnomalySql(row, state.deviceId);
        if (sql) openSqlModal(sql);
        else showToast('Не удалось сформировать SQL');
      },
    }],
    onRowClick: (row) => {
      if (row._layer) blinkLayer(row._layer);
      else showToast('Слой аномалии не найден на карте');
    },
  });
  const summary = document.getElementById('anomaliesSummary');
  if (summary) {
    summary.textContent = state.anomalies.length
      ? `Найдено: ${state.anomalies.length} · клик по строке — подсветить на карте`
      : '';
  }
}

function blinkLayer(layer) {
  const map = getMap();
  const el = layer.getElement && layer.getElement();
  if (el) {
    el.classList.add('anomaly-blink');
    setTimeout(() => el.classList.remove('anomaly-blink'), 1600);
  }
  try {
    const b = layer.getBounds();
    if (b && b.isValid()) map.fitBounds(b, { padding: [50, 50], maxZoom: 16 });
  } catch (e) { /* ignore */ }
  if (layer.openPopup) {
    const ll = layer.getLatLngs ? layer.getLatLngs()[0] : null;
    if (ll) layer.openPopup(ll);
    else layer.openPopup();
  }
}

// ---------- Синхронизация с Full Track ----------
export function focusTrackAtTimestamp(wdate) {
  const key = String(wdate).slice(11, 19);
  const markers = trackMarkersByTs[key];
  if (markers && markers.length) {
    const m = markers[0];
    const ll = m.getLatLng();
    getMap().setView(ll, Math.max(getMap().getZoom(), 15));
    m.openPopup();
    return true;
  }
  return false;
}
