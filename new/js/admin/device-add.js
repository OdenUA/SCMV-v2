// Мастер пакетного создания пары «устройство + ТС» с автопривязкой deviceid.
// Конечный автомат строго по одной строке:
//   Device Edit/rowadd → Vehicle Edit Distribution/rowadd →
//   [синхронизация счётчиков id: vehspin | devdel+devdel2+devspin (+devspindel+devspindel2)] →
//   Device Edit/rowsave → Vehicle Edit Distribution/rowsave (с deviceid).
// Протокол: DEVICE_VEHICLE_API.md.

import { getSocket, onPacket, sendRequest } from '../core/ws.js';
import { auth } from '../core/auth.js';
import { showToast } from '../core/utils.js';

const DEV_DEFAULTS = {
  workstatus: '1', debug: '1', proto: '11',
  maxinactive: '3600', periodicaltime: '10', betweentimeout: '5',
};
const VEH_DEFAULTS = { brand: '1', link: '0', model: '130' };
const MAX_SPINS = 100;      // предел прокрутки счётчиков id
const STEP_TIMEOUT_MS = 15000;

let refs = null;            // {brands:[{key,val}], fleets:[{key,val}], links:[{key,val}], models:[string]}
let existingDevices = null; // {imei:{val:id}, iccid:{}, phone:{}}
let refsLoading = false;
let vedInitReceived = false;
let vedSetupReceived = false;
let devSetupReceived = false;

let saving = false;
let queue = [];
let current = null;         // {item, phase, devId, vehId, timer, spins, spinDelId}
let stats = { ok: 0, fail: 0 };
let bound = false;

function tbody() { return document.getElementById('dvaTableBody'); }

/** Прямая отправка через socket (без глобального статуса/оверлея). */
function dvaSend(req) {
  req.usr = auth.user;
  req.pwd = auth.pwd;
  req.uid = auth.uid;
  req.lang = 'ru';
  const socket = getSocket();
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(req));
    return true;
  }
  showToast('⚠ WebSocket не подключен');
  return false;
}

// ============================ Справочники ============================

function requestRefs() {
  refsLoading = true;
  vedInitReceived = false;
  vedSetupReceived = false;
  devSetupReceived = false;
  dvaSend({ name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'init' });
  dvaSend({ name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'setup', filter: [], nowait: true, waitfor: [] });
  // полный список устройств — для проверки уникальности imei/iccid/phone
  dvaSend({ name: 'Device Edit', type: 'etbl', mid: 2, act: 'setup', filter: [], nowait: true, waitfor: [] });
}

function maybeFinishRefs() {
  if (vedInitReceived && vedSetupReceived && devSetupReceived) {
    refsLoading = false;
    fillEmptyRowSelects();
    revalidateAll(); // база устройств подгрузилась — проверить дубли
  }
}

function captureExistingDevices(rows) {
  existingDevices = { imei: {}, iccid: {}, phone: {} };
  rows.forEach((r) => {
    if (!r) return;
    ['imei', 'iccid', 'phone'].forEach((f) => {
      if (r[f] != null && String(r[f]) !== '') existingDevices[f][String(r[f])] = r.id;
    });
  });
}

function captureRefsFromCols(cols) {
  if (!refs) refs = { brands: [], fleets: [], links: [], models: [] };
  cols.forEach((c) => {
    if (!c || !c.f || !Array.isArray(c.k) || !c.k.length) return;
    const list = c.k
      .map((e) => ({ key: String(e.key), val: (e.val == null || e.val === '' ? '—' : String(e.val)) }))
      .filter((e) => e.key !== 'null' && (e.val !== '—' || c.f === 'brand'));
    if (c.f === 'brand') refs.brands = list;
    else if (c.f === 'fleet') refs.fleets = list;
    else if (c.f === 'link') refs.links = list;
  });
}

function captureModelsFromRows(rows) {
  if (!refs) refs = { brands: [], fleets: [], links: [], models: [] };
  const seen = {};
  rows.forEach((r) => {
    if (r && r.model != null && String(r.model).trim() !== '') seen[String(r.model).trim()] = true;
  });
  refs.models = Object.keys(seen).sort();
}

function refsReady() {
  return !!refs && refs.fleets.length > 0 && existingDevices !== null;
}

// ============================ Таблица строк ============================

function buildSelect(opts, selectedKey) {
  const sel = document.createElement('select');
  opts.forEach((o) => {
    const op = document.createElement('option');
    if (o && typeof o === 'object' && 'key' in o) {
      op.value = String(o.key);
      op.textContent = o.val != null && o.val !== '' ? o.val : String(o.key);
    } else {
      op.value = String(o);
      op.textContent = String(o);
    }
    sel.appendChild(op);
  });
  if (selectedKey != null) sel.value = String(selectedKey);
  return sel;
}

function addRow(data) {
  data = data || {};
  const tr = document.createElement('tr');
  const t = tbody();
  if (!t) return null;

  function tdInput(value, width, cls) {
    const td = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value || '';
    if (width) inp.style.width = width;
    if (cls) inp.className = cls;
    td.appendChild(inp);
    tr.appendChild(td);
    return inp;
  }
  function tdSelect(opts, selectedKey) {
    const td = document.createElement('td');
    td.appendChild(buildSelect(opts, selectedKey));
    tr.appendChild(td);
  }

  tdInput(data.imei, '125px', 'dva-imei');
  tdInput(data.iccid, '165px', 'dva-iccid');
  tdInput(data.phone, '85px', 'dva-phone');
  tdInput(data.proto != null ? data.proto : DEV_DEFAULTS.proto, '50px', 'dva-proto');
  tdInput(data.number != null ? data.number : (data.imei || ''), '125px', 'dva-number');
  tdSelect(refs ? refs.brands : [], data.brand != null ? data.brand : VEH_DEFAULTS.brand);
  tdSelect(refs ? refs.models : [], data.model != null ? data.model : VEH_DEFAULTS.model);
  // fleet: без пустой опции, если значение не задано — иначе молча подставится первый филиал
  let fleetOpts = refs ? refs.fleets.slice() : [];
  if (data.fleet == null) fleetOpts.unshift({ key: '', val: '— выберите филиал —' });
  tdSelect(fleetOpts, data.fleet != null ? data.fleet : '');
  tdInput(data.notes, '', 'dva-notes');

  const tdStatus = document.createElement('td');
  tdStatus.className = 'dva-status';
  tdStatus.textContent = '—';
  tr.appendChild(tdStatus);

  const tdDel = document.createElement('td');
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-danger btn-xs';
  delBtn.textContent = '×';
  delBtn.title = 'Удалить строку';
  delBtn.addEventListener('click', () => {
    if (saving) return;
    tr.remove();
  });
  tdDel.appendChild(delBtn);
  tr.appendChild(tdDel);

  t.appendChild(tr);

  if (data.fleetError) {
    tr.dataset.fleetError = data.fleetError;
    tr.classList.add('dva-row-error');
    tdStatus.textContent = 'филиал не найден';
    tdStatus.title = `Не удалось сопоставить: «${data.fleetError}». Выберите филиал вручную.`;
  }
  return tr;
}

// ============================ Парсер вставки из Excel ============================

function normFleetName(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
}

function findFleetKey(name) {
  const target = normFleetName(name);
  if (!target || !refs) return null;
  for (const f of refs.fleets) {
    if (normFleetName(f.val) === target) return f.key;
  }
  return null;
}

function parsePaste(text) {
  let added = 0;
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line) => {
    line = line.replace(/^\s+|\s+$/g, '');
    if (!line) return;
    const tokens = line.split(/[\t\s;]+/).filter((x) => x !== '');
    const row = { imei: '', iccid: '', phone: '', fleet: null, fleetError: null };
    const textParts = [];
    tokens.forEach((tok) => {
      if (/^\d{15}$/.test(tok)) row.imei = tok;
      else if (/^\d{19,20}$/.test(tok)) row.iccid = tok;
      else if (/^\d{6,12}$/.test(tok)) row.phone = tok;
      else textParts.push(tok);
    });
    if (textParts.length) {
      const fleetName = textParts.join(' ');
      const key = findFleetKey(fleetName);
      if (key != null) row.fleet = key;
      else row.fleetError = fleetName;
    }
    if (!row.imei && !row.iccid && !row.phone) return; // мусорная строка
    addRow(row);
    added++;
  });
  return added;
}

// ============================ Валидация ============================

function setStatus(item, text, mode) {
  const td = item.tr.querySelector('.dva-status');
  if (td) td.textContent = text;
  item.tr.classList.remove('dva-row-error', 'dva-row-ok');
  if (mode === 'err') item.tr.classList.add('dva-row-error');
  else if (mode === 'ok') item.tr.classList.add('dva-row-ok');
}

function updateSummary() {
  const el = document.getElementById('dvaSummary');
  if (!el) return;
  el.textContent = saving
    ? `Сохранение: ${stats.ok + stats.fail} из ${queue.length} (ошибок: ${stats.fail})`
    : (queue.length
      ? `Готово: ${stats.ok} из ${queue.length}${stats.fail ? `, ошибок: ${stats.fail}` : ''}`
      : '');
}

function collectRows() {
  const rows = [];
  const trs = tbody() ? tbody().querySelectorAll('tr') : [];
  trs.forEach((tr) => {
    const inputs = tr.querySelectorAll('input');
    const selects = tr.querySelectorAll('select');
    rows.push({
      tr,
      imei: (inputs[0] ? inputs[0].value : '').replace(/\s+/g, ''),
      iccid: (inputs[1] ? inputs[1].value : '').replace(/\s+/g, ''),
      phone: (inputs[2] ? inputs[2].value : '').replace(/\s+/g, ''),
      proto: (inputs[3] ? inputs[3].value : '').replace(/\s+/g, ''),
      number: (inputs[4] ? inputs[4].value : '').replace(/^\s+|\s+$/g, ''),
      brand: selects[0] ? selects[0].value : '',
      model: selects[1] ? selects[1].value : '',
      fleet: selects[2] ? selects[2].value : '',
      notes: (inputs[5] ? inputs[5].value : '').replace(/^\s+|\s+$/g, ''),
    });
  });
  return rows;
}

function isEmptyRow(item) {
  return !item.imei && !item.iccid && !item.phone && !item.number && !item.notes && !item.fleet;
}

function validate(item, allItems) {
  if (!/^\d{15}$/.test(item.imei)) return 'IMEI должен содержать 15 цифр';
  if (item.iccid && !/^\d{19,20}$/.test(item.iccid)) return 'ICCID должен содержать 19–20 цифр';
  if (!item.fleet) return 'выберите филиал';
  return checkUnique(item, allItems);
}

function checkUnique(item, allItems) {
  const fields = [
    { key: 'imei', label: 'IMEI' },
    { key: 'iccid', label: 'ICCID' },
    { key: 'phone', label: 'Телефон' },
  ];
  for (const f of fields) {
    const val = item[f.key];
    if (!val) continue;
    // дубль внутри таблицы
    for (const other of allItems) {
      if (other === item || isEmptyRow(other)) continue;
      if (other[f.key] && other[f.key] === val) return `${f.label} дублируется в таблице`;
    }
    // дубль в базе
    if (existingDevices && existingDevices[f.key][val] !== undefined) {
      return `${f.label} уже есть в базе (id ${existingDevices[f.key][val]})`;
    }
  }
  return null;
}

function revalidateAll() {
  const items = collectRows();
  items.forEach((item) => {
    if (item.tr.classList.contains('dva-row-ok')) return; // созданные не трогаем
    if (isEmptyRow(item)) { setStatus(item, '—'); return; }
    let err = validate(item, items);
    if (err === 'выберите филиал' && item.tr.dataset.fleetError) err = 'филиал не найден';
    if (err) setStatus(item, err, 'err');
    else setStatus(item, '—');
  });
}

// ============================ Очередь сохранения (FSM) ============================

function startSave() {
  if (saving) return;
  const allItems = collectRows();
  queue = allItems.filter((item) => {
    if (isEmptyRow(item)) { setStatus(item, '—'); return false; }
    const err = validate(item, allItems);
    if (err) { setStatus(item, err, 'err'); return false; }
    return true;
  });
  if (!queue.length) {
    showToast('Нет корректных строк для сохранения');
    return;
  }
  saving = true;
  stats = { ok: 0, fail: 0 };
  const saveBtn = document.getElementById('dvaSaveBtn');
  if (saveBtn) saveBtn.disabled = true;
  updateSummary();
  nextRow();
}

function nextRow() {
  if (!queue.length) { finishSave(); return; }
  const item = queue.shift();
  current = { item, phase: 'devadd', devId: null, vehId: null, timer: null, spins: 0, spinDelId: null };
  setStatus(item, 'создание устройства…');
  armTimer();
  dvaSend({ name: 'Device Edit', type: 'etbl', mid: 2, act: 'rowadd' });
}

function armTimer() {
  if (!current) return;
  clearTimeout(current.timer);
  current.timer = setTimeout(() => failCurrent('таймаут ответа сервера'), STEP_TIMEOUT_MS);
}

function failCurrent(errText) {
  if (!current) return;
  clearTimeout(current.timer);
  setStatus(current.item, `ошибка: ${errText}`, 'err');
  stats.fail++;
  updateSummary();
  current = null;
  setTimeout(nextRow, 300);
}

function checkErr(data) {
  if (data.ern && data.ern !== 0) return data.msg || (`ern=${data.ern}`);
  const r = data.res && data.res[0];
  if (r && r.ern && r.ern !== 0) return r.msg || (`ern=${r.ern}`);
  return null;
}

function respRowId(data) {
  const row = data.res && data.res[0] && data.res[0].f && data.res[0].f[0];
  return row && row.id != null ? Number(row.id) : null;
}

function saveDevice() {
  const item = current.item;
  current.phase = 'devsave';
  setStatus(item, 'запись устройства…');
  armTimer();
  dvaSend({
    name: 'Device Edit', type: 'etbl', mid: 2, act: 'rowsave',
    cols: {
      id: String(current.devId),
      imei: item.imei, iccid: item.iccid, phone: item.phone,
      workstatus: DEV_DEFAULTS.workstatus, debug: DEV_DEFAULTS.debug,
      proto: item.proto || DEV_DEFAULTS.proto,
      maxinactive: DEV_DEFAULTS.maxinactive,
      periodicaltime: DEV_DEFAULTS.periodicaltime,
      betweentimeout: DEV_DEFAULTS.betweentimeout,
    },
  });
}

function saveVehicle() {
  const item = current.item;
  current.phase = 'vehsave';
  setStatus(item, 'запись ТС…');
  armTimer();
  dvaSend({
    name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'rowsave',
    cols: {
      id: String(current.vehId),
      number: item.number || item.imei,
      brand: String(item.brand), model: String(item.model),
      link: VEH_DEFAULTS.link, notes: item.notes,
      fleet: String(item.fleet),
      deviceid: String(current.devId), // автопривязка к устройству
    },
  });
}

function stepResponse(data) {
  const item = current.item;
  const err = checkErr(data);
  if (err) { failCurrent(err); return; }

  const p = current.phase;
  if (p === 'devadd') {
    const devId = respRowId(data);
    if (devId == null) { failCurrent('сервер не вернул id устройства'); return; }
    current.devId = devId;
    current.phase = 'vehadd';
    setStatus(item, 'создание ТС…');
    armTimer();
    dvaSend({ name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'rowadd' });
  } else if (p === 'vehadd' || p === 'vehspin') {
    const vehId = respRowId(data);
    if (vehId == null) { failCurrent('сервер не вернул id транспорта'); return; }
    current.vehId = vehId;
    if (vehId === current.devId) {
      saveDevice(); // id совпали — сохраняем устройство, затем ТС
    } else if (vehId < current.devId) {
      // счётчик транспорта отстал: прокручиваем rowadd (не персистится), пока не догонит
      if (++current.spins > MAX_SPINS) {
        failCurrent(`не удалось синхронизировать id (ТС ${vehId} < устройство ${current.devId})`);
        return;
      }
      current.phase = 'vehspin';
      setStatus(item, `синхронизация id… (ТС ${vehId} → ${current.devId})`);
      armTimer();
      dvaSend({ name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'rowadd' });
    } else {
      // счётчик транспорта убежал вперёд: удаляем созданное устройство и догоняем его счётчиком устройств
      current.phase = 'devdel';
      setStatus(item, `синхронизация id… (устройство ${current.devId} → ${vehId})`);
      armTimer();
      dvaSend({ name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'rowdel', cols: { id: String(current.devId) } });
    }
  } else if (p === 'devdel') {
    current.phase = 'devdel2';
    armTimer();
    dvaSend({ name: 'Device Edit', type: 'etbl', mid: 2, act: 'rowdel', cols: { id: String(current.devId) } });
  } else if (p === 'devdel2') {
    current.phase = 'devspin';
    armTimer();
    dvaSend({ name: 'Device Edit', type: 'etbl', mid: 2, act: 'rowadd' });
  } else if (p === 'devspin') {
    const spinId = respRowId(data);
    if (spinId == null) { failCurrent('сервер не вернул id устройства'); return; }
    if (spinId === current.vehId) {
      current.devId = spinId;
      saveDevice();
    } else if (spinId < current.vehId) {
      if (++current.spins > MAX_SPINS) {
        failCurrent(`не удалось синхронизировать id (устройство ${spinId} < транспорт ${current.vehId})`);
        return;
      }
      current.phase = 'devspindel';
      current.spinDelId = spinId;
      armTimer();
      // промежуточную строку удаляем из ОБЕИХ таблиц (объекты + детали устройства)
      dvaSend({ name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'rowdel', cols: { id: String(spinId) } });
    } else {
      failCurrent(`счётчик устройств перескочил id транспорта (${spinId} > ${current.vehId})`);
    }
  } else if (p === 'devspindel') {
    current.phase = 'devspindel2';
    armTimer();
    dvaSend({ name: 'Device Edit', type: 'etbl', mid: 2, act: 'rowdel', cols: { id: String(current.spinDelId) } });
  } else if (p === 'devspindel2') {
    current.phase = 'devspin';
    armTimer();
    dvaSend({ name: 'Device Edit', type: 'etbl', mid: 2, act: 'rowadd' });
  } else if (p === 'devsave') {
    saveVehicle();
  } else if (p === 'vehsave') {
    clearTimeout(current.timer);
    setStatus(item, `Сохранено в БД (id ${current.devId})`, 'ok');
    stats.ok++;
    // регистрируем созданное устройство в локальном кэше уникальности
    if (existingDevices) {
      if (item.imei) existingDevices.imei[item.imei] = current.devId;
      if (item.iccid) existingDevices.iccid[item.iccid] = current.devId;
      if (item.phone) existingDevices.phone[item.phone] = current.devId;
    }
    updateSummary();
    current = null;
    setTimeout(nextRow, 300);
  }
}

function finishSave() {
  saving = false;
  current = null;
  const saveBtn = document.getElementById('dvaSaveBtn');
  if (saveBtn) saveBtn.disabled = false;
  const total = stats.ok + stats.fail;
  const el = document.getElementById('dvaSummary');
  if (el) el.textContent = `Создано ${stats.ok} из ${total}${stats.fail ? `, ошибок: ${stats.fail}` : ''}`;
  showToast(`Создано ${stats.ok} из ${total}`);
  // рефреш таблиц
  try {
    sendRequest({
      name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'setup',
      filter: [], nowait: true, waitfor: [], lang: 'ru',
    });
  } catch (e) {
    console.warn('dva: refresh failed', e);
  }
}

// ============================ Маршрутизация WS-ответов ============================

function handlePacket(data) {
  try {
    if (!data || !data.name) return false;
    if (data.name !== 'Device Edit' && data.name !== 'Vehicle Edit Distribution') return false;

    // загрузка справочников
    if (refsLoading) {
      const packet = data.res && data.res[0];
      if (data.name === 'Vehicle Edit Distribution' && data.act === 'init' && !vedInitReceived && packet && Array.isArray(packet.cols)) {
        captureRefsFromCols(packet.cols);
        vedInitReceived = true;
        maybeFinishRefs();
        return true;
      }
      if (data.name === 'Vehicle Edit Distribution' && data.act === 'setup' && !vedSetupReceived && packet && Array.isArray(packet.f)) {
        captureModelsFromRows(packet.f);
        vedSetupReceived = true;
        maybeFinishRefs();
        return true;
      }
      if (data.name === 'Device Edit' && data.act === 'setup' && !devSetupReceived && packet && Array.isArray(packet.f)) {
        captureExistingDevices(packet.f);
        devSetupReceived = true;
        maybeFinishRefs();
        return true;
      }
      return true; // режим загрузки справочников — поглощаем остальное
    }

    if (!saving || !current) return false;
    const p = current.phase;
    if (data.name === 'Device Edit' && data.act === 'rowadd' && (p === 'devadd' || p === 'devspin')) { stepResponse(data); return true; }
    if (data.name === 'Device Edit' && data.act === 'rowsave' && p === 'devsave') { stepResponse(data); return true; }
    if (data.name === 'Device Edit' && data.act === 'rowdel' && (p === 'devdel2' || p === 'devspindel2')) { stepResponse(data); return true; }
    if (data.name === 'Vehicle Edit Distribution' && data.act === 'rowadd' && (p === 'vehadd' || p === 'vehspin')) { stepResponse(data); return true; }
    if (data.name === 'Vehicle Edit Distribution' && data.act === 'rowsave' && p === 'vehsave') { stepResponse(data); return true; }
    if (data.name === 'Vehicle Edit Distribution' && data.act === 'rowdel' && (p === 'devdel' || p === 'devspindel')) { stepResponse(data); return true; }
    return false;
  } catch (e) {
    console.warn('dva handler error', e);
    return false;
  }
}

// если справочники подгрузились, а пустая строка уже есть — обновить её селекты
function fillEmptyRowSelects() {
  const trs = tbody() ? tbody().querySelectorAll('tr') : [];
  if (!trs.length) {
    const modal = document.getElementById('deviceAddModal');
    if (modal && modal.classList.contains('open')) addRow();
    return;
  }
  trs.forEach((tr) => {
    const selects = tr.querySelectorAll('select');
    selects.forEach((sel, j) => {
      if (sel.options.length) return;
      let opts = j === 0 ? refs.brands : (j === 1 ? refs.models : refs.fleets.slice());
      const def = j === 0 ? VEH_DEFAULTS.brand : (j === 1 ? VEH_DEFAULTS.model : '');
      if (j === 2) opts.unshift({ key: '', val: '— выберите филиал —' });
      sel.parentNode.replaceChild(buildSelect(opts, def), sel);
    });
  });
}

// ============================ Открытие/закрытие и биндинги ============================

export function openDeviceAddModal() {
  const modal = document.getElementById('deviceAddModal');
  if (!modal) return;
  // всегда перечитываем справочники и базу устройств — данные могли измениться
  if (!refsLoading) requestRefs();
  modal.classList.add('open');
  if (tbody() && !tbody().querySelector('tr') && refsReady()) addRow();
}

function tryCloseModal() {
  if (saving) {
    showToast('Идёт сохранение, дождитесь завершения');
    return;
  }
  const modal = document.getElementById('deviceAddModal');
  if (modal) modal.classList.remove('open');
}

export function initDeviceAdd() {
  if (bound) return;
  bound = true;

  onPacket('Device Edit', handlePacket, { predicate: () => refsLoading || (saving && !!current), priority: 20 });
  onPacket('Vehicle Edit Distribution', handlePacket, { predicate: () => refsLoading || (saving && !!current), priority: 20 });

  const parseBtn = document.getElementById('dvaParseBtn');
  if (parseBtn) {
    parseBtn.addEventListener('click', () => {
      if (!refsReady()) {
        showToast('Справочники ещё загружаются, повторите через секунду');
        return;
      }
      const area = document.getElementById('dvaPasteArea');
      const n = parsePaste(area ? area.value : '');
      if (n > 0) {
        if (area) area.value = '';
        showToast(`Добавлено строк: ${n}`);
        revalidateAll();
      } else {
        showToast('Не удалось распознать ни одной строки');
      }
    });
  }

  const addBtn = document.getElementById('dvaAddRowBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (!refsReady()) {
        showToast('Справочники ещё загружаются, повторите через секунду');
        return;
      }
      addRow();
    });
  }

  const t = tbody();
  if (t) {
    // живая перепроверка дублей при ручном редактировании ячеек
    t.addEventListener('change', () => {
      if (!saving) revalidateAll();
    });
  }

  const saveBtn = document.getElementById('dvaSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', startSave);

  const cancelBtn = document.getElementById('dvaCancelBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', tryCloseModal);
}
