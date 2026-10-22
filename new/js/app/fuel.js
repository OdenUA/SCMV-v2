// Отчёт по топливу: запрос 'Fuel Litres' автоматически с телеметрией/сырым треком,
// детект заправок/сливов по модели «эпизоды + установившиеся уровни»:
// ряд точек режется на эпизоды движения/стоянки (по разрывам записи и скорости
// шагов), события ищутся только между стояночными эпизодами в одном месте как
// разница медианных («установившихся») уровней с их краёв — ступеньки датчика
// (~0.8 л) и пила ±10 л на медиану не влияют; движущиеся эпизоды дают только
// расход, события на ходу отсекаются структурно, а не порогом; заправка, попавшая
// в разрыв записи (трекер на стоянке пишет раз в 15 мин), восстанавливается
// склейкой кандидатов и помечается «через разрыв»; суб-пороговые скачки уровня
// через разрывы видны в сводке («Через разрывы, л»).
// Вкладки: Заправки и сливы / Сводка по бакам / Суточная таблица,
// линия топлива на графике телеметрии.

import { onPacket, sendRequest } from '../core/ws.js';
import {
  parseTrackDate, formatDate, haversineM, populateTable, showToast, escapeHtml,
} from '../core/utils.js';
import { getFuelLayer, getMap } from '../core/map-core.js';
import { state, on } from './state.js';
import { registerTab } from './tabs.js';
import * as speedChart from './speed-chart.js';

// Пороги детектора (все — в этих константах)
const MIN_REFUEL_L = 10;             // мин. объём заправки
const MIN_DRAIN_L = 10;              // мин. объём слива
const SPIKE_FILTER_L = 5;            // одноточечный выброс датчика (>5 л от интерполяции соседей)
const MOTO_H_STEP = 0.25;            // шаги длиннее 15 мин не считаем моточасами
const GPS_GAP_KM = 3;                // разрыв трека по расстоянию (пробег/моточасы)

// Модель «эпизоды + установившиеся уровни»
const MOVE_KPH = 5;                  // граница движение/стоянка по скорости шага
const GAP_MIN_MS = 5 * 60 * 1000;    // разрыв записи — граница эпизодов
const SETTLE_MIN_MS = 3 * 60 * 1000; // окно установившегося уровня с края эпизода
const SAME_PLACE_KM = 0.5;           // эпизоды «в одном месте» (кандидаты/слияние)
const GAP_EVENT_MAX_MIN = 45;        // макс. длина разрыва для события «через разрыв»
const MERGE_MIN_MS = 45 * 60 * 1000; // склейка кандидатов одной заправки/слива
const MIN_EVENT_RATE_LPH = 40;       // медленнее — дрейф датчика/холостой расход, не событие (реальный перелив — сотни л/ч)
// Удержание уровня после события: колебание датчика откатывается почти сразу,
// реальная заправка/слив держат новый уровень. Допуск асимметричен: после заправки
// машина часто сразу трогается (расход давит уровень вниз) — 50% объёма; после слива
// уровень сам не растёт (максимум — перетекание между секциями бака) — 30%.
const HOLD_MS = 10 * 60 * 1000;      // окно удержания уровня после события
const HOLD_MIN_L = 3;                // абсолютный допуск шума датчика, л
const REFUEL_DROP_RATIO = 0.5;       // откат ≥50% объёма заправки — колебание
const DRAIN_RISE_RATIO = 0.3;        // откат ≥30% объёма слива — колебание

const FUEL_TABS = ['fuel-events', 'fuel-summary', 'fuel-daily'];

let expecting = false;
let rendered = { events: false, summary: false, daily: false };

// Вкладки топлива показываем только когда данные загружены (устройство + период)
function applyFuelTabs(visible) {
  FUEL_TABS.forEach((id) => {
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${id}"]`);
    const panel = document.querySelector(`.tab-panel[data-panel="${id}"]`);
    if (tabBtn) tabBtn.style.display = visible ? '' : 'none';
    if (panel) panel.style.display = visible ? '' : 'none';
  });
  if (!visible) {
    const active = document.querySelector('.tab-btn.active');
    if (active && FUEL_TABS.indexOf(active.dataset.tab) !== -1) {
      const stops = document.querySelector('.tab-btn[data-tab="stops"]');
      if (stops) stops.click();
    }
  }
}

export function initFuel() {
  const respondFuel = (data) => {
    if (!expecting) return false;
    expecting = false;
    const rows = data.res && data.res[0] && data.res[0].f;
    if (!Array.isArray(rows)) {
      console.warn('[fuel] ответ без строк:', JSON.stringify(data).slice(0, 300));
      showToast('Топливо: сервер вернул ответ без данных');
      return true;
    }
    console.log('[fuel] получено строк:', rows.length);
    processFuelData(rows);
    return true;
  };
  onPacket('Fuel Litres', respondFuel, { priority: 5 });
  onPacket('Fuel Report', respondFuel, { priority: 5 });

  registerTab({
    id: 'fuel-events', title: 'Заправки и сливы',
    getRows: () => state.fuelEvents.map((e) => ({
      'Дата/время': e.time, 'Тип': e.type === 'refuel' ? 'Заправка' : 'Слив',
      'Объем, л': e.volume.toFixed(1),
      'Было, л': e.before != null ? e.before.toFixed(1) : '—',
      'Стало, л': e.after != null ? e.after.toFixed(1) : '—',
      'Основание': e.viaGap ? 'через разрыв' : 'наблюдается',
      'Координаты': `${e.lat.toFixed(6)}, ${e.lng.toFixed(6)}`,
    })),
    render: renderEvents, onShow: renderEvents,
  });
  registerTab({
    id: 'fuel-summary', title: 'Сводка по бакам',
    getRows: () => (state.fuelSummary ? [state.fuelSummary.row] : []),
    render: renderSummary, onShow: renderSummary,
  });
  registerTab({
    id: 'fuel-daily', title: 'Суточная таблица',
    getRows: () => state.fuelDaily.map((d) => d.row),
    render: renderDaily, onShow: renderDaily,
  });

  // Смена ТС — очистка; перезапрос выполняется вместе с телеметрией/сырым треком
  on('vehicle-selected', () => {
    clearFuelData();
  });

  applyFuelTabs(false);
  updateFuelKpis();
}

/** Смена дат (вызывается из bootstrap): очистка; перезапрос — с телеметрией. */
export function onDatesChanged() {
  clearFuelData();
}

/** Запрос Fuel Litres. Вызывается при загрузке телеметрии/сырого трека. */
export function requestFuel() {
  if (!state.deviceId) return;
  const fromEl = document.getElementById('startDate');
  const toEl = document.getElementById('endDate');
  const build = (raw, isEnd) => {
    if (!raw) return '';
    if (raw.length === 16) raw += isEnd ? ':59' : ':00';
    return raw;
  };
  expecting = true;
  sendRequest({
    name: 'Fuel Litres', type: 'etbl', mid: 2, act: 'filter',
    filter: [
      { selectedpgdatefrom: [build(fromEl ? fromEl.value : '', false)] },
      { selectedvihicleid: [state.deviceId] },
      { selectedpgdateto: [build(toEl ? toEl.value : '', true)] },
    ],
    lang: 'en',
  });
}

// KPI-бейджи: расход топлива (и на 100 км) и моточасы из сводки
function updateFuelKpis() {
  const consEl = document.getElementById('statFuelConsumption');
  const motoEl = document.getElementById('statFuelMotoHours');
  const s = state.fuelSummary;
  if (consEl) {
    const avg = s ? s.row['Ср. расход, л/100км'] : null;
    consEl.textContent = s
      ? (avg && avg !== '—' ? `${s.row['Расход, л']} л · ${avg}/100км` : `${s.row['Расход, л']} л`)
      : '—';
  }
  if (motoEl) motoEl.textContent = s ? `${s.row['Моточасы, ч']} ч` : '—';
}

function clearFuelData() {
  state.fuelPoints = [];
  state.fuelEvents = [];
  state.fuelDaily = [];
  state.fuelSummary = null;
  speedChart.setFuelPoints(null);
  speedChart.clearEvent();
  const group = getFuelLayer();
  if (group) group.clearLayers();
  renderEvents(); renderSummary(); renderDaily();
  updateFuelKpis();
  applyFuelTabs(false);
}

// ---------- Обработка данных ----------
function processFuelData(rows) {
  const points = [];
  rows.forEach((r) => {
    const liters = parseFloat(r.liters);
    const lat = parseFloat(r.latitude);
    const lng = parseFloat(r.longitude);
    const d = parseTrackDate(String(r.wdate || ''));
    if (!isFinite(liters) || liters <= 0.1) return; // «игнорировать нули»
    if (!isFinite(lat) || !isFinite(lng) || !d) return;
    points.push({ liters, lat, lng, ts: d.getTime(), wdate: formatDate(d) });
  });
  points.sort((a, b) => a.ts - b.ts);
  const filtered = filterSpikes(points);
  console.log(`[fuel] после фильтра валидных точек: ${filtered.length} из ${rows.length}`);
  if (filtered.length < 2) {
    showToast(`Топливо: недостаточно данных (${filtered.length} валидных точек из ${rows.length})`);
    return;
  }
  const det = detectEvents(filtered);
  const daily = calculateDaily(filtered, det.events);
  const summary = calculateSummary(filtered, det.events, daily, det.unaccounted);

  state.fuelPoints = filtered;
  state.fuelEvents = det.events;
  state.fuelDaily = daily;
  state.fuelSummary = summary;

  speedChart.setFuelPoints(points);
  rebuildFuelMarkers();
  renderEvents(); renderSummary(); renderDaily();
  updateFuelKpis();
  applyFuelTabs(true);
  showToast(`Топливо: заправок ${summary.refuelCount}, сливов ${summary.drainCount}`);
}

// Маркеры событий на карте: зелёный — заправка, красный — слив, пунктир — событие
// «через разрыв» (часть объёма восстановлена по точкам с двух сторон разрыва записи)
function rebuildFuelMarkers() {
  const group = getFuelLayer();
  if (!group) return;
  group.clearLayers();
  state.fuelEvents.forEach((ev) => {
    const isRefuel = ev.type === 'refuel';
    const icon = L.divIcon({
      className: '',
      html: `<div class="fuel-event-marker ${isRefuel ? 'fuel-refuel' : 'fuel-drain'}${ev.viaGap ? ' fuel-gap' : ''}"><i class="fa-solid fa-gas-pump"></i></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    const marker = L.marker([ev.lat, ev.lng], { icon, zIndexOffset: 900 }).addTo(group);
    marker.bindPopup(
      `<div class="popup-title" style="color:${isRefuel ? '#6ee7b7' : '#fca5a5'}">${isRefuel ? 'Заправка' : 'Слив'}</div>` +
      `Время: ${ev.time}<br>Объём: <b>${ev.volume.toFixed(1)} л</b>` +
      (ev.before != null ? `<br>Уровень: ${ev.before.toFixed(1)} → ${ev.after.toFixed(1)} л` : '') +
      (ev.viaGap ? '<br><i class="fa-solid fa-triangle-exclamation"></i> часть объёма — через разрыв записи' : '') +
      `<br>Координаты: ${ev.lat.toFixed(6)}, ${ev.lng.toFixed(6)}`
    );
    marker.on('click', () => speedChart.showEventAt(ev.ts));
    ev.markerRef = marker;
  });
}

// Клик по событию в таблице: показать на карте и линией на графике телеметрии
function focusFuelEvent(ev) {
  speedChart.showEventAt(ev.ts);
  if (ev.markerRef) {
    const map = getMap();
    map.setView(ev.markerRef.getLatLng(), Math.max(map.getZoom(), 14));
    setTimeout(() => ev.markerRef.openPopup(), 50);
  }
}

// Одноточечные выбросы датчика: точка, которая скачет относительно линейной
// интерполяции между соседями больше чем на SPIKE_FILTER_L, а сами соседи
// близки друг к другу — выброс (на графике из тысяч точек не виден, а детектор
// событий считал его сливом/заправкой).
function filterSpikes(points) {
  if (points.length < 3) return points;
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    const next = points[i + 1];
    if (prev && next) {
      const f = (p.ts - prev.ts) / ((next.ts - prev.ts) || 1);
      const expected = prev.liters + (next.liters - prev.liters) * Math.min(1, Math.max(0, f));
      if (Math.abs(p.liters - expected) >= SPIKE_FILTER_L &&
          Math.abs(next.liters - prev.liters) <= SPIKE_FILTER_L) {
        continue; // пропускаем выброс
      }
    }
    out.push(p);
  }
  return out;
}

function distKm(a, b) {
  return haversineM(a.lat, a.lng, b.lat, b.lng) / 1000;
}

// ---------- Детектор: эпизоды + установившиеся уровни ----------

// Эпизод = участок записи между разрывами (dt > GAP_MIN_MS) и переходами
// движение/стоянка (скорость шага через MOVE_KPH). Движущиеся эпизоды — только
// расход: события топлива на ходу физически невозможны, отсекаются структурно.
function segmentEpisodes(points) {
  const n = points.length;
  const moving = new Array(n).fill(false); // moving[i]: точка i принадлежит движению
  for (let i = 1; i < n; i++) {
    const dt = points[i].ts - points[i - 1].ts;
    const speed = dt > 0 ? distKm(points[i - 1], points[i]) / (dt / 3600000) : 0;
    moving[i] = speed > MOVE_KPH;
    if (i === 1) moving[0] = moving[1];
  }
  const eps = [];
  let start = 0;
  for (let i = 1; i <= n; i++) {
    const boundary = i === n ||
      points[i].ts - points[i - 1].ts > GAP_MIN_MS ||
      moving[i] !== moving[i - 1];
    if (boundary) {
      eps.push({
        stationary: !moving[start],
        startIdx: start,
        endIdx: i - 1,
        points: points.slice(start, i),
      });
      start = i;
    }
  }
  return eps;
}

// Установившийся уровень с края эпизода: медиана за SETTLE_MIN_MS. Медиана не
// реагирует на ступеньки датчика (~0.8 л) и пилу ±10 л — события считаем по ней,
// а не по отдельным точкам или экстремумам перехода.
function settledLevel(ep, fromEnd) {
  const pts = ep.points;
  if (pts.length === 1) return pts[0].liters;
  const edgeTs = fromEnd ? pts[pts.length - 1].ts : pts[0].ts;
  const win = [];
  for (let i = 0; i < pts.length; i++) {
    const dt = fromEnd ? (edgeTs - pts[i].ts) : (pts[i].ts - edgeTs);
    if (dt <= SETTLE_MIN_MS) win.push(pts[i].liters);
  }
  const src = win.length >= 2 ? win : pts.map((p) => p.liters);
  const s = src.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Кандидаты: разница установившихся уровней внутри стояночного эпизода и между
// соседними стояночными эпизодами в одном месте через разрыв записи (флаг
// viaGap — туда попадают «скрытые» заправки: трекер на стоянке пишет раз в 15 мин).
function collectCandidates(points, eps) {
  const cands = [];
  for (let i = 0; i < eps.length; i++) {
    const ep = eps[i];
    if (!ep.stationary) continue;
    const s0 = settledLevel(ep, false);
    const s1 = settledLevel(ep, true);
    if (Math.abs(s1 - s0) >= 1) {
      cands.push({
        dir: s1 > s0 ? 'refuel' : 'drain',
        before: s0, after: s1,
        startIdx: ep.startIdx, endIdx: ep.endIdx,
        viaGap: false,
      });
    }
    const next = eps[i + 1];
    if (!next || !next.stationary) continue;
    const gapMin = (points[next.startIdx].ts - points[ep.endIdx].ts) / 60000;
    const placeKm = distKm(points[ep.endIdx], points[next.startIdx]);
    if (gapMin <= GAP_EVENT_MAX_MIN && placeKm <= SAME_PLACE_KM) {
      const ns0 = settledLevel(next, false);
      if (Math.abs(ns0 - s1) >= 1) {
        cands.push({
          dir: ns0 > s1 ? 'refuel' : 'drain',
          before: s1, after: ns0,
          startIdx: ep.endIdx, endIdx: next.startIdx,
          viaGap: true,
        });
      }
    }
  }
  return cands;
}

// Склейка кандидатов одного события: одинаковое направление, одно месте,
// интервалы в пределах MERGE_MIN_MS. Так заправка 09:37–09:57 складывается в
// одно событие ~300 л: видимые края + скрытая часть через разрыв записи.
function mergeCandidates(points, cands) {
  const sorted = cands.slice().sort((a, b) => points[a.startIdx].ts - points[b.startIdx].ts);
  const out = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && last.dir === c.dir &&
        points[c.startIdx].ts - points[last.endIdx].ts <= MERGE_MIN_MS &&
        distKm(points[last.endIdx], points[c.startIdx]) <= SAME_PLACE_KM) {
      last.after = c.after;
      last.endIdx = c.endIdx;
      last.viaGap = last.viaGap || c.viaGap;
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

// Время события: первое пересечение уровнем середины перехода; если переход
// целиком внутри разрыва записи — первая точка нового уровня после разрыва.
function transitionIndex(points, startIdx, endIdx, before, after) {
  const mid = (before + after) / 2;
  for (let i = startIdx; i <= endIdx; i++) {
    if (after > before ? points[i].liters >= mid : points[i].liters <= mid) return i;
  }
  return endIdx;
}

// Валидация: мин. объём, мин. скорость (медленнее — холостой расход/прогрев),
// удержание уровня после события. Удержание двойное: откат не более доли объёма
// (асимметрично: заправка 50%, слив 30%, мин. 3 л) и отсутствие выхода за полосу
// ±max(6 л, 35% объёма) после завершения перехода — длинная пила датчика отлична
// от события тем, что возвращается через полосу, реальное событие держит уровень.
function validateEvent(points, e) {
  const net = Math.abs(e.after - e.before);
  const minL = e.dir === 'refuel' ? MIN_REFUEL_L : MIN_DRAIN_L;
  if (net < minL) return false;
  const durH = Math.max(1 / 120, (points[e.endIdx].ts - points[e.startIdx].ts) / 3600000);
  if (net / durH < MIN_EVENT_RATE_LPH) return false;
  const dev = (l) => (e.dir === 'drain' ? l - e.after : e.after - l); // откат от нового уровня
  const band = Math.max(6, 0.35 * net);
  // завершение перехода: первая точка внутри полосы нового уровня
  let k = transitionIndex(points, e.startIdx, e.endIdx, e.before, e.after);
  while (k <= e.endIdx && dev(points[k].liters) > band) k++;
  let rollback = 0;
  let bandViolated = false;
  for (; k < points.length; k++) {
    if (points[k].ts - points[e.endIdx].ts > HOLD_MS) break;
    const d = dev(points[k].liters);
    rollback = Math.max(rollback, d);
    if (d > band) bandViolated = true;
  }
  if (bandViolated) return false;               // уровень не удержался — колебание
  const holdLimit = Math.max(HOLD_MIN_L, (e.dir === 'drain' ? DRAIN_RISE_RATIO : REFUEL_DROP_RATIO) * net);
  if (rollback >= holdLimit) return false;
  return true;
}

function detectEvents(points) {
  const eps = segmentEpisodes(points);
  const merged = mergeCandidates(points, collectCandidates(points, eps));
  const events = [];
  // Суб-пороговые, но ощутимые (≥ MIN_REFUEL_L) скачки через разрывы, не ставшие
  // событием по скорости/откату, — для сводки («Через разрывы, л»): видно, что
  // уровень менялся вне зоны наблюдения.
  let unaccounted = 0;
  for (const c of merged) {
    if (!validateEvent(points, c)) {
      if (c.viaGap && Math.abs(c.after - c.before) >= MIN_REFUEL_L) unaccounted += c.after - c.before;
      continue;
    }
    const idx = transitionIndex(points, c.startIdx, c.endIdx, c.before, c.after);
    events.push({
      type: c.dir,
      time: points[idx].wdate,
      ts: points[idx].ts,
      volume: Math.abs(c.after - c.before),
      lat: points[c.endIdx].lat, lng: points[c.endIdx].lng,
      before: c.before, after: c.after,
      viaGap: c.viaGap,
    });
  }
  return { events: cancelCompensatedPairs(events), unaccounted };
}

// Компенсированные пары: слив и заправка в одном месте (≤300 м) в течение ≤45 мин
// с близкими объёмами (±35%) — колебание датчика, а не перекачка топлива
function cancelCompensatedPairs(events) {
  const removed = new Set();
  for (let i = 0; i < events.length; i++) {
    if (removed.has(i)) continue;
    const a = events[i];
    if (a.type !== 'drain') continue;
    for (let j = i + 1; j < events.length; j++) {
      if (removed.has(j)) continue;
      const b = events[j];
      if (b.type !== 'refuel') continue;
      if (b.ts - a.ts > 45 * 60 * 1000) break;
      const dKm = haversineM(a.lat, a.lng, b.lat, b.lng) / 1000;
      if (dKm > 0.3) continue;
      const volMatch = Math.abs(b.volume - a.volume) <= 0.35 * Math.max(a.volume, b.volume);
      if (volMatch) {
        removed.add(i); removed.add(j);
        console.log('[fuel] компенсированная пара (колебание):', a.time, '→', b.time);
        break;
      }
    }
  }
  return events.filter((_, i) => !removed.has(i));
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function calculateDaily(points, events) {
  const days = new Map();
  let prev = null;
  points.forEach((p) => {
    const key = dayKey(p.ts);
    let d = days.get(key);
    if (!d) {
      d = { day: key, start: p.liters, end: p.liters, dist: 0, motoH: 0, refuel: 0, drain: 0 };
      days.set(key, d);
    }
    if (prev) {
      const dtH = (p.ts - prev.ts) / 3600000;
      const dd = distKm(prev, p);
      if (dtH > 0 && dtH <= MOTO_H_STEP && dd <= GPS_GAP_KM) {
        d.dist += dd;
        d.motoH += dtH;
      }
    }
    d.end = p.liters;
    prev = p;
  });
  events.forEach((ev) => {
    const d = days.get(dayKey(ev.ts));
    if (!d) return;
    if (ev.type === 'refuel') d.refuel += ev.volume;
    else d.drain += ev.volume;
  });
  return [...days.values()].map((d) => {
    const consumption = Math.max(0, d.start - d.end + d.refuel - d.drain);
    const avg = d.dist > 0.01 ? (consumption / d.dist) * 100 : null;
    return {
      ...d,
      row: {
        'День': d.day,
        'Начало, л': d.start.toFixed(1),
        'Конец, л': d.end.toFixed(1),
        'Заправки, л': d.refuel.toFixed(1),
        'Сливы, л': d.drain.toFixed(1),
        'Расход, л': consumption.toFixed(1),
        'Пробег, км': d.dist.toFixed(1),
        'Моточасы, ч': d.motoH.toFixed(1),
        'Ср. расход, л/100км': avg != null ? avg.toFixed(1) : '—',
      },
    };
  });
}

function calculateSummary(points, events, daily, unaccounted) {
  const refuelVol = events.filter((e) => e.type === 'refuel').reduce((s, e) => s + e.volume, 0);
  const drainVol = events.filter((e) => e.type === 'drain').reduce((s, e) => s + e.volume, 0);
  const refuelCount = events.filter((e) => e.type === 'refuel').length;
  const drainCount = events.filter((e) => e.type === 'drain').length;
  const start = points[0].liters;
  const end = points[points.length - 1].liters;
  const consumption = Math.max(0, start - end + refuelVol - drainVol);
  const dist = daily.reduce((s, d) => s + d.dist, 0);
  const motoH = daily.reduce((s, d) => s + d.motoH, 0);
  const avg = dist > 0.01 ? (consumption / dist) * 100 : null;
  return {
    refuelCount, drainCount, unaccounted,
    row: {
      'Бак': 'Топливный бак',
      'Начало, л': start.toFixed(1),
      'Заправок, шт': String(refuelCount),
      'Заправки, л': refuelVol.toFixed(1),
      'Сливов, шт': String(drainCount),
      'Сливы, л': drainVol.toFixed(1),
      'Через разрывы, л': unaccounted.toFixed(1),
      'Конец, л': end.toFixed(1),
      'Расход, л': consumption.toFixed(1),
      'Пробег, км': dist.toFixed(1),
      'Моточасы, ч': motoH.toFixed(1),
      'Ср. расход, л/100км': avg != null ? avg.toFixed(1) : '—',
    },
  };
}

// ---------- Рендер вкладок ----------
function renderEvents() {
  rendered.events = true;
  const thead = document.getElementById('fuelEventsThead');
  const tbody = document.getElementById('fuelEventsTbody');
  if (!thead || !tbody) return;
  const rows = state.fuelEvents.map((e) => ({
    'Дата/время': e.time,
    'Тип': e.type === 'refuel' ? 'Заправка' : 'Слив',
    'Объем, л': e.volume.toFixed(1),
    'Было, л': e.before != null ? e.before.toFixed(1) : '—',
    'Стало, л': e.after != null ? e.after.toFixed(1) : '—',
    'Основание': e.viaGap ? 'через разрыв' : 'наблюдается',
    'Координаты': `${e.lat.toFixed(6)}, ${e.lng.toFixed(6)}`,
  }));
  populateTable(tbody, thead, rows, {
    emptyMessage: 'Заправок и сливов не обнаружено.',
    rowClass: (r) => r['Тип'] === 'Заправка' ? 'text-emerald-300' : 'text-rose-300',
    onRowClick: (row) => {
      const i = rows.indexOf(row);
      const ev = state.fuelEvents[i];
      if (ev) focusFuelEvent(ev);
    },
  });
}

function renderSummary() {
  rendered.summary = true;
  const thead = document.getElementById('fuelSummaryThead');
  const tbody = document.getElementById('fuelSummaryTbody');
  if (!thead || !tbody) return;
  populateTable(tbody, thead, state.fuelSummary ? [state.fuelSummary.row] : [], {
    emptyMessage: 'Нет данных топлива. Загрузите телеметрию или сырой трек.',
  });
}

function renderDaily() {
  rendered.daily = true;
  const thead = document.getElementById('fuelDailyThead');
  const tbody = document.getElementById('fuelDailyTbody');
  if (!thead || !tbody) return;
  const rows = state.fuelDaily.map((d) => d.row);
  const totalRefuel = state.fuelDaily.reduce((s, d) => s + d.refuel, 0);
  const totalDrain = state.fuelDaily.reduce((s, d) => s + d.drain, 0);
  const totalDist = state.fuelDaily.reduce((s, d) => s + d.dist, 0);
  const totalMoto = state.fuelDaily.reduce((s, d) => s + d.motoH, 0);
  if (rows.length) {
    const first = state.fuelDaily[0];
    const last = state.fuelDaily[state.fuelDaily.length - 1];
    const cons = Math.max(0, first.start - last.end + totalRefuel - totalDrain);
    rows.push({
      'День': 'Итого',
      'Начало, л': first.start.toFixed(1),
      'Конец, л': last.end.toFixed(1),
      'Заправки, л': totalRefuel.toFixed(1),
      'Сливы, л': totalDrain.toFixed(1),
      'Расход, л': cons.toFixed(1),
      'Пробег, км': totalDist.toFixed(1),
      'Моточасы, ч': totalMoto.toFixed(1),
      'Ср. расход, л/100км': totalDist > 0.01 ? ((cons / totalDist) * 100).toFixed(1) : '—',
    });
  }
  populateTable(tbody, thead, rows, {
    emptyMessage: 'Нет данных топлива. Загрузите телеметрию или сырой трек.',
    rowClass: (r) => r['День'] === 'Итого' ? 'font-bold text-gray-100' : '',
  });
}
