// Раздел «Device Status»: статусы устройств текущего пользователя.

import { onPacket, sendRequest } from '../core/ws.js';
import { auth } from '../core/auth.js';
import { exportXls, parseTrackDate, showToast } from '../core/utils.js';

let statusRows = [];
let statusColumns = [];
let colMaps = {}; // имя колонки -> { String(key): val } (fleet/vehicle и пр. справочники из init)
const state = { search: '', sortColumn: null, sortDir: 1 };
let bound = false;

export function initDeviceStatus() {
  if (bound) return;
  bound = true;

  const searchInput = document.getElementById('deviceStatusSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.search = searchInput.value.trim().toLowerCase();
      render();
    });
  }
  const resetBtn = document.getElementById('deviceStatusResetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      state.search = '';
      state.sortColumn = null;
      state.sortDir = 1;
      render();
    });
  }
  const exportBtn = document.getElementById('deviceStatusExportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const rows = getFilteredRows().map((r) => {
        const out = {};
        const cols = statusColumns.length ? statusColumns : Object.keys(r);
        cols.forEach((c) => { out[c] = r[c] == null ? '' : r[c]; });
        return out;
      });
      if (!rows.length) { showToast('Нет данных для экспорта'); return; }
      exportXls(rows, 'DeviceStatus.xlsx', 'Device Status');
    });
  }

  onPacket('Device Status', handlePacket, { priority: 5 });
}

export function loadDeviceStatus() {
  if (auth.uid == null) return;
  sendRequest({ name: 'Device Status', type: 'etbl', mid: 2, act: 'init', lang: 'en' });
  setTimeout(() => {
    sendRequest({
      name: 'Device Status', type: 'etbl', mid: 2, act: 'setup',
      filter: [{ selecteduid: [auth.uid] }],
      nowait: false, waitfor: [],
      lang: 'en',
    });
  }, 150);
}

function handlePacket(data) {
  const packet = data.res && data.res[0];
  if (!packet) return false;

  if (Array.isArray(packet.cols)) {
    colMaps = {};
    packet.cols.forEach((c) => {
      if (!c || !c.f || !Array.isArray(c.k) || !c.k.length) return;
      const map = {};
      c.k.forEach((entry) => {
        if (entry && entry.key !== undefined && entry.val != null) map[String(entry.key)] = String(entry.val);
      });
      if (Object.keys(map).length) colMaps[c.f] = map;
    });
  }

  if (Array.isArray(packet.f) && (data.act === 'setup' || data.act === 'filter' || data.act === 'reinit')) {
    statusRows = packet.f;
    if (!statusColumns.length && statusRows.length) {
      statusColumns = Object.keys(statusRows[0]).filter((h) => String(h) !== '№');
    }
    render();
  }
  return false;
}

/** Подстановка имён вместо id через colMaps; очистка HTML. */
function displayValue(col, value) {
  let raw = value == null ? '' : value;
  const map = colMaps[col];
  if (map && raw !== '' && map[String(raw)] !== undefined) raw = map[String(raw)];
  if (typeof raw === 'string' && raw.indexOf('<') !== -1) {
    const tmp = document.createElement('div');
    tmp.innerHTML = raw;
    raw = tmp.textContent || tmp.innerText || '';
  }
  return raw;
}

function getFilteredRows() {
  let rows = statusRows;
  const term = state.search;
  if (term) {
    const cols = statusColumns.length ? statusColumns : (statusRows.length ? Object.keys(statusRows[0]) : []);
    rows = rows.filter((row) =>
      cols.some((c) => String(displayValue(c, row[c]) || '').toLowerCase().includes(term))
    );
  }
  if (state.sortColumn) {
    const col = state.sortColumn;
    const dir = state.sortDir;
    rows = rows.slice().sort((a, b) => {
      const av = displayValue(col, a[col]);
      const bv = displayValue(col, b[col]);
      // дата/число- aware сортировка
      const ad = parseSortableValue(av);
      const bd = parseSortableValue(bv);
      if (ad != null || bd != null) {
        if (ad == null && bd == null) return 0;
        if (ad == null) return 1 * dir;
        if (bd == null) return -1 * dir;
        return (ad - bd) * dir;
      }
      const as = String(av == null ? '' : av).trim();
      const bs = String(bv == null ? '' : bv).trim();
      if (as !== '' && bs !== '' && !isNaN(parseFloat(as)) && !isNaN(parseFloat(bs))) {
        return (parseFloat(as) - parseFloat(bs)) * dir;
      }
      return as.localeCompare(bs, 'ru', { numeric: true }) * dir;
    });
  }
  return rows;
}

function parseSortableValue(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return String(n).length === 10 ? n * 1000 : n; // unix seconds -> ms
  }
  const d = parseTrackDate(s);
  if (d) return d.getTime();
  const dp = Date.parse(s);
  return isNaN(dp) ? null : dp;
}

function render() {
  const thead = document.getElementById('deviceStatusTableHead');
  const tbody = document.getElementById('deviceStatusTableBody');
  if (!thead || !tbody) return;

  const rows = getFilteredRows();
  const counter = document.getElementById('deviceStatusCount');
  if (counter) counter.textContent = `${rows.length} из ${statusRows.length}`;

  thead.innerHTML = '';
  tbody.innerHTML = '';

  if (!statusRows.length) {
    tbody.innerHTML = '<tr><td colspan="100">Нет данных. Ожидание ответа сервера...</td></tr>';
    return;
  }

  const headers = (statusColumns.length ? statusColumns : Object.keys(statusRows[0]))
    .filter((h) => String(h) !== '№');

  const trHead = document.createElement('tr');
  headers.forEach((h) => {
    const th = document.createElement('th');
    const hlc = String(h).toLowerCase();
    th.textContent = (hlc === 'контроль' || hlc === 'control') ? 'Питание' : h;
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      if (state.sortColumn === h) state.sortDir *= -1;
      else { state.sortColumn = h; state.sortDir = 1; }
      render();
    });
    if (state.sortColumn === h) th.textContent += state.sortDir === 1 ? ' ▲' : ' ▼';
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="100">Нет результатов</td></tr>';
    return;
  }

  const frag = document.createDocumentFragment();
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    headers.forEach((h) => {
      const td = document.createElement('td');
      const v = displayValue(h, row[h]);
      td.textContent = v == null ? '' : String(v);
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}
