// Анализ маршрута: питание/спутники/напряжение/аномалии трека — сегменты на карте + таблица.
// Сводка сгруппирована по типам проблем (как в оригинальном проекте): вхождения,
// точки, суммарная длительность/дистанция, средние (по точкам) скорость/напряжение/
// спутники; клик по строке — переход на карту (fitBounds + мигание слоёв).
// Палитра и названия проблем совпадают с оригиналом (TRACK_ISSUE_META).

import { getTrackLayer, getMap, currentLineWidth } from '../core/map-core.js';
import { getAnomalySettings } from '../core/config.js';
import { parseTrackDate, formatDate, getField, haversineM, showToast, escapeHtml } from '../core/utils.js';
import { state, emit } from './state.js';
import { registerTab } from './tabs.js';
import { loadDeviceData } from './logs.js';

const ISSUES = {
  LOW_SATELLITES: { name: 'Мало спутников', color: '#FFD600' },
  LOW_VOLTAGE: { name: 'Низкое значение batvoltage', color: '#FF9800' },
  MOVEMENT_WITHOUT_POWER: { name: 'Движение без питания', color: '#000000' },
  TRACK_ANOMALY: { name: 'Аномалия трека', color: '#E91E63' },
  ALTITUDE_SPIKE: { name: 'Аномалия высоты', color: '#795548' },
  NONE: { name: 'Без ошибок', color: '#4CAF50' },
};

// Приоритет цвета сегмента с несколькими проблемами — как в оригинале
const ISSUE_PRIORITY = [
  'MOVEMENT_WITHOUT_POWER',
  'LOW_VOLTAGE',
  'TRACK_ANOMALY',
  'LOW_SATELLITES',
  'ALTITUDE_SPIKE',
];

let segments = [];        // {points, issues:Set, layer, anomalyLayers[], stats, distanceM, durationMs}
let anomalyOverlays = []; // розовые линии аномалий (по парам точек, как в оригинале)
let viewMode = 'summary'; // 'summary' | 'chrono'
let hideOk = true;
let rendered = false;
let tabAutoHide = false;  // дашборд: вкладку анализа показываем только когда есть данные

// Дашборд: скрывать вкладку анализа до загрузки данных (аналог вкладок топлива)
export function setTabAutoHide(v) {
  tabAutoHide = !!v;
  if (tabAutoHide) applyAnalysisTab(false);
}

function applyAnalysisTab(visible) {
  const tabBtn = document.querySelector('.tab-btn[data-tab="analysis"]');
  const panel = document.querySelector('.tab-panel[data-panel="analysis"]');
  if (tabBtn) tabBtn.style.display = visible ? '' : 'none';
  if (panel) panel.style.display = visible ? '' : 'none';
  if (!visible) {
    const active = document.querySelector('.tab-btn.active');
    if (active && active.dataset.tab === 'analysis') {
      const stops = document.querySelector('.tab-btn[data-tab="stops"]');
      if (stops) stops.click();
    }
  }
}

export function initAnalysis() {
  registerTab({
    id: 'analysis',
    title: 'Анализ',
    getRows: () => buildTableRows(),
    render: () => { rendered = true; renderAnalysisTable(); },
    onShow: () => { rendered = true; renderAnalysisTable(); },
  });

  document.getElementById('analysisViewChrono').addEventListener('click', () => {
    viewMode = 'chrono';
    updateViewButtons();
    renderAnalysisTable();
  });
  document.getElementById('analysisViewSummary').addEventListener('click', () => {
    viewMode = 'summary';
    updateViewButtons();
    renderAnalysisTable();
  });
  document.getElementById('analysisHideOk').addEventListener('click', () => {
    hideOk = !hideOk;
    updateHideOkBtn();
    renderAnalysisTable();
  });
  updateViewButtons();
  updateHideOkBtn();
}

// Активная кнопка — без .btn-secondary (синий .btn), неактивная — серая.
// (toggle bg-brand-600 не работает: .btn.btn-secondary сильнее одиночного bg-brand-600)
function updateViewButtons() {
  const chrono = document.getElementById('analysisViewChrono');
  const summary = document.getElementById('analysisViewSummary');
  if (!chrono || !summary) return;
  chrono.classList.toggle('btn-secondary', viewMode !== 'chrono');
  summary.classList.toggle('btn-secondary', viewMode !== 'summary');
}

function updateHideOkBtn() {
  const btn = document.getElementById('analysisHideOk');
  if (btn) btn.classList.toggle('btn-secondary', !hideOk);
}

export function loadAnalysis() {
  if (!state.deviceId) { showToast('⚠ Сначала выберите ТС'); return; }
  clearAnalysis();
  showToast('Загрузка данных для анализа...');
  loadDeviceData({ analysis: true });
  // Вкладка «Анализ» отобразится автоматически при появлении результатов
}

export function runAnalysisFromRows(rows) {
  const points = parsePoints(rows);
  if (points.length < 2) { showToast('Недостаточно точек для анализа'); return; }
  clearAnalysis();
  analyze(points);
  renderMapSegments();
  renderAnalysisAnomalies(points);
  renderAnalysisTable();
  applyAnalysisTab(true); // дашборд: вкладка анализа видна, когда есть данные
  const btn = document.querySelector('.tab-btn[data-tab="analysis"]');
  if (btn) btn.click();
  showToast(`Анализ завершён: ${segments.length} сегментов`);
}

export function clearAnalysis() {
  const layer = getTrackLayer();
  if (layer) {
    segments.forEach((s) => {
      try { layer.removeLayer(s.layer); } catch (e) {}
      (s.anomalyLayers || []).forEach((l) => { try { layer.removeLayer(l); } catch (e) {} });
    });
    anomalyOverlays.forEach((l) => { try { layer.removeLayer(l); } catch (e) {} });
  }
  segments = [];
  anomalyOverlays = [];
  if (rendered) renderAnalysisTable();
  const summary = document.getElementById('analysisSummary');
  if (summary) summary.textContent = '';
  if (tabAutoHide) applyAnalysisTab(false); // дашборд: скрываем вкладку до новых данных
}

// ---------- Парсинг ----------
function parsePoints(rows) {
  const out = [];
  rows.forEach((r, idx) => {
    const lat = parseFloat(getField(r, ['latitude', 'lat']));
    const lng = parseFloat(getField(r, ['longitude', 'lon', 'lng']));
    const d = parseTrackDate(String(getField(r, ['wdate', 'sdate', 'date']) || ''));
    if (!isFinite(lat) || !isFinite(lng) || !d) return;
    const satRaw = getField(r, ['satelites', 'satellites', 'sat']);
    const voltRaw = getField(r, ['batvoltage', 'voltage']);
    out.push({
      lat, lng, ts: d.getTime(), wdate: String(getField(r, ['wdate', 'sdate', 'date']) || ''),
      speed: parseFloat(getField(r, ['speed'])) || 0,
      // null = поле отсутствует (как в оригинале): не участвует в детекте и средних
      sat: satRaw == null || satRaw === '' ? null : (parseInt(satRaw, 10) || 0),
      ignition: !!getField(r, ['ignition']),
      ismoves: !!getField(r, ['ismoves']),
      voltage: voltRaw == null || voltRaw === '' ? null : (parseFloat(voltRaw) || 0),
      altitude: parseFloat(getField(r, ['altitude', 'alt'])) || 0,
      idx,
    });
  });
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// ---------- Детект проблем (правила — как в оригинале) ----------
function detectIssues(points) {
  const s = getAnomalySettings();
  points.forEach((p, i) => {
    p.issues = new Set();
    if (p.sat != null && p.sat < 6) p.issues.add('LOW_SATELLITES');
    if (p.voltage != null && p.voltage < 12) p.issues.add('LOW_VOLTAGE');
    if (i > 0) {
      const prev = points[i - 1];
      const dt = p.ts - prev.ts;
      const dist = haversineM(prev.lat, prev.lng, p.lat, p.lng);
      if (!p.ignition && (p.ismoves || dist > 20)) p.issues.add('MOVEMENT_WITHOUT_POWER');
      const calcKmh = dt > 0 ? dist / (dt / 1000) * 3.6 : 0;
      if (dt > s.gapThresholdMs) p.issues.add('TRACK_ANOMALY');
      if (calcKmh > s.speedThresholdKph) p.issues.add('TRACK_ANOMALY');
      // Скачок позиции: расчётная скорость выше порога при низкой заявленной
      if (calcKmh > s.jumpSpeedThresholdKph && p.speed < s.realSpeedThresholdKph) p.issues.add('TRACK_ANOMALY');
      if (dist >= s.positionJumpDistanceM) p.issues.add('TRACK_ANOMALY');
      if (Math.abs(p.altitude - prev.altitude) > 500) p.issues.add('ALTITUDE_SPIKE');
      // Статичное «движение»: скорость ноль, а смещение существенное
      if (p.speed === 0 && dist > 50) p.issues.add('TRACK_ANOMALY');
    }
  });
}

function sameIssues(a, b) {
  if (a.issues.size !== b.issues.size) return false;
  for (const k of a.issues) if (!b.issues.has(k)) return false;
  return true;
}

// Сегмент из массива точек со своими агрегатами (длительность, дистанция, средние;
// null-спутники/напряжение пропускаются — как в оригинале)
function makeSegment(points) {
  const issues = points[points.length - 1].issues;
  const first = points[0];
  const last = points[points.length - 1];
  let dist = 0;
  let sumSpeed = 0, sumVoltage = 0, sumSat = 0, nVoltage = 0, nSat = 0;
  points.forEach((p, i) => {
    sumSpeed += p.speed;
    if (p.voltage != null) { sumVoltage += p.voltage; nVoltage++; }
    if (p.sat != null) { sumSat += p.sat; nSat++; }
    if (i > 0) dist += haversineM(points[i - 1].lat, points[i - 1].lng, p.lat, p.lng);
  });
  const n = points.length;
  return {
    points,
    issues,
    startTs: first.ts, endTs: last.ts,
    startW: first.wdate, endW: last.wdate,
    distanceM: dist,
    durationMs: Math.max(0, last.ts - first.ts),
    stats: {
      avgSpeed: sumSpeed / n,
      avgVoltage: nVoltage > 0 ? sumVoltage / nVoltage : 0,
      avgSatellites: nSat > 0 ? sumSat / nSat : 0,
    },
    ok: issues.size === 0,
  };
}

function analyze(points) {
  detectIssues(points);
  const raw = [];
  let cur = null;
  points.forEach((p) => {
    if (cur && sameIssues(cur[cur.length - 1], p) && p.ts - cur[cur.length - 1].ts < 60000) {
      cur.push(p);
    } else {
      if (cur) raw.push(cur);
      cur = [p];
    }
  });
  if (cur) raw.push(cur);
  segments = raw.map(makeSegment);
  // «Аномалия трека»: длительность/дистанция считаются по соседним точкам (как в v2) —
  // берём точку ДО начала сегмента и точку ПОСЛЕ его конца: внутренние точки
  // аномального сегмента часто имеют нулевую/неверную дельту времени и нулевой путь.
  let pos = 0;
  segments.forEach((seg) => {
    const a = pos;
    const b = pos + seg.points.length - 1;
    pos = b + 1;
    if (!seg.issues || !seg.issues.has('TRACK_ANOMALY')) return;
    const before = a > 0 ? points[a - 1] : null;
    const after = b < points.length - 1 ? points[b + 1] : null;
    if (before) {
      seg.distanceM += haversineM(before.lat, before.lng, seg.points[0].lat, seg.points[0].lng);
      seg.durationMs += Math.max(0, seg.points[0].ts - before.ts);
      seg.startTs = before.ts;
    }
    if (after) {
      const lastPt = seg.points[seg.points.length - 1];
      seg.distanceM += haversineM(lastPt.lat, lastPt.lng, after.lat, after.lng);
      seg.durationMs += Math.max(0, after.ts - lastPt.ts);
      seg.endTs = after.ts;
    }
  });
}

// ---------- Карта ----------
// Главная проблема сегмента — по приоритету оригинала (движение без питания
// важнее мало спутников и т.д.) — определяет цвет линии на карте
function primaryIssue(seg) {
  if (!seg.issues || seg.issues.size === 0) return null;
  for (const k of ISSUE_PRIORITY) if (seg.issues.has(k)) return k;
  return null;
}

function issueKey(issues) {
  return [...issues].sort().join(',');
}

function renderMapSegments() {
  const layer = getTrackLayer();
  const map = getMap();
  const weight = currentLineWidth() * 3;
  const bounds = [];

  segments.forEach((seg) => {
    if (seg.points.length < 2) return;
    const latlngs = seg.points.map((p) => [p.lat, p.lng]);
    latlngs.forEach((ll) => bounds.push(ll));
    const key = primaryIssue(seg);
    const line = L.polyline(latlngs, {
      color: key ? ISSUES[key].color : '#0074D9',
      weight,
      opacity: 0.9,
    }).addTo(layer);
    line._isAnalysisPolyline = true;
    line.on('click', (e) => {
      if (window.__routeModeActive) return;
      showSegmentDetails(seg);
    });
    seg.layer = line;
  });

  if (bounds.length) {
    const b = L.latLngBounds(bounds);
    if (b.isValid()) map.fitBounds(b, { padding: [50, 50] });
  }
}

// Розовые линии аномалий — по парам соседних точек всего трека (как в оригинале):
// не зависят от сегментов, поэтому видны даже там, где вхождение — одна точка,
// и пересекают границы сегментов (разрывы, скачки позиции/скорости).
function renderAnalysisAnomalies(points) {
  const layer = getTrackLayer();
  if (!layer || !points || points.length < 2) return;
  const s = getAnomalySettings();
  const weight = Math.max(currentLineWidth() * 3 + 2, 3);
  const color = ISSUES.TRACK_ANOMALY.color;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dtMs = curr.ts - prev.ts;
    const dist = haversineM(prev.lat, prev.lng, curr.lat, curr.lng);
    const dtH = dtMs / 3600000;
    const calcKmh = dtH > 0 ? (dist / 1000) / dtH : 0;
    const reasons = [];
    if (dtMs > s.gapThresholdMs) reasons.push('Разрыв данных');
    if (calcKmh > s.speedThresholdKph) reasons.push('Скачок скорости');
    if (dist >= s.positionJumpDistanceM ||
        (calcKmh > s.jumpSpeedThresholdKph && curr.speed < s.realSpeedThresholdKph)) {
      reasons.push('Скачок позиции');
    }
    if (curr.speed === 0 && dist > 50) reasons.push('Статичное движение');
    if (!reasons.length) continue;
    const line = L.polyline([[prev.lat, prev.lng], [curr.lat, curr.lng]], {
      color, weight, opacity: 0.95,
    }).bindPopup(
      `<b>Аномалия трека</b><br>${reasons.join(', ')}` +
      `<br>От: ${escapeHtml(prev.wdate)}<br>До: ${escapeHtml(curr.wdate)}` +
      `<br>Расстояние: ${(dist / 1000).toFixed(2)} км` +
      `<br>Скорость: ${calcKmh.toFixed(2)} км/ч`
    ).addTo(layer);
    line._isAnalysisAnomaly = true;
    anomalyOverlays.push(line);
    // привязка к точкам — чтобы линия мигала при клике по строке таблицы
    (prev._anomalyOverlays = prev._anomalyOverlays || []).push(line);
    (curr._anomalyOverlays = curr._anomalyOverlays || []).push(line);
  }
}

function showSegmentDetails(seg) {
  const body = document.getElementById('analysisSegmentBody');
  if (!body) return;
  const dur = (seg.endTs - seg.startTs) / 1000;
  body.innerHTML = `
    <div class="space-y-1">
      <div><b>Время:</b> ${escapeHtml(seg.startW)} — ${escapeHtml(seg.endW)}</div>
      <div><b>Длительность:</b> ${Math.floor(dur / 3600)}:${String(Math.floor((dur % 3600) / 60)).padStart(2, '0')}:${String(Math.round(dur % 60)).padStart(2, '0')}</div>
      <div><b>Точек:</b> ${seg.points.length}</div>
      <div><b>Дистанция:</b> ${(seg.distanceM / 1000).toFixed(3)} км</div>
      <div><b>Проблемы:</b> ${seg.issues.size ? [...seg.issues].map((k) => `<span style="color:${ISSUES[k].color}">${ISSUES[k].name}</span>`).join(', ') : `<span style="color:${ISSUES.NONE.color}">нет</span>`}</div>
    </div>`;
  document.getElementById('analysisSegmentModal').classList.add('open');
}

// Переход на карту: вписать все точки записей и мигнуть их слоями
function fitEntriesOnMap(entries) {
  const latlngs = [];
  const layers = [];
  entries.forEach((seg) => {
    seg.points.forEach((p) => {
      latlngs.push([p.lat, p.lng]);
      (p._anomalyOverlays || []).forEach((l) => { if (layers.indexOf(l) === -1) layers.push(l); });
    });
    if (seg.layer) layers.push(seg.layer);
    (seg.anomalyLayers || []).forEach((l) => layers.push(l));
  });
  if (latlngs.length) {
    const b = L.latLngBounds(latlngs);
    if (b.isValid()) getMap().fitBounds(b, { padding: [50, 50], maxZoom: 15, animate: true });
  }
  if (layers.length) blinkAnalysisLayers(layers);
}

// Мигание слоёв: три вспышки толщиной/прозрачностью, потом исходный стиль
function blinkAnalysisLayers(layers) {
  const items = layers.filter(Boolean).map((l) => ({ l, opacity: l.options.opacity, weight: l.options.weight }));
  if (!items.length) return;
  let tick = 0;
  const timer = setInterval(() => {
    tick++;
    const on = tick % 2 === 1;
    items.forEach(({ l, opacity, weight }) => {
      try { l.setStyle({ opacity: on ? 1 : Math.max(0.15, opacity * 0.3), weight: on ? weight + 3 : weight }); } catch (e) {}
    });
    if (tick >= 6) {
      clearInterval(timer);
      items.forEach(({ l, opacity, weight }) => {
        try { l.setStyle({ opacity, weight }); } catch (e) {}
      });
    }
  }, 280);
}

// ---------- Таблица ----------
function formatDurationShort(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}

function formatDurationHms(ms) {
  const dur = Math.round(ms / 1000);
  return `${Math.floor(dur / 3600)}:${String(Math.floor((dur % 3600) / 60)).padStart(2, '0')}:${String(dur % 60).padStart(2, '0')}`;
}

// Группировка по типам проблем (сводка): одна строка на тип
function groupSegmentsByIssue() {
  const groups = new Map();
  segments.forEach((seg) => {
    const list = seg.issues.size ? [...seg.issues] : ['NONE'];
    list.forEach((issue) => {
      if (!groups.has(issue)) {
        groups.set(issue, {
          issue, count: 0, totalPoints: 0, totalDistanceM: 0, totalDurationMs: 0,
          weightSpeed: 0, weightVoltage: 0, weightSats: 0, entries: [],
        });
      }
      const g = groups.get(issue);
      const n = seg.points.length;
      g.count++;
      g.totalPoints += n;
      g.totalDistanceM += seg.distanceM;
      g.totalDurationMs += seg.durationMs;
      g.weightSpeed += seg.stats.avgSpeed * n;
      g.weightVoltage += seg.stats.avgVoltage * n;
      g.weightSats += seg.stats.avgSatellites * n;
      g.entries.push(seg);
    });
  });
  const rows = [...groups.values()].sort((a, b) => {
    if (a.issue === 'NONE' && b.issue !== 'NONE') return 1;
    if (a.issue !== 'NONE' && b.issue === 'NONE') return -1;
    return b.count - a.count;
  });
  return hideOk ? rows.filter((r) => r.issue !== 'NONE') : rows;
}

// Хронология: соседние сегменты с одинаковым набором проблем склеиваем в одну строку
function collapseSegments(list) {
  const out = [];
  list.forEach((seg) => {
    const last = out[out.length - 1];
    if (last && issueKey(last.issues) === issueKey(seg.issues) && seg.startTs - last.endTs < 60000) {
      last.points = last.points.concat(seg.points);
      const merged = makeSegment(last.points);
      last.endTs = merged.endTs;
      last.endW = merged.endW;
      last.distanceM = merged.distanceM;
      last.durationMs = merged.durationMs;
      last.stats = merged.stats;
    } else {
      out.push({ ...seg });
    }
  });
  return out;
}

// Строки для таблицы и экспорта; внутренние ссылки — ключи с __ (exportXls их пропускает)
function buildTableRows() {
  if (viewMode === 'summary') {
    return groupSegmentsByIssue().map((g) => ({
      'Проблема': ISSUES[g.issue].name,
      'Вхождений': String(g.count),
      'Точек': String(g.totalPoints),
      'Общ. длительность': formatDurationShort(g.totalDurationMs),
      'Сред. скор.': (g.totalPoints > 0 ? g.weightSpeed / g.totalPoints : 0).toFixed(1),
      'Напряжение/Заряд': (g.totalPoints > 0 ? g.weightVoltage / g.totalPoints : 0).toFixed(1),
      'Спутн.': (g.totalPoints > 0 ? g.weightSats / g.totalPoints : 0).toFixed(1),
      'Расстояние, км': (g.totalDistanceM / 1000).toFixed(2),
      __group: g,
    }));
  }
  const display = collapseSegments(segments).filter((seg) => !hideOk || !seg.ok);
  return display.map((seg) => ({
    'Начало': seg.startW,
    'Конец': seg.endW,
    'Проблемы': seg.issues.size ? [...seg.issues].map((k) => ISSUES[k].name).join('; ') : ISSUES.NONE.name,
    'Длительность': formatDurationHms(seg.durationMs),
    'Точек': String(seg.points.length),
    'Сред. скор.': seg.stats.avgSpeed.toFixed(1),
    'Напряжение/Заряд': seg.stats.avgVoltage.toFixed(1),
    'Спутн.': seg.stats.avgSatellites.toFixed(1),
    'Расстояние, км': (seg.distanceM / 1000).toFixed(2),
    __seg: seg,
  }));
}

function colorDot(color) {
  const span = document.createElement('span');
  span.style.display = 'inline-block';
  span.style.width = '12px';
  span.style.height = '12px';
  span.style.borderRadius = '50%';
  span.style.background = color;
  // тёмные цвета (напр. чёрное «Движение без питания») на тёмном фоне — с светлой окантовкой
  if (isDarkColor(color)) span.style.border = '1px solid #9ca3af';
  return span;
}

// Слишком тёмный цер для текста на тёмном фоне заменяем светло-серым
function isDarkColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return false;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) < 90;
}
function uiIssueColor(key) {
  const c = (ISSUES[key] && ISSUES[key].color) || '#9ca3af';
  return isDarkColor(c) ? '#9ca3af' : c;
}

function renderAnalysisTable() {
  if (!rendered) return;
  const thead = document.getElementById('analysisThead');
  const tbody = document.getElementById('analysisTbody');
  if (!thead || !tbody) return;
  const rows = buildTableRows();

  thead.innerHTML = '';
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="100%">Нет данных. Нажмите «Анализ».</td></tr>';
    updateSummaryLine();
    return;
  }

  // цветная ячейка-метка в начале каждой строки
  const headers = ['', ...Object.keys(rows[0]).filter((k) => !k.startsWith('__'))];
  const trh = document.createElement('tr');
  headers.forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';

    const issue = row.__group ? row.__group.issue : (row.__seg ? (primaryIssue(row.__seg) || 'NONE') : 'NONE');
    const meta = ISSUES[issue] || ISSUES.NONE;
    const tdDot = document.createElement('td');
    tdDot.appendChild(colorDot(meta.color));
    tr.appendChild(tdDot);

    headers.slice(1).forEach((h) => {
      const td = document.createElement('td');
      if (h === 'Проблема' || h === 'Проблемы') {
        // подсветка текста проблемы цветом типа; несколько проблем — по частям
        const value = String(row[h]);
        const parts = value.split('; ');
        parts.forEach((part, i) => {
          if (i > 0) td.appendChild(document.createTextNode('; '));
          const found = Object.keys(ISSUES).find((k) => ISSUES[k].name === part);
          const span = document.createElement('span');
          span.textContent = part;
          if (found) span.style.color = uiIssueColor(found);
          td.appendChild(span);
        });
      } else {
        td.textContent = String(row[h]);
      }
      tr.appendChild(td);
    });

    const entries = row.__group ? row.__group.entries : (row.__seg ? [row.__seg] : []);
    tr.addEventListener('click', () => { if (entries.length) fitEntriesOnMap(entries); });
    tr.addEventListener('dblclick', () => {
      const seg = row.__seg || (row.__group && row.__group.entries[0]);
      if (seg) showSegmentDetails(seg);
    });
    tbody.appendChild(tr);
  });

  updateSummaryLine();
}

function updateSummaryLine() {
  const summary = document.getElementById('analysisSummary');
  if (!summary) return;
  const okCount = segments.filter((s) => s.ok).length;
  const groups = groupSegmentsByIssue();
  const problemTypes = groups.filter((g) => g.issue !== 'NONE').length;
  summary.innerHTML = segments.length
    ? `<span style="color:${ISSUES.NONE.color}">✅ ${okCount} норм.</span> &nbsp; <span style="color:#F44336;">⚠️ ${problemTypes} типов проблем</span>`
    : '';
}
