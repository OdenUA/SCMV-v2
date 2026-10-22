// Раздел «Аудит»: запрос журналов изменений и рендер в новой вкладке.

import { onPacket, sendRequest } from '../core/ws.js';
import { auth } from '../core/auth.js';
import { escapeHtml, formatDate, parseTrackDate, showToast } from '../core/utils.js';
import { getFleetKeyMap } from './vehicle-list.js';

let pending = null; // { expected, received, timer }
let bound = false;
let fleetMap = null; // key -> название филиала (для подмены fleet ID в изменениях)

export function initAudit() {
  if (bound) return;
  bound = true;

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const fromEl = document.getElementById('auditDateFrom');
  if (fromEl && !fromEl.value) fromEl.value = today;
  const toEl = document.getElementById('auditDateTo');
  if (toEl && !toEl.value) toEl.value = today;

  const runBtn = document.getElementById('auditRunBtn');
  if (runBtn) runBtn.addEventListener('click', runAudit);

  onPacket('User Admin Edit', collectPacket, { priority: 10 });
  onPacket('Audit', collectPacket, { priority: 10 });
  onPacket('Vehicle Show', collectPacket, { priority: 10 }); // cols с картой fleet (отвечает на наш init)
}

function setStatusText(text) {
  const el = document.getElementById('auditStatus');
  if (el) el.textContent = text;
}

function runAudit() {
  if (!auth.loggedIn) {
    showToast('Сначала выполните вход');
    return;
  }
  if (pending) {
    showToast('Аудит уже выполняется...');
    return;
  }

  const fromEl = document.getElementById('auditDateFrom');
  const toEl = document.getElementById('auditDateTo');
  const dateFrom = fromEl && fromEl.value ? fromEl.value : '';
  const dateTo = toEl && toEl.value ? toEl.value : '';
  if (!dateFrom || !dateTo) {
    showToast('Выберите период (от и до)');
    return;
  }
  if (dateTo < dateFrom) {
    showToast('⚠ Конец периода раньше начала');
    return;
  }
  // to — конец дня, чтобы включить записи за последнюю дату диапазона
  const dateToParam = `${dateTo}T23:59:59`;

  pending = { expected: 3, received: [] };
  setStatusText('Запрос данных...');
  pending.timer = setTimeout(() => {
    const p = pending;
    pending = null;
    if (p) finishAudit(p.received);
  }, 6000);

  // cols с картой fleet (init, без фильтров — как в vehicle-list: сервер на такой формат отвечает)
  sendRequest({ name: 'Vehicle Show', type: 'etbl', mid: 2, act: 'init', lang: 'en' });
  sendRequest({
    name: 'User Admin Edit', type: 'etbl', mid: 2, act: 'setup',
    filter: [], nowait: true, waitfor: [], lang: 'en',
  });
  setTimeout(() => {
    sendRequest({
      name: 'Audit', type: 'etbl', mid: 4, act: 'filter',
      filter: [{ selectedpgdatefrom: [dateFrom] }, { selectedpgdateto: [dateToParam] }, { selectedtable: ['vehicle'] }],
      lang: 'en',
    });
  }, 100);
  setTimeout(() => {
    sendRequest({
      name: 'Audit', type: 'etbl', mid: 4, act: 'filter',
      filter: [{ selectedpgdatefrom: [dateFrom] }, { selectedpgdateto: [dateToParam] }, { selectedtable: ['deviceconf'] }],
      lang: 'en',
    });
  }, 200);
}

function collectPacket(data) {
  if (!pending) return false;
  if (!data || (data.name !== 'Audit' && data.name !== 'User Admin Edit' && data.name !== 'Vehicle Show')) return false;
  const packet = data.res && data.res[0];
  if (!packet) return false;
  // cols ответа Vehicle Show init — карта fleet key -> название (для отображения изменений fleet)
  if (data.name === 'Vehicle Show') {
    const cols = packet.cols;
    const fleetCol = Array.isArray(cols) && cols.find((c) => c && c.f === 'fleet' && Array.isArray(c.k) && c.k.length);
    if (!fleetCol) return false;
    fleetMap = {};
    fleetCol.k.forEach((entry) => {
      if (entry && entry.key !== undefined) fleetMap[String(entry.key)] = String(entry.val);
    });
    maybeFinish(); // строки могли прийти раньше — теперь можно финализировать
    return true; // пакет с cols, строк нет — в аудит не включаем
  }
  if (!Array.isArray(packet.f)) return false;
  pending.received.push(data);
  setStatusText(`Получено пакетов: ${pending.received.length} из ${pending.expected}`);
  maybeFinish();
  return true; // поглощаем пакеты аудита
}

// Финализация, когда собраны все аудит-пакеты; подождем карту fleet (Vehicle Show init),
// если она ещё не пришла — иначе fleet подменится на ID поздно
function maybeFinish() {
  if (!pending || pending.received.length < pending.expected) return;
  if (!fleetMap && !pending.fleetGrace) {
    pending.fleetGrace = true;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      const p = pending;
      pending = null;
      if (p) finishAudit(p.received);
    }, 2000);
    return;
  }
  const p = pending;
  pending = null;
  clearTimeout(p.timer);
  finishAudit(p.received);
}

// ---------- Терпимый парсер битого JSON из аудит-логов ----------
function parseAuditJson(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    try {
      let s = String(str).trim();
      if (s.startsWith('{')) s = s.substring(1);
      if (s.endsWith('}')) s = s.substring(0, s.length - 1);
      s = s.trim();
      // вставить пропущенные запятые между концом значения и следующим ключом
      s = s.replace(/([0-9"l}e])\s*("[\w]+":)/g, '$1,$2');
      return JSON.parse('{' + s + '}');
    } catch (e2) {
      return null;
    }
  }
}

// Название филиала по ключу fleet; без карты — исходное значение
function fleetName(v) {
  if (v == null) return v;
  const map = fleetMap || getFleetKeyMap();
  if (map && map[String(v)] !== undefined) return map[String(v)];
  return v;
}

function formatAuditChanges(origStr, newStr) {
  const oldObj = parseAuditJson(origStr);
  const newObj = parseAuditJson(newStr);

  if (!oldObj && !newObj) {
    if (origStr || newStr) return '<i style="color:gray; font-size:10px;">Raw (parse error)</i>';
    return '';
  }

  const o = oldObj || {};
  const n = newObj || {};
  const keys = new Set([...Object.keys(o), ...Object.keys(n)]);
  const changes = [];

  keys.forEach((k) => {
    if (k === 'sdate') return;
    const vOld = k === 'fleet' ? fleetName(o[k]) : o[k];
    const vNew = k === 'fleet' ? fleetName(n[k]) : n[k];
    if (JSON.stringify(vOld) !== JSON.stringify(vNew)) {
      const dispOld = vOld === undefined ? '<i>(null)</i>' : escapeHtml(String(vOld));
      const dispNew = vNew === undefined ? '<i>(deleted)</i>' : `<b>${escapeHtml(String(vNew))}</b>`;
      changes.push(`<div style="margin-bottom:2px;"><span style="color:#666;font-weight:bold;">${escapeHtml(k)}:</span> <span class="old">${dispOld}</span> &rarr; <span class="new">${dispNew}</span></div>`);
    }
  });

  if (!changes.length) return '<i>No changes</i>';
  return changes.join('');
}

function finishAudit(packets) {
  setStatusText('');
  if (!packets || !packets.length) {
    showToast('Нет данных аудита за выбранную дату');
    return;
  }

  // Карта пользователей uid -> имя
  const userMap = {};
  const auditPackets = [];
  packets.forEach((pkt) => {
    if (pkt.name === 'User Admin Edit') {
      (pkt.res[0].f || []).forEach((u) => {
        if (u.uid != null) userMap[String(u.uid)] = u.fname || u.usr || (`User ${u.uid}`);
      });
    } else {
      auditPackets.push(pkt);
    }
  });

  // Строки изменений
  const rawRows = [];
  auditPackets.forEach((pkt) => {
    (pkt.res[0].f || []).forEach((r) => rawRows.push(r));
  });

  const displayRows = rawRows.map((r) => {
    const orig = r.auditorig || '';
    const neu = r.auditnewd || '';
    const parsed = parseAuditJson(orig);

    let recId = '';
    if (parsed && parsed.id !== undefined) recId = parsed.id;
    else if (r.recid !== undefined) recId = r.recid;
    else if (r.objid !== undefined) recId = r.objid;
    else if (r.rowid !== undefined) recId = r.rowid;
    else if (r.did !== undefined) recId = r.did;
    else if (r.val !== undefined) recId = r.val;

    const d = r.sdate ? parseTrackDate(r.sdate) : null;
    const uid = r.uid != null ? String(r.uid) : '';

    return {
      id: r.id != null ? String(r.id) : '',
      recId: String(recId),
      tbl: r.tbl || '',
      sdate: d ? formatDate(d) : (r.sdate || ''),
      sdateTime: d ? d.getTime() : 0,
      userName: userMap[uid] || uid,
      act: r.act || '',
      changesHtml: formatAuditChanges(orig, neu),
    };
  });

  displayRows.sort((a, b) => (b.sdateTime || 0) - (a.sdateTime || 0));
  renderAuditWindow(displayRows);
}

function renderAuditWindow(displayRows) {
  const rowsJson = JSON.stringify(displayRows).replace(/</g, '\\u003c');

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Audit Results</title>
<style>
  body{font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;padding:20px;color:#333;background-color:#f9f9f9;}
  table{border-collapse:collapse;width:100%;box-shadow:0 2px 5px rgba(0,0,0,0.1);background:#fff;}
  th,td{border:1px solid #ddd;padding:8px 10px;vertical-align:top;font-size:13px;}
  th{background:#f1f1f1;text-align:left;font-weight:600;color:#555;}
  tr:nth-child(even){background-color:#fcfcfc;}
  tr:hover{background-color:#f1f7ff;}
  button{padding:8px 16px;cursor:pointer;background:#0078d4;color:#fff;border:none;border-radius:4px;font-size:14px;}
  button:hover{background:#0060aa;}
  .audit-filter-row input{width:100%;box-sizing:border-box;padding:4px 6px;border:1px solid #d0d7de;border-radius:3px;font-size:12px;}
  .audit-filter-row input:focus{outline:none;border-color:#0078d4;}
  th.sortable{cursor:pointer;user-select:none;}
  th.sortable:hover{background:#e1e5eb;}
  th.sort-asc::after{content:" ▲";}
  th.sort-desc::after{content:" ▼";}
  .change-list div{white-space:normal;word-break:break-all;}
  .old{color:#c0392b;}
  .new{color:#27ae60;}
</style>
</head>
<body>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
  <h2 style="margin:0;">Audit Results (<span id="auditCount">${displayRows.length}</span> records)</h2>
  <div>
    <button id="downloadXlsx">Download XLSX</button>
    <button id="closeBtn" style="background:#888;">Close</button>
  </div>
</div>
<table id="auditTable">
  <thead>
    <tr>
      <th class="sortable" data-col="id" style="width:50px;">ID</th>
      <th class="sortable" data-col="recId" style="width:70px;">Record ID</th>
      <th class="sortable" data-col="tbl" style="width:90px;">Table</th>
      <th class="sortable" data-col="sdateTime" data-display="sdate" style="width:140px;">Date</th>
      <th class="sortable" data-col="userName" style="width:130px;">User</th>
      <th class="sortable" data-col="act" style="width:70px;">Action</th>
      <th class="sortable" data-col="changesHtml">Changes</th>
    </tr>
    <tr class="audit-filter-row">
      <th><input type="text" data-col="id" placeholder="Фильтр"></th>
      <th><input type="text" data-col="recId" placeholder="Фильтр"></th>
      <th><input type="text" data-col="tbl" placeholder="Фильтр"></th>
      <th><input type="text" data-col="sdate" placeholder="Фильтр"></th>
      <th><input type="text" data-col="userName" placeholder="Фильтр"></th>
      <th><input type="text" data-col="act" placeholder="Фильтр"></th>
      <th><input type="text" data-col="changesHtml" placeholder="Фильтр"></th>
    </tr>
  </thead>
  <tbody></tbody>
</table>
<script>
const auditRows = ${rowsJson};
const auditFilters = {};
const auditSort = { column: 'sdateTime', dir: -1 };

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return tmp.textContent || tmp.innerText || '';
}

function renderAuditBody() {
  let filtered = auditRows.slice();

  Object.keys(auditFilters).forEach((col) => {
    const val = auditFilters[col];
    if (val == null || val === '') return;
    const needle = String(val).toLowerCase();
    filtered = filtered.filter((row) => {
      const s = col === 'changesHtml' ? stripHtml(row.changesHtml) : (row[col] || '');
      return String(s).toLowerCase().includes(needle);
    });
  });

  if (auditSort.column) {
    const col = auditSort.column;
    const dir = auditSort.dir;
    filtered.sort((a, b) => {
      if (col === 'sdateTime') return ((a.sdateTime || 0) - (b.sdateTime || 0)) * dir;
      const av = a[col];
      const bv = b[col];
      if (av == null && bv == null) return 0;
      if (av == null) return 1 * dir;
      if (bv == null) return -1 * dir;
      const as = String(av).trim();
      const bs = String(bv).trim();
      if (as !== '' && bs !== '' && !isNaN(parseFloat(as)) && !isNaN(parseFloat(bs))) {
        return (parseFloat(as) - parseFloat(bs)) * dir;
      }
      return String(av).localeCompare(String(bv), 'ru', { numeric: true }) * dir;
    });
  }

  document.getElementById('auditCount').textContent = String(filtered.length);

  const tbody = document.querySelector('#auditTable tbody');
  tbody.innerHTML = '';
  filtered.forEach((row) => {
    const tr = document.createElement('tr');
    ['id', 'recId', 'tbl', 'sdate', 'userName', 'act'].forEach((col) => {
      const td = document.createElement('td');
      td.textContent = row[col] || '';
      tr.appendChild(td);
    });
    const tdChanges = document.createElement('td');
    tdChanges.className = 'change-list';
    tdChanges.innerHTML = row.changesHtml || '';
    tr.appendChild(tdChanges);
    tbody.appendChild(tr);
  });
}

function updateSortIndicators() {
  document.querySelectorAll('#auditTable thead th.sortable').forEach((th) => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === auditSort.column) {
      th.classList.add(auditSort.dir === 1 ? 'sort-asc' : 'sort-desc');
    }
  });
}

document.querySelectorAll('#auditTable thead th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (auditSort.column === col) auditSort.dir = -auditSort.dir;
    else { auditSort.column = col; auditSort.dir = 1; }
    updateSortIndicators();
    renderAuditBody();
  });
});

document.querySelectorAll('#auditTable .audit-filter-row input').forEach((inp) => {
  inp.addEventListener('input', () => {
    auditFilters[inp.dataset.col] = inp.value;
    renderAuditBody();
  });
});

function downloadXLSX() {
  const headers = ['ID', 'Record ID', 'Table', 'Date', 'User', 'Action', 'Changes'];
  const wsData = [headers];
  document.querySelectorAll('#auditTable tbody tr').forEach((tr) => {
    const row = [];
    for (let i = 0; i < 6; i++) row.push(tr.children[i].textContent || '');
    const changeCell = tr.children[6];
    const changeText = (changeCell.innerText || changeCell.textContent || '')
      .replace(/\\n/g, ' | ').replace(/\\s+/g, ' ').trim();
    row.push(changeText);
    wsData.push(row);
  });

  const XLSX = window.opener && window.opener.XLSX;
  if (typeof XLSX !== 'undefined' && XLSX && typeof XLSX.utils !== 'undefined') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Audit');
    XLSX.writeFile(wb, 'audit_results_' + new Date().toISOString().replace(/[:.]/g, '-') + '.xlsx');
    return;
  }

  // Фолбэк: CSV через data-uri
  const csv = wsData
    .map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(','))
    .join('\\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'audit_results.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

document.getElementById('downloadXlsx').addEventListener('click', downloadXLSX);
document.getElementById('closeBtn').addEventListener('click', () => window.close());

renderAuditBody();
updateSortIndicators();
<\/script>
</body>
</html>`;

  const w = window.open('about:blank', '_blank');
  if (!w) {
    alert('Блокировка всплывающих окон. Разрешите popup для просмотра результатов аудита.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
