// Раздел «Edit Device»: таблица устройств (Device Edit), inline-редактирование.

import { onPacket, sendRequest } from '../core/ws.js';
import { exportXls, showToast } from '../core/utils.js';

const ALLOWED_COLS = ['id', 'imei', 'iccid', 'phone', 'date'];

let deviceRows = [];
let deviceColumns = [];
const state = { search: '', sortColumn: null, sortDir: 1 };
const pendingSaves = new Map(); // id -> { tr, btn, cancelBtn, newValues, originalValues }
let bound = false;

function isErrorPacket(data) {
  if (!data) return false;
  if (data.ern && data.ern !== 0) return true;
  const r = data.res && data.res[0];
  if (r && r.ern && r.ern !== 0) return true;
  const msg = String((r && r.msg) || data.msg || '');
  return /ERROR|failed/i.test(msg);
}

export function initDeviceEdit() {
  if (bound) return;
  bound = true;

  const searchInput = document.getElementById('deviceEditSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.search = searchInput.value.trim().toLowerCase();
      render();
    });
  }
  const resetBtn = document.getElementById('deviceEditResetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      state.search = '';
      state.sortColumn = null;
      state.sortDir = 1;
      render();
    });
  }
  const exportBtn = document.getElementById('deviceEditExportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const rows = getFilteredRows().map(cleanRow);
      if (!rows.length) { showToast('Нет данных для экспорта'); return; }
      exportXls(rows, 'DeviceEdit.xlsx', 'Device Edit');
    });
  }

  onPacket('Device Edit', handlePacket, { priority: 5 });

  // Подтверждение сохранения: эхо с cols.id
  onPacket('Device Edit', (data) => {
    const cols = data && data.cols;
    if (!cols || (cols.id == null && cols.ID == null)) return false;
    const id = String(cols.id != null ? cols.id : cols.ID);
    const pending = pendingSaves.get(id);
    if (!pending) return false;
    finalizeSave(pending, id);
    return true;
  }, { priority: 20 });

  // Ошибка сохранения
  onPacket('Device Edit', (data) => {
    if (!isErrorPacket(data) || pendingSaves.size === 0) return false;
    rollbackPendingSaves();
    return true;
  }, { priority: 15 });
}

export function loadDeviceEdit() {
  sendRequest({ name: 'Device Edit', type: 'etbl', mid: 2, act: 'init', lang: 'en' });
  setTimeout(() => {
    sendRequest({
      name: 'Device Edit', type: 'etbl', mid: 2, act: 'setup',
      filter: [], nowait: true, waitfor: [], lang: 'en',
    });
  }, 150);
}

function handlePacket(data) {
  const packet = data.res && data.res[0];
  if (!packet) return false;

  if (data.act === 'init' && Array.isArray(packet.cols)) {
    deviceColumns = packet.cols
      .map((c) => c && c.f)
      .filter((f) => f && ALLOWED_COLS.indexOf(f) !== -1);
    // строгий порядок колонок
    deviceColumns = ALLOWED_COLS.filter((c) => deviceColumns.indexOf(c) !== -1);
  }

  if (Array.isArray(packet.f) && (data.act === 'setup' || data.act === 'filter' || data.act === 'reinit')) {
    if (pendingSaves.size > 0) return false; // не перерисовываем посреди сохранения
    deviceRows = packet.f;
    if (!deviceColumns.length && deviceRows.length) {
      deviceColumns = ALLOWED_COLS.filter((c) => Object.prototype.hasOwnProperty.call(deviceRows[0], c));
    }
    render();
  }
  return false;
}

function getFilteredRows() {
  let rows = deviceRows;
  const term = state.search;
  if (term) {
    rows = rows.filter((row) =>
      Object.keys(row).some((k) =>
        String(row[k] == null ? '' : row[k]).toLowerCase().includes(term)
      )
    );
  }
  if (state.sortColumn) {
    const col = state.sortColumn;
    const dir = state.sortDir;
    rows = rows.slice().sort((a, b) => compareValues(a[col], b[col]) * dir);
  }
  return rows;
}

function compareValues(av, bv) {
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  const as = String(av).trim();
  const bs = String(bv).trim();
  if (as !== '' && bs !== '' && !isNaN(parseFloat(as)) && !isNaN(parseFloat(bs))) {
    return parseFloat(as) - parseFloat(bs);
  }
  return as.localeCompare(bs, 'ru', { numeric: true });
}

function cleanRow(row) {
  const out = {};
  const cols = deviceColumns.length ? deviceColumns : ALLOWED_COLS;
  cols.forEach((c) => { out[c] = row[c] == null ? '' : row[c]; });
  return out;
}

function render() {
  const thead = document.getElementById('deviceEditTableHead');
  const tbody = document.getElementById('deviceEditTableBody');
  if (!thead || !tbody) return;

  const rows = getFilteredRows();
  const counter = document.getElementById('deviceEditCount');
  if (counter) counter.textContent = `${rows.length} из ${deviceRows.length}`;

  thead.innerHTML = '';
  tbody.innerHTML = '';

  if (!deviceRows.length) {
    tbody.innerHTML = '<tr><td colspan="100">Нет данных. Ожидание ответа сервера...</td></tr>';
    return;
  }

  const cols = deviceColumns.length ? deviceColumns : ALLOWED_COLS;
  const headers = cols.slice();
  headers.push('Action');

  const trHead = document.createElement('tr');
  headers.forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h === 'imei' ? 'IMEI' : (h === 'iccid' ? 'ICCID' : h);
    if (h !== 'Action') {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        if (state.sortColumn === h) state.sortDir *= -1;
        else { state.sortColumn = h; state.sortDir = 1; }
        render();
      });
      if (state.sortColumn === h) th.textContent += state.sortDir === 1 ? ' ▲' : ' ▼';
    }
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
      td.dataset.col = h;
      if (h === 'Action') {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary btn-xs device-edit-btn';
        btn.textContent = 'Редактировать';
        btn.dataset.editing = '0';
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (btn.dataset.editing === '1') saveRow(row, tr, btn);
          else enterEditMode(row, tr, btn);
        });
        td.appendChild(btn);
      } else {
        td.textContent = row[h] == null ? '' : String(row[h]);
      }
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

function enterEditMode(row, tr, btn) {
  btn.dataset.editing = '1';
  btn.textContent = 'Сохранить';
  document.querySelectorAll('#deviceEditTableBody .device-edit-btn').forEach((b) => { if (b !== btn) b.disabled = true; });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary btn-xs';
  cancelBtn.textContent = 'Отмена';
  btn.parentNode.appendChild(cancelBtn);

  const originalValues = {};
  const cols = deviceColumns.length ? deviceColumns : ALLOWED_COLS;

  cols.forEach((col) => {
    if (String(col).toLowerCase() === 'id') return;
    const cell = tr.querySelector(`td[data-col="${col}"]`);
    if (!cell) return;
    const val = cell.textContent || '';
    originalValues[col] = val;
    cell.setAttribute('data-orig', val);
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = val;
    inp.style.width = '100%';
    cell.textContent = '';
    cell.appendChild(inp);
  });

  btn._cancelBtn = cancelBtn;
  btn._originalValues = originalValues;

  cancelBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    cols.forEach((col) => {
      if (String(col).toLowerCase() === 'id') return;
      const cell = tr.querySelector(`td[data-col="${col}"]`);
      if (!cell) return;
      cell.textContent = cell.getAttribute('data-orig') || '';
      cell.removeAttribute('data-orig');
    });
    btn.dataset.editing = '0';
    btn.textContent = 'Редактировать';
    btn.disabled = false;
    if (cancelBtn.parentNode) cancelBtn.parentNode.removeChild(cancelBtn);
    document.querySelectorAll('#deviceEditTableBody .device-edit-btn').forEach((b) => { b.disabled = false; });
  });
}

function saveRow(row, tr, btn) {
  const cols = { id: String(row.id) };
  const newValues = {};
  const originalValues = btn._originalValues || {};
  const columns = deviceColumns.length ? deviceColumns : ALLOWED_COLS;

  columns.forEach((col) => {
    if (String(col).toLowerCase() === 'id') return;
    const cell = tr.querySelector(`td[data-col="${col}"]`);
    if (!cell) return;
    const inp = cell.querySelector('input');
    const v = inp ? inp.value : (cell.getAttribute('data-orig') || '');
    cols[col] = String(v);
    newValues[col] = String(v);
    cell.textContent = v;
    cell.removeAttribute('data-orig');
  });

  const idStr = String(row.id);
  pendingSaves.set(idStr, { tr, btn, cancelBtn: btn._cancelBtn || null, newValues, originalValues });
  btn.disabled = true;

  sendRequest({
    name: 'Device Edit',
    act: 'rowsave',
    type: 'etbl',
    mid: 2,
    cols,
    lang: 'en',
  });
  showToast('Сохранение отправлено', 1500);
}

function finalizeSave(pending, id) {
  try {
    pendingSaves.delete(id);
    const row = deviceRows.find((r) => String(r.id) === id);
    if (row) {
      Object.keys(pending.newValues).forEach((k) => {
        if (k !== 'id') row[k] = pending.newValues[k];
      });
    }
    pending.btn.disabled = false;
    pending.btn.dataset.editing = '0';
    pending.btn.textContent = 'Редактировать';
    if (pending.cancelBtn && pending.cancelBtn.parentNode) pending.cancelBtn.parentNode.removeChild(pending.cancelBtn);
    document.querySelectorAll('#deviceEditTableBody .device-edit-btn').forEach((b) => { b.disabled = false; });
    showToast('Сохранено');
  } catch (e) {
    console.warn('finalizeSave error', e);
  }
}

function rollbackPendingSaves() {
  const ids = [...pendingSaves.keys()];
  ids.forEach((id) => {
    const pending = pendingSaves.get(id);
    pendingSaves.delete(id);
    try {
      Object.keys(pending.originalValues || {}).forEach((col) => {
        const cell = pending.tr.querySelector(`td[data-col="${col}"]`);
        if (cell) cell.textContent = pending.originalValues[col];
      });
      pending.btn.disabled = false;
      pending.btn.dataset.editing = '0';
      pending.btn.textContent = 'Редактировать';
      if (pending.cancelBtn && pending.cancelBtn.parentNode) pending.cancelBtn.parentNode.removeChild(pending.cancelBtn);
    } catch (e) {
      console.warn('rollback error', e);
    }
  });
  document.querySelectorAll('#deviceEditTableBody .device-edit-btn').forEach((b) => { b.disabled = false; });
  alert('Ошибка сохранения. Значения откачены.');
}
