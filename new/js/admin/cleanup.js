// Поиск аномалий (>3000 км за день) и генерация SQL для удаления «плохих» точек.
// Фаза 1: пробеги по Startstop accumulation (concurrency 10).
// Фаза 2: строго серийная загрузка треков Device Track по кандидатам.

import { onPacket, sendRequest, waitForPacket, echoValue } from '../core/ws.js';
import { auth } from '../core/auth.js';
import { isOutOfBounds } from '../core/config.js';
import {
  buildDeleteStatements,
  buildRecalcStatements,
  openSqlModal,
  parseTrackDate,
  showToast,
  splitRangeByDays,
} from '../core/utils.js';

const PHASE1_CONCURRENCY = 10;
const PHASE1_TIMEOUT_MS = 60000;
const TRACK_TIMEOUT_MS = 45000;
const MILEAGE_THRESHOLD_KM = 3000;

let inProgress = false;
let phase1Pending = new Map(); // key deviceId|YYYY-MM-DD -> meta
let phase1Queue = [];
let phase1Active = 0;
let phase1Done = 0;
let phase1Total = 0;
let candidates = [];
let sqlLines = [];
let watchdogId = null;
let handlerBound = false;

function pad2(n) { return String(n).padStart(2, '0'); }

function progress(text, percent) {
  const statusDiv = document.getElementById('reportStatus');
  const progressText = document.getElementById('reportProgress');
  const progressFill = document.getElementById('reportProgressFill');
  if (statusDiv) {
    statusDiv.classList.remove('hidden');
    statusDiv.classList.add('flex');
  }
  if (progressText) progressText.textContent = text;
  if (progressFill) progressFill.style.width = `${percent}%`;
}

function hideProgressSoon() {
  setTimeout(() => {
    const statusDiv = document.getElementById('reportStatus');
    if (statusDiv) {
      statusDiv.classList.add('hidden');
      statusDiv.classList.remove('flex');
    }
  }, 3000);
}

function ensureHandler() {
  if (handlerBound) return;
  handlerBound = true;
  onPacket('Startstop accumulation', handlePhase1Response, { priority: 8 });
  onPacket('Startstop Sum Result', handlePhase1Response, { priority: 8 });
}

/**
 * Запуск очистки аномалий.
 * @param {string[]} deviceIds ID устройств
 * @param {string} month 'YYYY-MM'
 * @param {function} onDone колбэк по завершении
 */
export function runAnomalyCleanup(deviceIds, month, onDone) {
  if (inProgress) {
    showToast('⚠ Процесс уже запущен...');
    return;
  }
  const parts = String(month || '').split('-');
  const year = parseInt(parts[0], 10);
  const mon = parseInt(parts[1], 10);
  if (!deviceIds.length || isNaN(year) || isNaN(mon)) {
    showToast('⚠ Заполните ID устройств и месяц');
    if (typeof onDone === 'function') onDone();
    return;
  }

  ensureHandler();

  const dates = [];
  const daysInMonth = new Date(year, mon, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    dates.push({ year, month: mon, day });
  }

  candidates = [];
  sqlLines = [];
  phase1Pending = new Map();
  phase1Queue = [];
  phase1Active = 0;
  phase1Done = 0;
  phase1Total = deviceIds.length * dates.length;
  inProgress = true;

  deviceIds.forEach((deviceId) => {
    dates.forEach((dateInfo) => phase1Queue.push({ deviceId, dateInfo }));
  });

  showToast('🧹 Поиск аномалий: шаг 1/2 — анализ пробегов...');
  startWatchdog();
  processPhase1Queue();

  // локальное завершение: по окончании фазы 2 или при досрочном выходе
  const finish = () => {
    inProgress = false;
    stopWatchdog();
    if (typeof onDone === 'function') {
      try { onDone(); } catch (e) { console.warn('onDone error', e); }
    }
  };

  runPhase2()
    .then(finish)
    .catch((e) => {
      console.warn('cleanup error', e);
      showToast('⚠ Ошибка очистки: ' + e.message);
      finish();
    });
}

// ---------- Фаза 1: пробеги ----------

function processPhase1Queue() {
  while (phase1Active < PHASE1_CONCURRENCY && phase1Queue.length > 0) {
    const task = phase1Queue.shift();
    phase1Active++;
    sendPhase1Request(task.deviceId, task.dateInfo);
  }
}

function sendPhase1Request(deviceId, dateInfo) {
  const dateFrom = `${dateInfo.year}-${pad2(dateInfo.month)}-${pad2(dateInfo.day)} 00:00:00`;
  const dateTo = `${dateInfo.year}-${pad2(dateInfo.month)}-${pad2(dateInfo.day)} 23:59:59`;
  const dateKey = `${dateInfo.year}-${pad2(dateInfo.month)}-${pad2(dateInfo.day)}`;

  phase1Pending.set(`${deviceId}|${dateKey}`, { deviceId, dateKey, _sentAt: Date.now() });

  sendRequest({
    name: 'Startstop accumulation',
    type: 'etbl',
    mid: 5,
    act: 'filter',
    filter: [
      { selecteduid: [auth.uid] },
      { selectedvihicleid: [deviceId] },
      { selectedpgdatefrom: [dateFrom] },
      { selectedpgdateto: [dateTo] },
    ],
    lang: 'en',
  });
}

function extractDateKey(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4}-\d{2}-\d{2})/);
  return m && m[1] ? m[1] : (String(s).split(' ')[0] || null);
}

function handlePhase1Response(data) {
  if (!inProgress || phase1Pending.size === 0) return false;

  const deviceId = echoValue(data, /vihicle/i) || echoValue(data, /vehicleid/i);
  const dateFrom = echoValue(data, /pgdatefrom/i);
  if (!deviceId || !dateFrom) return false;

  const dateKey = extractDateKey(dateFrom);
  let meta = dateKey ? phase1Pending.get(`${deviceId}|${dateKey}`) : null;
  if (!meta) {
    for (const [key, m] of phase1Pending) {
      if (String(m.deviceId) === String(deviceId) && extractDateKey(m.dateKey) === dateKey) {
        meta = m;
        phase1Pending.delete(key);
        break;
      }
    }
    if (!meta) return false;
  } else {
    phase1Pending.delete(`${deviceId}|${dateKey}`);
  }

  phase1Active = Math.max(0, phase1Active - 1);
  phase1Done++;

  const mileage = sumMileage(data, deviceId);
  if (mileage > MILEAGE_THRESHOLD_KM) {
    console.log('[cleanup] кандидат >3000 км:', deviceId, meta.dateKey, mileage);
    candidates.push({ deviceId: String(deviceId), dateKey: meta.dateKey, mileage });
  }

  progress(`Шаг 1/2: Анализ пробегов: ${phase1Done}/${phase1Total}`, (phase1Done / phase1Total) * 100);
  processPhase1Queue();
  return true;
}

function sumMileage(data, deviceId) {
  try {
    const rows = data.res && data.res[0] && data.res[0].f;
    if (!Array.isArray(rows) || !rows.length) return 0;

    const getRowId = (r) => {
      if (!r) return null;
      if (r.vehicleid !== undefined) return r.vehicleid;
      if (r.vihicleid !== undefined) return r.vihicleid;
      if (r.id !== undefined) return r.id;
      if (r.vid !== undefined) return r.vid;
      if (r.deviceid !== undefined) return r.deviceid;
      return null;
    };
    const parseVal = (val) => {
      if (val === undefined || val === null) return 0;
      const n = parseFloat(String(val).replace(/\s/g, '').replace(',', '.'));
      return isNaN(n) ? 0 : n;
    };

    let rowsWithId = 0;
    rows.forEach((r) => { if (getRowId(r) !== null) rowsWithId++; });

    let total = 0;
    rows.forEach((r) => {
      const rid = getRowId(r);
      const isMatch = rid !== null
        ? String(rid) === String(deviceId)
        : (rowsWithId === 0 || rows.length === 1);
      if (!isMatch) return;
      total += r.segment_dest !== undefined ? parseVal(r.segment_dest) : parseVal(r.dest);
    });
    return total;
  } catch (e) {
    console.warn('sumMileage error', e);
    return 0;
  }
}

// ---------- Фаза 2: треки кандидатов (строго серийно) ----------

async function runPhase2() {
  // дождаться завершения фазы 1
  await waitPhase1Done();

  if (!candidates.length) {
    finishCleanup('Аномалий с пробегом > 3000 км не найдено.');
    return;
  }

  const total = candidates.length;
  let processed = 0;

  // копия очереди — candidates обрабатываем по одному
  const queue = candidates.slice();
  candidates = [];

  while (queue.length) {
    const cand = queue.shift();
    processed++;
    progress(
      `Шаг 2/2: Загрузка трека ID:${cand.deviceId} (${processed}/${total})...`,
      (processed / total) * 100
    );

    try {
      const data = await requestDeviceTrack(cand);
      const rows = (data && data.res && data.res[0] && data.res[0].f) || [];
      buildSqlForRows(rows, cand.deviceId);
    } catch (e) {
      console.warn('cleanup: таймаут/ошибка трека', cand.deviceId, cand.dateKey, e);
    }
  }

  finishCleanup();
}

function waitPhase1Done() {
  return new Promise((resolve) => {
    const check = () => {
      if (phase1Pending.size === 0 && phase1Queue.length === 0) {
        resolve();
      } else {
        setTimeout(check, 250);
      }
    };
    check();
  });
}

function requestDeviceTrack(cand) {
  const dateFromIso = `${cand.dateKey}T00:00:00`;
  const dateToIso = `${cand.dateKey}T23:59:59`;
  const predicate = (data) =>
    !!(data && data.name === 'Device Track' && data.act === 'setup' &&
       data.res && data.res[0] && Array.isArray(data.res[0].f));

  const promise = waitForPacket('Device Track', predicate, TRACK_TIMEOUT_MS);
  sendRequest({
    name: 'Device Track', type: 'etbl', mid: 6, act: 'setup',
    filter: [
      { selectedpgdateto: [dateToIso] },
      { selectedpgdatefrom: [dateFromIso] },
      { selecteddeviceid: [cand.deviceId] },
    ],
    nowait: false,
    waitfor: ['selectedpgdateto'],
    lang: 'en',
  });
  return promise;
}

function rowTimestamp(r) {
  const wdate = r.wdate || r.WDATE || r.date || r.sdate;
  const d = parseTrackDate(wdate);
  return d ? d.getTime() : null;
}

function buildSqlForRows(rows, deviceId) {
  if (!rows.length) return;

  const sorted = rows.slice().sort((a, b) => {
    const ta = rowTimestamp(a);
    const tb = rowTimestamp(b);
    return (ta == null ? 0 : ta) - (tb == null ? 0 : tb);
  });

  const groups = [];
  let current = null;

  sorted.forEach((r) => {
    const latRaw = r.latitude != null ? r.latitude : (r.lat != null ? r.lat : r.Latitude);
    const lonRaw = r.longitude != null ? r.longitude : (r.lon != null ? r.lon : r.Longitude);
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    const ts = rowTimestamp(r);

    const isBad = ts == null || isNaN(lat) || isNaN(lon) || isOutOfBounds(lat, lon);
    if (isBad) {
      if (!current) current = { start: ts, end: ts };
      else if (ts != null) current.end = ts;
    } else if (current) {
      groups.push(current);
      current = null;
    }
  });
  if (current) groups.push(current);

  const allDates = [];
  groups.forEach((g) => {
    if (g.start == null || g.end == null) return;
    const start = new Date(g.start - 1000); // ±1 с
    const end = new Date(g.end + 1000);
    sqlLines.push(...buildDeleteStatements(deviceId, start, end));
    allDates.push(...splitRangeByDays(start, end).map((p) => p.dateStr));
  });

  if (allDates.length) {
    sqlLines.push(...buildRecalcStatements(deviceId, allDates));
  }
}

// ---------- Финал ----------

function finishCleanup(message) {
  stopWatchdog();
  progress('Готово!', 100);

  const sql = sqlLines.length
    ? sqlLines.join('\n')
    : `-- ${message || 'Аномалий не обнаружено'}`;

  const out = document.getElementById('sqlOutput');
  if (out) out.textContent = sql;
  openSqlModal(sql);
  if (message) showToast(message);
  hideProgressSoon();
}

function startWatchdog() {
  stopWatchdog();
  watchdogId = setInterval(() => {
    if (!inProgress) { stopWatchdog(); return; }
    const now = Date.now();
    for (const [key, meta] of phase1Pending) {
      if (now - meta._sentAt > PHASE1_TIMEOUT_MS) {
        console.warn('cleanup: pending старше 60с, пробег = 0', key);
        phase1Pending.delete(key);
        phase1Active = Math.max(0, phase1Active - 1);
        phase1Done++;
      }
    }
    progress(`Шаг 1/2: Анализ пробегов: ${phase1Done}/${phase1Total}`, (phase1Done / phase1Total) * 100);
    processPhase1Queue();
  }, 5000);
}

function stopWatchdog() {
  if (watchdogId) {
    clearInterval(watchdogId);
    watchdogId = null;
  }
}
