// Раздел «Список ТС» (Vehicle Show, read-only, цвета по возрасту)
// и раздел «Edit Vehicle» (Vehicle Edit Distribution, inline-редактирование).

import { onPacket, sendRequest } from '../core/ws.js';
import { exportXls, getRowAgeGrade, showToast } from '../core/utils.js';
import { openDeviceAddModal } from './device-add.js';

const HEADER_LABELS = {
  контроль: 'Питание',
  control: 'Питание',
  imei: 'IMEI',
  iccid: 'ICCID',
};

function labelOf(key) {
  const lower = String(key).toLowerCase();
  return HEADER_LABELS[lower] || key;
}

function isErrorPacket(data) {
  if (!data) return false;
  if (data.ern && data.ern !== 0) return true;
  const r = data.res && data.res[0];
  if (r && r.ern && r.ern !== 0) return true;
  const msg = String((r && r.msg) || data.msg || '');
  return /ERROR|failed/i.test(msg);
}

// ============================ Список ТС (Vehicle Show) ============================

let listRows = [];          // все строки Vehicle Show
let fleetKeyMap = null;     // key -> val (название филиала)
const listState = {
  search: '',
  sortColumn: null,
  sortDir: 1,
};
let listBound = false;

export function getFleetKeyMap() { return fleetKeyMap; }

/** id устройства -> госномер (для отчётов). */
export function getVehicleNameMap() {
  const map = new Map();
  for (const r of listRows) {
    const id = r.deviceid != null ? String(r.deviceid) : (r.id != null ? String(r.id) : null);
    if (id != null && r.number != null && r.number !== '') map.set(id, String(r.number));
  }
  return map;
}

export function initVehicleList() {
  if (listBound) return;
  listBound = true;

  const searchInput = document.getElementById('vehicleListSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      listState.search = searchInput.value.trim().toLowerCase();
      renderVehicleList();
    });
  }

  const resetBtn = document.getElementById('vehicleListResetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      listState.search = '';
      listState.sortColumn = null;
      listState.sortDir = 1;
      renderVehicleList();
    });
  }

  const exportBtn = document.getElementById('vehicleListExportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const rows = getFilteredListRows().map(cleanRowForExport);
      if (!rows.length) { showToast('Нет данных для экспорта'); return; }
      exportXls(rows, 'DeviceList.xlsx', 'Device List');
    });
  }

  const addBtn = document.getElementById('vehicleAddBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => openDeviceAddModal());
  }

  onPacket('Vehicle Show', handleVehicleShowPacket, { priority: 5 });
}

export function loadVehicleList() {
  requestVehicleShow();
}

export function requestVehicleShow() {
  // init — чтобы получить cols с картой fleet (ключ -> название филиала)
  sendRequest({
    name: 'Vehicle Show', type: 'etbl', mid: 2, act: 'init',
    lang: 'en',
  });
  setTimeout(() => {
    sendRequest({
      name: 'Vehicle Show', type: 'etbl', mid: 2, act: 'setup',
      filter: [], nowait: true, waitfor: [], lang: 'ru',
    });
  }, 150);
}

function handleVehicleShowPacket(data) {
  const packet = data.res && data.res[0];
  if (!packet) return false;

  if (Array.isArray(packet.cols)) {
    const fleetCol = packet.cols.find((c) => c && c.f === 'fleet' && Array.isArray(c.k) && c.k.length);
    if (fleetCol) {
      fleetKeyMap = {};
      fleetCol.k.forEach((entry) => {
        if (entry && entry.key !== undefined && entry.key !== null && entry.val != null) {
          fleetKeyMap[String(entry.key)] = String(entry.val);
        }
      });
    }
  }

  if (Array.isArray(packet.f) && (data.act === 'setup' || data.act === 'filter' || data.act === 'reinit')) {
    listRows = packet.f.map((r, i) => {
      const row = { ...r };
      row.__origIndex = i;
      applyFleetMapping(row);
      return row;
    });
    renderVehicleList();
    if (editRows.length) renderVehicleEdit(); // refresh IMEI в Edit Vehicle
  }
  return false; // не поглощаем — модуль Edit Vehicle тоже слушает fleet-справочники через свой init
}

/** Заменить fleet-key на название для отображения, исходный ключ — в __fleetKey. */
function applyFleetMapping(row) {
  if (!fleetKeyMap || !Object.prototype.hasOwnProperty.call(row, 'fleet')) return;
  const original = row.fleet;
  if (original == null) return;
  if (row.__fleetKey === undefined) row.__fleetKey = original;
  if (fleetKeyMap[String(original)] !== undefined) {
    row.fleet = fleetKeyMap[String(original)];
  }
}

// IMEI для Edit Vehicle: в Vehicle Edit Distribution колонки imei нет —
// подставляем из Vehicle Show (join по deviceid, fallback — id).
function imeiOf(row) {
  if (row.imei != null && String(row.imei).trim() !== '') return row.imei;
  if (listRows.length) {
    const key = row.deviceid != null ? String(row.deviceid) : (row.id != null ? String(row.id) : null);
    if (key != null) {
      const match = listRows.find((r) =>
        (r.deviceid != null && String(r.deviceid) === key) || (r.id != null && String(r.id) === key));
      if (match && match.imei != null && String(match.imei).trim() !== '') return match.imei;
    }
  }
  return '';
}

function getFilteredListRows() {
  const term = listState.search;
  let rows = listRows;

  if (term) {
    rows = rows.filter((row) =>
      Object.keys(row).some((k) => {
        if (k.startsWith('__')) return false;
        return String(row[k] == null ? '' : row[k]).toLowerCase().includes(term);
      })
    );
  }

  if (listState.sortColumn) {
    const col = listState.sortColumn;
    const dir = listState.sortDir;
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

function cleanRowForExport(row) {
  const out = {};
  Object.keys(row).forEach((k) => {
    if (!k.startsWith('__')) out[labelOf(k)] = row[k] == null ? '' : row[k];
  });
  return out;
}

function renderVehicleList() {
  const thead = document.getElementById('vehicleListTableHead');
  const tbody = document.getElementById('vehicleListTableBody');
  if (!thead || !tbody) return;

  const rows = getFilteredListRows();
  const counter = document.getElementById('vehicleListCount');
  if (counter) counter.textContent = `${rows.length} из ${listRows.length}`;

  thead.innerHTML = '';
  tbody.innerHTML = '';

  if (!listRows.length) {
    tbody.innerHTML = '<tr><td colspan="100">Нет данных. Ожидание ответа сервера...</td></tr>';
    return;
  }

  const headers = Object.keys(listRows[0]).filter((k) => !k.startsWith('__'));

  const trHead = document.createElement('tr');
  headers.forEach((h) => {
    const th = document.createElement('th');
    th.textContent = labelOf(h);
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      if (listState.sortColumn === h) listState.sortDir *= -1;
      else { listState.sortColumn = h; listState.sortDir = 1; }
      renderVehicleList();
    });
    if (listState.sortColumn === h) th.textContent += listState.sortDir === 1 ? ' ▲' : ' ▼';
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="100">Нет результатов</td></tr>';
    return;
  }

  const nowTs = Date.now();
  const frag = document.createDocumentFragment();
  rows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    const age = getRowAgeGrade(row, nowTs);
    tr.style.backgroundColor = age.color;
    headers.forEach((h) => {
      const td = document.createElement('td');
      if (h === '№') td.textContent = row.__origIndex != null ? String(row.__origIndex + 1) : String(idx + 1);
      else td.textContent = row[h] == null ? '' : String(row[h]);
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

// ============================ Edit Vehicle (Vehicle Edit Distribution) ============================

let editRows = [];
const editState = { search: '', sortColumn: null, sortDir: 1 };
const pendingSaves = new Map(); // id -> { tr, btn, cancelBtn, newValues, originalValues }
let editBound = false;

// «Буфер обмена»: произвольный текст в localStorage — источник для кнопки «Вставить» в Notes
const CLIPBOARD_STORE_KEY = 'vehicleEditClipboard';
let clipboardValue = '';

export function initVehicleEdit() {
  if (editBound) return;
  editBound = true;

  const searchInput = document.getElementById('vehicleEditSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      editState.search = searchInput.value.trim().toLowerCase();
      renderVehicleEdit();
    });
  }

  const clipboardInput = document.getElementById('vehicleEditClipboardInput');
  if (clipboardInput) {
    try {
      clipboardValue = localStorage.getItem(CLIPBOARD_STORE_KEY) || '';
    } catch (e) { /* ignore */ }
    clipboardInput.value = clipboardValue;
    clipboardInput.addEventListener('input', () => {
      clipboardValue = clipboardInput.value;
      try {
        localStorage.setItem(CLIPBOARD_STORE_KEY, clipboardValue);
      } catch (e) { /* ignore */ }
    });
  }
  const resetBtn = document.getElementById('vehicleEditResetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      editState.search = '';
      editState.sortColumn = null;
      editState.sortDir = 1;
      renderVehicleEdit();
    });
  }
  const exportBtn = document.getElementById('vehicleEditExportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const rows = getFilteredEditRows().map(cleanRowForExport);
      if (!rows.length) { showToast('Нет данных для экспорта'); return; }
      exportXls(rows, 'VehicleEdit.xlsx', 'Vehicle Edit');
    });
  }

  onPacket('Vehicle Edit Distribution', handleVehicleEditPacket, { priority: 5 });

  // Подтверждение сохранения: ответ-эхо с cols.id
  onPacket('Vehicle Edit Distribution', (data) => {
    const cols = data && data.cols;
    if (!cols || cols.id == null) return false;
    const pending = pendingSaves.get(String(cols.id));
    if (!pending) return false;
    finalizeSave(pending, String(cols.id));
    return true;
  }, { priority: 20 });

  // Ошибка сохранения
  onPacket('Vehicle Edit Distribution', (data) => {
    if (!isErrorPacket(data) || pendingSaves.size === 0) return false;
    rollbackPendingSaves();
    return true;
  }, { priority: 15 });
}

function finalizeSave(pending, id) {
  try {
    pendingSaves.delete(id);
    // подставить новые значения в ячейки
    Object.keys(pending.newValues).forEach((col) => {
      if (col === 'id') return;
      const cell = pending.tr.querySelector(`td[data-col="${col}"]`);
      if (cell) {
        cell.textContent = col === 'fleet'
          ? (fleetKeyMap && fleetKeyMap[pending.newValues[col]] != null ? fleetKeyMap[pending.newValues[col]] : pending.newValues[col])
          : pending.newValues[col];
      }
    });
    const row = editRows.find((r) => String(r.id) === id);
    if (row) {
      Object.keys(pending.newValues).forEach((k) => {
        if (k === 'id') return;
        row[k] = pending.newValues[k];
        if (k === 'fleet') row.__fleetKey = pending.newValues[k];
      });
      applyFleetMapping(row);
      // applyFleetMapping не перезапишет, т.к. __fleetKey уже совпадает — форсируем отображение
      if (fleetKeyMap && fleetKeyMap[String(row.__fleetKey)] !== undefined) row.fleet = fleetKeyMap[String(row.__fleetKey)];
    }
    pending.btn.disabled = false;
    pending.btn.dataset.editing = '0';
    pending.btn.textContent = 'Редактировать';
    if (pending.cancelBtn && pending.cancelBtn.parentNode) pending.cancelBtn.parentNode.removeChild(pending.cancelBtn);
    document.querySelectorAll('#vehicleEditTableBody .vehicle-edit-btn').forEach((b) => { b.disabled = false; });
    showToast('Сохранено');
    // через 200 мс — повторный setup для консистентности
    setTimeout(() => {
      sendRequest({
        name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'setup',
        filter: [], nowait: true, waitfor: [], lang: 'ru',
      });
    }, 200);
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
  document.querySelectorAll('#vehicleEditTableBody .vehicle-edit-btn').forEach((b) => { b.disabled = false; });
  alert('Ошибка сохранения. Значения откачены.');
}

function handleVehicleEditPacket(data) {
  const packet = data.res && data.res[0];
  if (!packet) return false;

  if (Array.isArray(packet.cols)) {
    const fleetCol = packet.cols.find((c) => c && c.f === 'fleet' && Array.isArray(c.k) && c.k.length);
    if (fleetCol && !fleetKeyMap) {
      fleetKeyMap = {};
      fleetCol.k.forEach((entry) => {
        if (entry && entry.key !== undefined && entry.key !== null && entry.val != null) {
          fleetKeyMap[String(entry.key)] = String(entry.val);
        }
      });
    }
  }

  if (Array.isArray(packet.f) && (data.act === 'setup' || data.act === 'filter' || data.act === 'reinit')) {
    // пока идёт редактирование строки — не перерисовываем таблицу
    if (pendingSaves.size > 0) return false;
    editRows = packet.f.map((r, i) => {
      const row = { ...r };
      row.__origIndex = i;
      if (fleetKeyMap) applyFleetMapping(row);
      return row;
    });
    renderVehicleEdit();
  }
  return false;
}

export function loadVehicleEdit() {
  requestVehicleShow(); // источник IMEI для read-only колонки (в VED imei нет)
  // init — чтобы получить cols со справочником fleet (опции селекта при редактировании)
  sendRequest({
    name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'init',
    lang: 'ru',
  });
  setTimeout(() => {
    sendRequest({
      name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'setup',
      filter: [], nowait: true, waitfor: [], lang: 'ru',
    });
  }, 150);
}

const EDITABLE_COLS = ['number', 'brand', 'model', 'notes', 'fleet'];

function getFilteredEditRows() {
  let rows = editRows;
  const term = editState.search;
  if (term) {
    rows = rows.filter((row) =>
      Object.keys(row).some((k) => {
        if (k.startsWith('__')) return false;
        return String(row[k] == null ? '' : row[k]).toLowerCase().includes(term);
      })
    );
  }
  if (editState.sortColumn) {
    const col = editState.sortColumn;
    const dir = editState.sortDir;
    rows = rows.slice().sort((a, b) => compareValues(a[col], b[col]) * dir);
  }
  return rows;
}

function renderVehicleEdit() {
  const thead = document.getElementById('vehicleEditTableHead');
  const tbody = document.getElementById('vehicleEditTableBody');
  if (!thead || !tbody) return;

  const rows = getFilteredEditRows();
  const counter = document.getElementById('vehicleEditCount');
  if (counter) counter.textContent = `${rows.length} из ${editRows.length}`;

  thead.innerHTML = '';
  tbody.innerHTML = '';

  if (!editRows.length) {
    tbody.innerHTML = '<tr><td colspan="100">Нет данных. Ожидание ответа сервера...</td></tr>';
    return;
  }

  const headers = Object.keys(editRows[0]).filter((k) => !k.startsWith('__'));
  if (!headers.includes('imei')) headers.push('imei'); // read-only, из Vehicle Show
  headers.push('Action');

  const trHead = document.createElement('tr');
  headers.forEach((h) => {
    const th = document.createElement('th');
    th.textContent = labelOf(h);
    if (h !== 'Action') {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        if (editState.sortColumn === h) editState.sortDir *= -1;
        else { editState.sortColumn = h; editState.sortDir = 1; }
        renderVehicleEdit();
      });
      if (editState.sortColumn === h) th.textContent += editState.sortDir === 1 ? ' ▲' : ' ▼';
    }
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="100">Нет результатов</td></tr>';
    return;
  }

  const frag = document.createDocumentFragment();
  rows.forEach((row) => frag.appendChild(buildEditRow(row, headers)));
  tbody.appendChild(frag);
}

function buildFleetSelect(currentKey) {
  const sel = document.createElement('select');
  sel.className = 'fleet-select';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '--';
  sel.appendChild(empty);
  if (fleetKeyMap) {
    const opts = Object.keys(fleetKeyMap)
      .map((k) => ({ k, name: fleetKeyMap[k] }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    opts.forEach((o) => {
      const op = document.createElement('option');
      op.value = o.k;
      op.textContent = o.name;
      sel.appendChild(op);
    });
  }
  sel.value = currentKey != null ? String(currentKey) : '';
  return sel;
}

function buildEditRow(row, headers) {
  const tr = document.createElement('tr');
  const idStr = row.id != null ? String(row.id) : '';

  headers.forEach((h) => {
    const td = document.createElement('td');
    td.dataset.col = h;
    if (h === 'Action') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary btn-xs vehicle-edit-btn';
      btn.textContent = 'Редактировать';
      btn.dataset.editing = '0';
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (btn.dataset.editing === '1') saveEditRow(row, tr, btn);
        else enterEditMode(row, tr, btn);
      });
      td.appendChild(btn);
    } else if (h === '№') {
      td.textContent = row.__origIndex != null ? String(row.__origIndex + 1) : '';
    } else if (h === 'imei') {
      td.textContent = String(imeiOf(row));
    } else {
      td.textContent = row[h] == null ? '' : String(row[h]);
    }
    tr.appendChild(td);
  });
  return tr;
}

function enterEditMode(row, tr, btn) {
  btn.dataset.editing = '1';
  btn.textContent = 'Сохранить';
  document.querySelectorAll('#vehicleEditTableBody .vehicle-edit-btn').forEach((b) => { if (b !== btn) b.disabled = true; });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary btn-xs';
  cancelBtn.textContent = 'Отмена';
  btn.parentNode.appendChild(cancelBtn);

  const originalValues = {};

  EDITABLE_COLS.forEach((col) => {
    const cell = tr.querySelector(`td[data-col="${col}"]`);
    if (!cell) return;
    const val = cell.textContent || '';
    originalValues[col] = val;
    cell.setAttribute('data-orig', val);
    cell.textContent = '';
    if (col === 'fleet') {
      const currentKey = row.__fleetKey != null ? String(row.__fleetKey) : '';
      cell.appendChild(buildFleetSelect(currentKey));
    } else {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = val;
      inp.style.width = '100%';
      if (col === 'notes') {
        const wrap = document.createElement('div');
        wrap.className = 'flex items-center space-x-1';
        wrap.appendChild(inp);
        const pasteBtn = document.createElement('button');
        pasteBtn.type = 'button';
        pasteBtn.className = 'btn btn-secondary btn-xs shrink-0';
        pasteBtn.title = 'Вставить из буфера обмена (заменить текст)';
        pasteBtn.innerHTML = '<i class="fa-solid fa-paste"></i>';
        pasteBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          inp.value = clipboardValue;
          inp.focus();
        });
        wrap.appendChild(pasteBtn);
        cell.appendChild(wrap);
      } else {
        cell.appendChild(inp);
      }
    }
  });

  btn._cancelBtn = cancelBtn;
  btn._originalValues = originalValues;

  cancelBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    EDITABLE_COLS.forEach((col) => {
      const cell = tr.querySelector(`td[data-col="${col}"]`);
      if (!cell) return;
      cell.textContent = cell.getAttribute('data-orig') || '';
      cell.removeAttribute('data-orig');
    });
    btn.dataset.editing = '0';
    btn.textContent = 'Редактировать';
    btn.disabled = false;
    if (cancelBtn.parentNode) cancelBtn.parentNode.removeChild(cancelBtn);
    document.querySelectorAll('#vehicleEditTableBody .vehicle-edit-btn').forEach((b) => { b.disabled = false; });
  });
}

function saveEditRow(row, tr, btn) {
  const cols = { id: String(row.id) };
  const newValues = {};
  const originalValues = btn._originalValues || {};

  EDITABLE_COLS.forEach((col) => {
    const cell = tr.querySelector(`td[data-col="${col}"]`);
    if (!cell) return;
    const input = cell.querySelector('input,select');
    const v = input ? input.value : (cell.getAttribute('data-orig') || '');
    cols[col] = String(v);
    newValues[col] = String(v);
    cell.textContent = col === 'fleet'
      ? (fleetKeyMap && fleetKeyMap[String(v)] != null ? fleetKeyMap[String(v)] : v)
      : v;
    cell.removeAttribute('data-orig');
  });

  const idStr = String(row.id);
  pendingSaves.set(idStr, {
    tr,
    btn,
    cancelBtn: btn._cancelBtn || null,
    newValues,
    originalValues,
  });
  btn.disabled = true;

  sendRequest({
    name: 'Vehicle Edit Distribution',
    act: 'rowsave',
    type: 'etbl',
    mid: 2,
    cols,
    lang: 'ru',
  });
  showToast('Сохранение отправлено', 1500);
}
