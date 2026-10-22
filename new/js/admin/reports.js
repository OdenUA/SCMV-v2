// Раздел «Отчёты»: пакетные отчёты по пробегу (матрица день×ТС и недельный разбор).
// Механика: очередь запросов 'Startstop accumulation' (mid 5), concurrency 12,
// сопоставление ответов по эху filter (selectedvihicleid / selectedpgdatefrom).

import { onPacket, sendRequest, echoValue } from '../core/ws.js';
import { auth } from '../core/auth.js';
import { showToast } from '../core/utils.js';
import { getVehicleNameMap, requestVehicleShow } from './vehicle-list.js';

const CONCURRENCY = 12;
const REQUEST_TIMEOUT_MS = 60000;
// Список устройств по умолчанию в поле отчёта
const DEFAULT_DEVICE_IDS = '812, 747, 1629, 766, 1260, 1652, 676, 1765';

let reportInProgress = false;
let reportKind = 'monthly-mileage';
let reportData = null;
let pendingRequests = new Map(); // key deviceId|YYYY-MM-DD -> { deviceId, dateKey, _sentAt }
let requestQueue = [];
let activeSends = 0;
let watchdogId = null;
let bound = false;

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

export function parseDeviceIds(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .split(/[\s,;\t\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function generateMonthDates(year, month) {
  const dates = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    dates.push({ year, month, day, dateObj: new Date(year, month - 1, day) });
  }
  return dates;
}

export function pad2(n) { return String(n).padStart(2, '0'); }

export function formatDateForSql(year, month, day, hour, minute, second) {
  return `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
}

export function getMonthName(month) {
  return MONTH_NAMES[month - 1] || (`Месяц${month}`);
}

export function isReportInProgress() { return reportInProgress; }

export function initReports() {
  if (bound) return;
  bound = true;

  const monthInput = document.getElementById('reportMonth');
  if (monthInput && !monthInput.value) {
    const now = new Date();
    monthInput.value = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  }

  const idsInput = document.getElementById('reportDeviceIds');
  if (idsInput && !idsInput.value.trim()) idsInput.value = DEFAULT_DEVICE_IDS;

  const btn = document.getElementById('generateReportBtn');
  if (btn) btn.addEventListener('click', generateReport);

  onPacket('Startstop accumulation', handleMileageResponse, { priority: 5 });
  onPacket('Startstop Sum Result', handleMileageResponse, { priority: 5 });
}

function showProgress(current, total) {
  const statusDiv = document.getElementById('reportStatus');
  const progressText = document.getElementById('reportProgress');
  const progressFill = document.getElementById('reportProgressFill');
  if (statusDiv) {
    statusDiv.classList.remove('hidden');
    statusDiv.classList.add('flex');
  }
  if (progressText) progressText.textContent = `Обработано: ${current} из ${total}`;
  if (progressFill) progressFill.style.width = `${total > 0 ? (current / total) * 100 : 0}%`;
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

function generateReport() {
  if (reportInProgress) {
    showToast('⚠ Отчёт уже формируется...');
    return;
  }

  const typeSelect = document.getElementById('reportTypeSelect');
  const type = typeSelect ? typeSelect.value : 'monthly-mileage';

  if (type === 'anomalies-cleanup') {
    runAnomaliesCleanup();
    return;
  }

  const deviceIds = readDeviceIds();
  if (!deviceIds.length) return;
  const parsed = readMonth();
  if (!parsed) return;

  reportKind = type;
  startMileageRun(deviceIds, parsed.year, parsed.month);
}

function readDeviceIds() {
  const textarea = document.getElementById('reportDeviceIds');
  const deviceIds = parseDeviceIds(textarea ? textarea.value : '');
  if (!deviceIds.length) showToast('⚠ Укажите хотя бы один ID устройства');
  return deviceIds;
}

function readMonth() {
  const monthInput = document.getElementById('reportMonth');
  const monthValue = monthInput ? monthInput.value : '';
  if (!monthValue) {
    showToast('⚠ Выберите месяц');
    return null;
  }
  const parts = monthValue.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    showToast('⚠ Неверный месяц');
    return null;
  }
  return { year, month };
}

async function runAnomaliesCleanup() {
  const deviceIds = readDeviceIds();
  if (!deviceIds.length) return;
  const parsed = readMonth();
  if (!parsed) return;

  reportInProgress = true;
  try {
    const { runAnomalyCleanup } = await import('./cleanup.js');
    runAnomalyCleanup(deviceIds, `${parsed.year}-${pad2(parsed.month)}`, () => {
      reportInProgress = false;
    });
  } catch (e) {
    reportInProgress = false;
    console.warn('cleanup module load failed', e);
    showToast('⚠ Модуль удаления аномалий не загружен');
  }
}

// ============================ Пробеговый прогон ============================

function startMileageRun(deviceIds, year, month) {
  const dates = generateMonthDates(year, month);

  // имена ТС: кэш из Vehicle Show + дозапрос, если чего-то не хватает
  const nameMap = getVehicleNameMap();
  const missing = deviceIds.some((id) => !nameMap.has(String(id)));
  if (missing) {
    try { requestVehicleShow(); } catch (e) { console.warn('requestVehicleShow failed', e); }
  }

  reportData = {
    deviceIds,
    dates,
    year,
    month,
    mileage: {},
    total: deviceIds.length * dates.length,
    done: 0,
    nameMap,
  };
  deviceIds.forEach((id) => { reportData.mileage[id] = {}; });

  pendingRequests = new Map();
  requestQueue = [];
  activeSends = 0;
  reportInProgress = true;

  deviceIds.forEach((deviceId) => {
    dates.forEach((dateInfo) => requestQueue.push({ deviceId, dateInfo }));
  });

  showToast('📊 Начинаем формирование отчёта...');
  showProgress(0, reportData.total);
  startWatchdog();
  processQueue();
}

function processQueue() {
  while (activeSends < CONCURRENCY && requestQueue.length > 0) {
    const task = requestQueue.shift();
    activeSends++;
    sendMileageRequest(task.deviceId, task.dateInfo);
  }
}

function sendMileageRequest(deviceId, dateInfo) {
  const dateFrom = formatDateForSql(dateInfo.year, dateInfo.month, dateInfo.day, 0, 0, 0);
  const dateTo = formatDateForSql(dateInfo.year, dateInfo.month, dateInfo.day, 23, 59, 59);
  const dateKey = `${dateInfo.year}-${pad2(dateInfo.month)}-${pad2(dateInfo.day)}`;

  pendingRequests.set(`${deviceId}|${dateKey}`, { deviceId, dateKey, _sentAt: Date.now() });

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
  if (m && m[1]) return m[1];
  return String(s).split(' ')[0] || null;
}

function handleMileageResponse(data) {
  if (!reportInProgress || !reportData || pendingRequests.size === 0) return false;

  const deviceId = echoValue(data, /vihicle/i) || echoValue(data, /vehicleid/i);
  const dateFrom = echoValue(data, /pgdatefrom/i);
  if (!deviceId || !dateFrom) return false;

  const dateKey = extractDateKey(dateFrom);
  if (!dateKey) return false;

  let meta = pendingRequests.get(`${deviceId}|${dateKey}`);

  if (!meta) {
    // нормализованный поиск (на случай расхождения форматов даты)
    for (const [key, m] of pendingRequests) {
      if (String(m.deviceId) === String(deviceId) && extractDateKey(m.dateKey) === dateKey) {
        meta = m;
        pendingRequests.delete(key);
        break;
      }
    }
    if (!meta) return false;
  } else {
    pendingRequests.delete(`${deviceId}|${dateKey}`);
  }

  const mileage = extractMileage(data, deviceId);
  reportData.mileage[meta.deviceId][meta.dateKey] = mileage;

  activeSends = Math.max(0, activeSends - 1);
  reportData.done++;
  showProgress(reportData.done, reportData.total);
  processQueue();

  if (pendingRequests.size === 0 && requestQueue.length === 0) {
    finalizeMileageReport();
  }
  return true;
}

/** Сумма dest по строкам, сматчившимся на deviceId (см. reports.js v2). */
function extractMileage(data, deviceId) {
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
      // подхват имени ТС из ответа
      if (r.number && String(r.number) !== String(deviceId)) {
        reportData.nameMap.set(String(deviceId), String(r.number));
      }
      const rid = getRowId(r);
      const isMatch = rid !== null
        ? String(rid) === String(deviceId)
        : (rowsWithId === 0 || rows.length === 1);
      if (!isMatch) return;
      const val = r.segment_dest !== undefined ? parseVal(r.segment_dest) : parseVal(r.dest);
      total += val;
    });
    return total;
  } catch (e) {
    console.warn('extractMileage error', e);
    return 0;
  }
}

function startWatchdog() {
  stopWatchdog();
  watchdogId = setInterval(() => {
    try {
      if (!reportInProgress || !reportData) { stopWatchdog(); return; }
      const now = Date.now();
      for (const [key, meta] of pendingRequests) {
        if (now - meta._sentAt > REQUEST_TIMEOUT_MS) {
          console.warn('reports: pending request timed out', key);
          pendingRequests.delete(key);
          reportData.mileage[meta.deviceId][meta.dateKey] = 0;
          activeSends = Math.max(0, activeSends - 1);
          reportData.done++;
        }
      }
      showProgress(reportData.done, reportData.total);
      processQueue();
      if (pendingRequests.size === 0 && requestQueue.length === 0) {
        finalizeMileageReport();
      }
    } catch (e) {
      console.warn('watchdog error', e);
    }
  }, 5000);
}

function stopWatchdog() {
  if (watchdogId) {
    clearInterval(watchdogId);
    watchdogId = null;
  }
}

// ============================ Финализация и экспорт ============================

// Подпись ТС в отчётах: только название (ID — только если имя неизвестно)
function vehicleLabel(deviceId) {
  const name = reportData.nameMap.get(String(deviceId));
  return name ? String(name) : String(deviceId);
}

function finalizeMileageReport() {
  stopWatchdog();
  reportInProgress = false;
  showToast('✅ Отчёт сформирован!');

  try {
    if (reportKind === 'weekly-breakdown') {
      exportWeeklyBreakdown();
    } else {
      exportMonthlyMileage();
    }
  } catch (e) {
    console.warn('finalize error', e);
    showToast('⚠ Ошибка экспорта: ' + e.message);
  }

  hideProgressSoon();
}

function exportMonthlyMileage() {
  const data = [];
  const header = ['Дата/Авто'];
  reportData.deviceIds.forEach((id) => header.push(vehicleLabel(id)));
  data.push(header);

  reportData.dates.forEach((dateInfo) => {
    const dateKey = `${dateInfo.year}-${pad2(dateInfo.month)}-${pad2(dateInfo.day)}`;
    const row = [`${pad2(dateInfo.day)}.${pad2(dateInfo.month)}.${dateInfo.year}`];
    reportData.deviceIds.forEach((id) => {
      const v = reportData.mileage[id][dateKey];
      row.push(typeof v === 'number' ? Number(v.toFixed(2)) : '');
    });
    data.push(row);
  });

  writeReportWorkbook(
    data,
    `${getMonthName(reportData.month)} ${reportData.year}`,
    `Пробег_${reportData.year}-${pad2(reportData.month)}.xlsx`
  );
}

function splitIntoWeeks(dates) {
  const weeks = [];
  let current = [];
  dates.forEach((dateInfo) => {
    if (current.length > 0 && dateInfo.dateObj.getDay() === 1) {
      weeks.push(current);
      current = [];
    }
    current.push(dateInfo);
  });
  if (current.length) weeks.push(current);
  return weeks;
}

function weekBreakdown(deviceId, week) {
  let weekdays = 0;
  let saturday = 0;
  let sunday = 0;
  week.forEach((dateInfo) => {
    const dateKey = `${dateInfo.year}-${pad2(dateInfo.month)}-${pad2(dateInfo.day)}`;
    const mileage = reportData.mileage[deviceId][dateKey] || 0;
    const dow = dateInfo.dateObj.getDay();
    if (dow === 0) sunday += mileage;
    else if (dow === 6) saturday += mileage;
    else weekdays += mileage;
  });
  return { weekdays, saturday, sunday };
}

function exportWeeklyBreakdown() {
  const weeks = splitIntoWeeks(reportData.dates);
  const data = [];

  const header1 = ['№ п/п', 'номерний знак авто'];
  for (let w = 0; w < weeks.length; w++) {
    header1.push(`${w + 1} тиждень`, '', '');
  }
  header1.push('Будні', 'Вихідні', 'Разом');
  data.push(header1);

  const header2 = ['', ''];
  for (let w = 0; w < weeks.length; w++) {
    header2.push('будні', 'суб.', 'нед.');
  }
  header2.push('', '', '');
  data.push(header2);

  reportData.deviceIds.forEach((deviceId, idx) => {
    const row = [idx + 1, vehicleLabel(deviceId)];
    let totalWeekdays = 0;
    let totalWeekends = 0;
    weeks.forEach((week) => {
      const b = weekBreakdown(deviceId, week);
      row.push(Number(b.weekdays.toFixed(2)), Number(b.saturday.toFixed(2)), Number(b.sunday.toFixed(2)));
      totalWeekdays += b.weekdays;
      totalWeekends += b.saturday + b.sunday;
    });
    row.push(Number(totalWeekdays.toFixed(2)));
    row.push(Number(totalWeekends.toFixed(2)));
    row.push(Number((totalWeekdays + totalWeekends).toFixed(2)));
    data.push(row);
  });

  writeReportWorkbook(
    data,
    `${getMonthName(reportData.month)} ${reportData.year}`,
    `Недельный_пробег_${getMonthName(reportData.month)}_${reportData.year}.xlsx`
  );
}

function writeReportWorkbook(aoa, sheetName, filename) {
  if (typeof XLSX === 'undefined') {
    showToast('⚠ XLSX библиотека не загружена');
    return;
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
  showToast(`📥 Отчёт экспортирован: ${filename}`);
}
