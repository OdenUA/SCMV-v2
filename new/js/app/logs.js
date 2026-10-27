// Вкладка Device Log: Full Device Track + интервальный отчёт (Type1–4) + подсветка строк.

import { onPacket, sendRequest } from '../core/ws.js';
import { ROW_CHUNK_LIMIT, getAnomalySettings, isOutOfBounds } from '../core/config.js';
import { getTrackLayer, getMap } from '../core/map-core.js';
import {
  mountTableBody, parseTrackDate, timeKeyOf, getField, haversineM,
  generateSqlFromIntervals, openSqlModal, showToast, escapeHtml, debounce,
} from '../core/utils.js';
import { state, emit, on } from './state.js';
import { registerTab } from './tabs.js';

let fullState = null;
let pendingAnalysis = false;

export let fullTrackCache = [];
const fullIndexByTs = {};
let intervals = null;
let highlighted = new Set();
// idx строки полного трека -> класс fdt-interval-typeN (подсветка строк интервалов отчёта)
const intervalClassByRow = {};
let focusMarker = null;

const SETTINGS_KEY = 'fullTrackReportSettings21';

// Вкладка Device Log отображает Full Device Track; состав и порядок колонок зафиксированы
const DEVICE_LOG_COLS = ['id', 'deviceid', 'wdate', 'sdate', 'latitude', 'longitude', 'speed', 'status', 'altitude', 'bearing', 'satelites', 'vehicle', 'marker', 'batvoltage', 'ignition', 'ismoves'];

// ---------- Публичный API ----------
export function initLogs() {
  onPacket('Device Track', handleChunkedFull, { predicate: () => !!(fullState && fullState.active), priority: 5 });
  on('cleared', clearFocus);

  registerTab({ id: 'devlog', title: 'Device Log', getRows: () => fullTrackCache.slice(), render: renderLogTable, onShow: renderLogTable });

  const openAnomalySql = () => {
    const sql = generateSqlFromIntervals(state.deviceId, intervals || []);
    if (sql) openSqlModal(sql);
    else showToast('Нет аномальных интервалов');
  };
  const devlogApplyBtn = document.getElementById('devlogApplyFilterBtn');
  if (devlogApplyBtn) devlogApplyBtn.addEventListener('click', () => {
    if (!fullTrackCache.length) { showToast('Нет данных полного трека'); return; }
    saveReportSettings();
    runReport();
  });
  const devlogClearBtn = document.getElementById('devlogClearFocusBtn');
  if (devlogClearBtn) devlogClearBtn.addEventListener('click', clearFocus);
  const devlogSqlBtn = document.getElementById('devlogGenerateSqlBtn');
  if (devlogSqlBtn) devlogSqlBtn.addEventListener('click', openAnomalySql);

  restoreReportSettings();
}

export function loadDeviceData(opts = {}) {
  if (!state.deviceId) { showToast('⚠ Сначала выберите ТС'); return; }
  pendingAnalysis = !!opts.analysis;
  clearLogTables();
  showToast('Загрузка Device Log...');
  if (opts.scrollToLogs) {
    // кнопка «Dev Log» — сразу показываем вкладку Device Log
    const btn = document.querySelector('.tab-btn[data-tab="devlog"]');
    if (btn) btn.click();
  }
  const { dateFrom, dateTo } = getDates();
  requestFullTrack(dateFrom, dateTo);
}

export function clearLogTables() {
  fullState = null;
  fullTrackCache = [];
  intervals = null;
  highlighted = new Set();
  Object.keys(intervalClassByRow).forEach((k) => delete intervalClassByRow[k]);
  for (const k of Object.keys(fullIndexByTs)) delete fullIndexByTs[k];
  renderLogTable();
  renderReportTable();
}

// ---------- Даты ----------
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

// ---------- Чанкинг ----------
function findOldestTimestamp(rows) {
  let minTs = null;
  rows.forEach((r) => {
    const d = parseTrackDate(String(getField(r, ['wdate', 'sdate', 'date']) || ''));
    if (!d) return;
    const ts = d.getTime();
    if (minTs == null || ts < minTs) minTs = ts;
  });
  if (minTs == null) return null;
  const d = new Date(minTs);
  const p = (n) => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  rows.forEach((r) => {
    const key = JSON.stringify(r);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  });
  return out;
}

function rowTime(row) {
  const d = parseTrackDate(String(getField(row, ['wdate', 'sdate', 'date']) || ''));
  return d ? d.getTime() : 0;
}

function sortRowsByTimeAsc(rows) {
  return rows.slice().sort((a, b) => rowTime(a) - rowTime(b));
}

// ---------- Full Device Track ----------
function requestFullTrack(dateFrom, dateTo) {
  fullState = {
    active: true,
    rows: [],
    originalFrom: dateFrom,
    originalTo: dateTo,
    currentTo: null,
    lastOldestTs: null,
  };
  sendFullChunk(dateTo);
}

function sendFullChunk(toValue) {
  sendRequest({
    name: 'Device Track', type: 'etbl', mid: 6, act: 'setup',
    filter: [
      { selectedpgdateto: [toValue] },
      { selectedpgdatefrom: [fullState.originalFrom] },
      { selecteddeviceid: [state.deviceId] },
    ],
    lang: 'en',
  });
}

function handleChunkedFull(data) {
  const rows = data.res && data.res[0] && data.res[0].f;
  if (!Array.isArray(rows)) { fullState.active = false; finalizeFull([]); return true; }
  fullState.rows.push(...rows);

  if (rows.length >= ROW_CHUNK_LIMIT) {
    const oldest = findOldestTimestamp(rows);
    if (oldest && (!fullState.lastOldestTs || oldest > fullState.lastOldestTs)) {
      fullState.lastOldestTs = oldest;
      sendFullChunk(oldest);
      return true;
    }
  }
  fullState.active = false;
  finalizeFull(dedupeRows(fullState.rows));
  return true;
}

function finalizeFull(rows) {
  fullTrackCache = sortRowsByTimeAsc(rows);
  for (const k of Object.keys(fullIndexByTs)) delete fullIndexByTs[k];
  fullTrackCache.forEach((r, i) => {
    const key = timeKeyOf(String(getField(r, ['wdate', 'sdate', 'date']) || ''));
    if (!key) return;
    if (!fullIndexByTs[key]) fullIndexByTs[key] = [];
    fullIndexByTs[key].push(i);
  });
  const dlc = document.getElementById('devlogCount');
  if (dlc) dlc.textContent = `${fullTrackCache.length} записей`;
  renderLogTable();

  if (pendingAnalysis) {
    pendingAnalysis = false;
    import('./analysis.js').then((m) => m.runAnalysisFromRows(fullTrackCache)).catch((e) => console.warn(e));
  }
  // Отчёт по интервалам и подсветка строк — при ЛЮБОЙ загрузке полного трека
  // (в том числе через «Анализ», как в основном проекте)
  runReport();
  showToast(`Полный трек: ${fullTrackCache.length} записей`);
}

// ---------- Рендер таблицы ----------
function sanitizeCell(v) {
  if (v == null) return '';
  let s = String(v);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/\son\w+="[^"]*"/gi, '');
  return s;
}

// Класс строки полного трека: подсветка интервала отчёта + выделение фокуса
function fullTrackRowClass(i) {
  const parts = [];
  if (intervalClassByRow[i]) parts.push(intervalClassByRow[i]);
  if (highlighted.has(i)) parts.push('row-selected');
  return parts.join(' ');
}

let logMount = null;
function renderLogTable() {
  const tbody = document.getElementById('deviceLogTbody');
  if (!tbody) return;
  const keys = fullTrackCache.length ? Object.keys(fullTrackCache[0]) : [];
  const headers = DEVICE_LOG_COLS.filter((c) => keys.indexOf(c) !== -1);
  const opts = {
    tbody,
    thead: document.getElementById('deviceLogThead'),
    scrollEl: tbody.closest('.table-scroll'),
    rows: fullTrackCache,
    headers,
    renderCell: (row, key) => sanitizeCell(row[key]),
    getRowClass: (row, i) => fullTrackRowClass(i),
    onRowClick: (row) => focusMapAtRow(row),
    emptyMessage: 'Нет данных. Нажмите «Dev Log».',
  };
  logMount = mountTableBody(opts);
}

// ---------- Фокус на карте ----------
function focusMapAtRow(row) {
  const mapBlock = document.getElementById('mapBlock');
  if (mapBlock) mapBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const lat = parseFloat(getField(row, ['latitude', 'lat']));
  const lng = parseFloat(getField(row, ['longitude', 'lon', 'lng']));
  if (!isFinite(lat) || !isFinite(lng)) { showToast('В строке нет координат'); return; }
  const map = getMap();
  if (focusMarker) { try { map.removeLayer(focusMarker); } catch (e) {} }
  focusMarker = L.marker([lat, lng], {
    icon: L.divIcon({ className: '', html: '<div class="point-focus-marker"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
    zIndexOffset: 1500,
  }).addTo(map);
  map.setView([lat, lng], Math.max(map.getZoom(), 15));
  const wdate = getField(row, ['wdate', 'sdate', 'date']);
  const speed = getField(row, ['speed']);
  focusMarker.bindPopup(
    `<div class="popup-title">Точка</div>Время: ${escapeHtml(String(wdate || ''))}<br>` +
    `Скорость: ${escapeHtml(String(speed != null ? speed : '-'))} км/ч<br>` +
    `Координаты: ${lat.toFixed(6)}, ${lng.toFixed(6)}`
  ).openPopup();
}

export function focusFullTrackAtTimestamp(wdate) {
  const key = String(wdate).slice(11, 19);
  const idxs = fullIndexByTs[key];
  if (!idxs || !idxs.length) {
    showToast('Полный трек не загружен или время не найдено');
    return false;
  }
  highlighted = new Set(idxs);
  renderLogTable();
  if (logMount) logMount.scrollToIndex(idxs[0]);
  setTimeout(() => {
    highlighted = new Set();
    renderLogTable();
  }, 8000);
  // переключимся на вкладку Device Log
  const btn = document.querySelector('.tab-btn[data-tab="devlog"]');
  if (btn) btn.click();
  return true;
}

function clearFocus() {
  highlighted = new Set();
  if (focusMarker) {
    try { getMap().removeLayer(focusMarker); } catch (e) {}
    focusMarker = null;
  }
  renderLogTable();
}

// ---------- Интервальный отчёт ----------
// Поля настроек отчёта (панель Device Log)
function settingsEls() {
  return {
    minEl: document.getElementById('devlogMinDuration'),
    satEl: document.getElementById('devlogSatThreshold'),
    gapEl: document.getElementById('devlogMergeGap'),
  };
}

function restoreReportSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.minDuration != null) {
      ['devlogMinDuration'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = s.minDuration; });
    }
    if (s.satThreshold != null) {
      ['devlogSatThreshold'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = s.satThreshold; });
    }
    if (s.mergeGap != null) {
      ['devlogMergeGap'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = s.mergeGap; });
    }
  } catch (e) { /* ignore */ }
}

function saveReportSettings() {
  try {
    const { minEl, satEl, gapEl } = settingsEls();
    if (!minEl || !satEl || !gapEl) return; // панель отчёта не на странице (дашборд)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      minDuration: minEl.value,
      satThreshold: satEl.value,
      mergeGap: gapEl.value,
    }));
  } catch (e) { /* ignore */ }
}

function reportSettings() {
  const { minEl, satEl, gapEl } = settingsEls();
  return {
    minDuration: minEl ? (parseInt(minEl.value, 10) || 0) : 0,
    satThreshold: satEl ? (parseInt(satEl.value, 10) || 10) : 10,
    mergeGap: gapEl ? (parseInt(gapEl.value, 10) || 0) : 0,
  };
}

function runReport() {
  intervals = buildIntervals(fullTrackCache);
  // Подсветка строк интервалов в таблице (аналог v2)
  Object.keys(intervalClassByRow).forEach((k) => delete intervalClassByRow[k]);
  intervals.forEach((iv) => {
    const cls = `fdt-interval-type${iv.type}`;
    (iv.rows || []).forEach((ri) => { if (!intervalClassByRow[ri]) intervalClassByRow[ri] = cls; });
  });
  renderLogTable();
  renderReportTable();
  const hasAnomalies = intervals.some((iv) => iv.isAnomaly);
  const btn = document.getElementById('devlogGenerateSqlBtn');
  if (btn) btn.classList.toggle('hidden', !hasAnomalies);
}

function buildIntervals(rows) {
  const { minDuration, satThreshold, mergeGap } = reportSettings();
  const pts = rows.map((r, i) => {
    const lat = parseFloat(getField(r, ['latitude', 'lat']));
    const lng = parseFloat(getField(r, ['longitude', 'lon', 'lng']));
    const d = parseTrackDate(String(getField(r, ['wdate', 'sdate', 'date']) || ''));
    // Как в v2: сервер может отдавать булевы поля строками ('true'/'false'/'0'/'1')
    const ignRaw = getField(r, ['ignition']);
    const movRaw = getField(r, ['ismoves']);
    const noIgnition = (ignRaw === false || ignRaw === 'false' || ignRaw === 0 || ignRaw === '0');
    const isMoves = (movRaw === true || movRaw === 'true' || movRaw === 1 || movRaw === '1');
    const satRaw = parseInt(getField(r, ['satelites', 'satellites', 'sat']), 10);
    return {
      i,
      ts: d ? d.getTime() : 0,
      wdate: String(getField(r, ['wdate', 'sdate', 'date']) || ''),
      ignition: !noIgnition,
      ismoves: isMoves,
      sat: isNaN(satRaw) ? null : satRaw,
      lat, lng,
      badCoords: !isFinite(lat) || !isFinite(lng) || isOutOfBounds(lat, lng),
    };
  }).filter((p) => p.ts > 0).sort((a, b) => a.ts - b.ts);

  const list = [];
  let cur = null;

  const flush = () => {
    if (!cur) return;
    cur.end = cur.last;
    list.push(cur);
    cur = null;
  };

  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const type1 = !p.ignition && p.ismoves;
    const type2 = p.sat != null && p.sat < satThreshold; // 0 спутников тоже учитывается (как в v2)
    const type4 = p.badCoords;

    const type = type4 ? 4 : (type1 && type2) ? 3 : type1 ? 1 : type2 ? 2 : 0;
    if (type === 0) { flush(); continue; }

    if (!cur || cur.isAnomaly !== type4) {
      flush();
      cur = { type, start: p, last: p, rows: [p.i], isAnomaly: type4, flags: type };
      continue;
    }
    const gapSec = (p.ts - cur.last.ts) / 1000;
    if (gapSec <= Math.max(mergeGap, 1)) {
      cur.last = p;
      cur.rows.push(p.i);
      cur.flags |= type;
    } else {
      flush();
      cur = { type, start: p, last: p, rows: [p.i], isAnomaly: type4, flags: type };
    }
  }
  flush();

  // Фильтр по мин. длительности (аномалии не фильтруются)
  const filtered = list.filter((iv) => {
    if (iv.isAnomaly) return true;
    return (iv.last.ts - iv.start.ts) / 1000 >= minDuration;
  });

  // Дистанция по строкам
  filtered.forEach((iv) => {
    let dist = 0;
    for (let k = 1; k < iv.rows.length; k++) {
      const a = rows[iv.rows[k - 1]]; const b = rows[iv.rows[k]];
      const la = parseFloat(getField(a, ['latitude', 'lat'])); const loa = parseFloat(getField(a, ['longitude', 'lon', 'lng']));
      const lb = parseFloat(getField(b, ['latitude', 'lat'])); const lob = parseFloat(getField(b, ['longitude', 'lon', 'lng']));
      if (isFinite(la) && isFinite(loa) && isFinite(lb) && isFinite(lob)) dist += haversineM(la, loa, lb, lob);
    }
    iv.distance = dist;
  });

  // Аномалии вверх
  filtered.sort((a, b) => (b.isAnomaly ? 1 : 0) - (a.isAnomaly ? 1 : 0));
  return filtered;
}

const TYPE_NAMES = { 1: 'Движение без питания', 2: 'Мало спутников', 3: 'Оба', 4: 'GPS-аномалия' };

function renderReportTable() {
  const thead = document.getElementById('devlogReportThead');
  const tbody = document.getElementById('devlogReportTbody');
  if (!thead || !tbody) return;
  const headers = ['#', 'Type', 'Period', 'Duration', 'Distance (km)', 'Rows'];
  thead.innerHTML = '';
  const trh = document.createElement('tr');
  headers.forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  tbody.innerHTML = '';

  if (!intervals || !intervals.length) {
    tbody.innerHTML = '<tr><td colspan="100%">Нет данных. Нажмите «Dev Log».</td></tr>';
    return;
  }

  intervals.forEach((iv, idx) => {
    const tr = document.createElement('tr');
    tr.className = iv.isAnomaly ? 'text-rose-300' : (iv.type === 1 || iv.type === 3 ? 'text-amber-200' : '');
    const durSec = (iv.last.ts - iv.start.ts) / 1000;
    const cells = [
      String(idx + 1),
      TYPE_NAMES[iv.type] || String(iv.type),
      `${iv.start.wdate} — ${iv.last.wdate}`,
      `${Math.floor(durSec / 3600)}:${String(Math.floor((durSec % 3600) / 60)).padStart(2, '0')}:${String(Math.round(durSec % 60)).padStart(2, '0')}`,
      ((iv.distance || 0) / 1000).toFixed(3),
      String(iv.rows.length),
    ];
    cells.forEach((c) => {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    });
    tr.addEventListener('click', () => focusIntervalRows(iv));
    tbody.appendChild(tr);
  });
}

function focusIntervalRows(iv) {
  highlighted = new Set(iv.rows);
  renderLogTable();
  if (logMount && iv.rows.length) logMount.scrollToIndex(iv.rows[0]);
  setTimeout(() => {
    highlighted = new Set();
    renderLogTable();
  }, 8000);
}
