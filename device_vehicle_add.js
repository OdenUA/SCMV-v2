/* device_vehicle_add.js — модальное окно пакетного создания пары «устройство + транспорт»
 * с автопривязкой через deviceid. Протокол описан в DEVICE_VEHICLE_API.md.
 * Поток на строку: Device Edit/rowadd -> Device Edit/rowsave ->
 * Vehicle Edit Distribution/rowadd -> Vehicle Edit Distribution/rowsave (с deviceid).
 */
(function () {
  'use strict';

  // Дефолты полей устройства (по перехвату v1)
  var DEV_DEFAULTS = {
    workstatus: '1', debug: '1', proto: '11',
    maxinactive: '3600', periodicaltime: '10', betweentimeout: '5'
  };
  var VEH_DEFAULTS = { brand: '1', link: '0', model: '130' };

  var refs = null;          // {brands:[{key,val}], fleets:[{key,val}], links:[{key,val}], models:[string]}
  var refsLoading = false;  // идёт загрузка справочников (init+setup), ответы перехватываем
  var saving = false;       // идёт очередь сохранения
  var queue = [];           // [{tr, imei, iccid, phone, number, brand, model, fleet, notes}]
  var current = null;       // {item, phase, devId, vehId, timer}
  var stats = { ok: 0, fail: 0 };

  function $(id) { return document.getElementById(id); }
  function modal() { return $('deviceVehicleAddModal'); }
  function tbody() { return $('dvaTableBody'); }

  function dvaSend(req) {
    req.usr = (typeof authUser !== 'undefined') ? authUser : '';
    req.pwd = (typeof authPwd !== 'undefined') ? authPwd : '';
    req.uid = (typeof authUid !== 'undefined') ? authUid : 0;
    req.lang = 'ru';
    // напрямую через socket, чтобы не поднимать глобальный loading-оверлей на каждый пакет
    if (typeof socket !== 'undefined' && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(req));
    } else {
      showRouteToast('⚠ WebSocket не подключен', 3000);
    }
  }

  // ---------- Справочники ----------

  var existingDevices = null; // {imei: {val: id}, iccid: {val: id}, phone: {val: id}} — для проверки уникальности
  var vedInitReceived = false, vedSetupReceived = false, devSetupReceived = false;

  function requestRefs() {
    refsLoading = true;
    vedInitReceived = vedSetupReceived = devSetupReceived = false;
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
    rows.forEach(function (r) {
      if (!r) return;
      if (r.imei != null && String(r.imei) !== '') existingDevices.imei[String(r.imei)] = r.id;
      if (r.iccid != null && String(r.iccid) !== '') existingDevices.iccid[String(r.iccid)] = r.id;
      if (r.phone != null && String(r.phone) !== '') existingDevices.phone[String(r.phone)] = r.id;
    });
  }

  function captureRefsFromCols(cols) {
    if (!refs) refs = { brands: [], fleets: [], links: [], models: [] };
    cols.forEach(function (c) {
      if (!c || !c.f || !Array.isArray(c.k) || !c.k.length) return;
      var list = c.k.map(function (e) { return { key: String(e.key), val: (e.val == null || e.val === '' ? '—' : String(e.val)) }; })
                    .filter(function (e) { return e.key !== 'null' && (e.val !== '—' || c.f === 'brand'); });
      if (c.f === 'brand') refs.brands = list;
      else if (c.f === 'fleet') refs.fleets = list;
      else if (c.f === 'link') refs.links = list;
    });
  }

  function captureModelsFromRows(rows) {
    if (!refs) refs = { brands: [], fleets: [], links: [], models: [] };
    var seen = {};
    rows.forEach(function (r) {
      if (r && r.model != null && String(r.model).trim() !== '') seen[String(r.model).trim()] = true;
    });
    refs.models = Object.keys(seen).sort();
  }

  function refsReady() {
    return refs && refs.fleets.length > 0 && existingDevices !== null;
  }

  // ---------- Таблица строк ----------

  function buildSelect(opts, selectedKey) {
    var sel = document.createElement('select');
    opts.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o.key !== undefined ? o.key : o;
      op.textContent = o.val !== undefined ? (o.val || o.key) : o;
      sel.appendChild(op);
    });
    if (selectedKey != null) sel.value = String(selectedKey);
    return sel;
  }

  function addRow(data) {
    data = data || {};
    var tr = document.createElement('tr');

    function tdInput(value, width, cls) {
      var td = document.createElement('td');
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.value = value || '';
      if (width) inp.style.width = width;
      if (cls) inp.className = cls;
      td.appendChild(inp);
      tr.appendChild(td);
      return inp;
    }
    function tdSelect(opts, selectedKey) {
      var td = document.createElement('td');
      td.appendChild(buildSelect(opts, selectedKey));
      tr.appendChild(td);
    }

    tdInput(data.imei, '130px', 'dva-imei');
    tdInput(data.iccid, '170px', 'dva-iccid');
    tdInput(data.phone, '90px', 'dva-phone');
    tdInput(data.proto != null ? data.proto : DEV_DEFAULTS.proto, '55px', 'dva-proto');
    tdInput(data.number != null ? data.number : (data.imei || ''), '130px', 'dva-number');
    tdSelect(refs.brands, data.brand != null ? data.brand : VEH_DEFAULTS.brand);
    tdSelect(refs.models, data.model != null ? data.model : VEH_DEFAULTS.model);
    // fleet: без пустой опции в начале, если значение не задано — иначе молча подставится первый филиал
    var fleetOpts = refs.fleets.slice();
    if (data.fleet == null) fleetOpts.unshift({ key: '', val: '— выберите филиал —' });
    tdSelect(fleetOpts, data.fleet != null ? data.fleet : '');
    tdInput(data.notes, '', 'dva-notes');

    var tdStatus = document.createElement('td');
    tdStatus.className = 'dva-status';
    tdStatus.textContent = '—';
    tr.appendChild(tdStatus);

    var tdDel = document.createElement('td');
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-danger btn-xs';
    delBtn.textContent = '×';
    delBtn.title = 'Удалить строку';
    delBtn.addEventListener('click', function () {
      if (saving) return;
      tr.parentNode.removeChild(tr);
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    tbody().appendChild(tr);

    if (data.fleetError) {
      tr.dataset.fleetError = data.fleetError;
      tr.classList.add('dva-row-error');
      tdStatus.textContent = 'филиал не найден';
      tdStatus.title = 'Не удалось сопоставить: «' + data.fleetError + '». Выберите филиал вручную.';
    }
    return tr;
  }

  // ---------- Парсер вставки из Excel ----------

  function normFleetName(s) {
    return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  }

  function findFleetKey(name) {
    var target = normFleetName(name);
    if (!target || !refs) return null;
    for (var i = 0; i < refs.fleets.length; i++) {
      if (normFleetName(refs.fleets[i].val) === target) return refs.fleets[i].key;
    }
    return null;
  }

  function parsePaste(text) {
    var added = 0;
    var lines = String(text || '').split(/\r?\n/);
    lines.forEach(function (line) {
      line = line.replace(/^\s+|\s+$/g, '');
      if (!line) return;
      var tokens = line.split(/[\t\s;]+/).filter(function (t) { return t !== ''; });
      var row = { imei: '', iccid: '', phone: '', fleet: null, fleetError: null };
      var textParts = [];
      tokens.forEach(function (tok) {
        if (/^\d{15}$/.test(tok)) row.imei = tok;
        else if (/^\d{19,20}$/.test(tok)) row.iccid = tok;
        else if (/^\d{6,12}$/.test(tok)) row.phone = tok;
        else textParts.push(tok);
      });
      if (textParts.length) {
        var fleetName = textParts.join(' ');
        var key = findFleetKey(fleetName);
        if (key != null) row.fleet = key;
        else row.fleetError = fleetName;
      }
      if (!row.imei && !row.iccid && !row.phone) return; // мусорная строка
      addRow(row);
      added++;
    });
    return added;
  }

  // ---------- Очередь сохранения ----------

  function setStatus(item, text, isErr) {
    var td = item.tr.querySelector('.dva-status');
    if (td) td.textContent = text;
    item.tr.classList.remove('dva-row-error', 'dva-row-ok');
    if (isErr) item.tr.classList.add('dva-row-error');
    else if (text === 'готово') item.tr.classList.add('dva-row-ok');
  }

  function updateSummary() {
    var el = $('dvaSummary');
    if (el) el.textContent = saving
      ? 'Сохранение: ' + (stats.ok + stats.fail) + ' из ' + queue.length + ' (ошибок: ' + stats.fail + ')'
      : (queue.length ? 'Готово: ' + stats.ok + ' из ' + queue.length + (stats.fail ? ', ошибок: ' + stats.fail : '') : '');
  }

  function collectRows() {
    var rows = [];
    var trs = tbody().querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      var tr = trs[i];
      var inputs = tr.querySelectorAll('input');
      var selects = tr.querySelectorAll('select');
      var item = {
        tr: tr,
        imei: inputs[0].value.replace(/\s+/g, ''),
        iccid: inputs[1].value.replace(/\s+/g, ''),
        phone: inputs[2].value.replace(/\s+/g, ''),
        proto: inputs[3].value.replace(/\s+/g, ''),
        number: inputs[4].value.replace(/^\s+|\s+$/g, ''),
        brand: selects[0].value,
        model: selects[1].value,
        fleet: selects[2].value,
        notes: inputs[5].value.replace(/^\s+|\s+$/g, '')
      };
      rows.push(item);
    }
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

  // уникальность: внутри таблицы и против существующей базы устройств
  function checkUnique(item, allItems) {
    var fields = [
      { key: 'imei', label: 'IMEI' },
      { key: 'iccid', label: 'ICCID' },
      { key: 'phone', label: 'Телефон' }
    ];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var val = item[f.key];
      if (!val) continue;
      // дубль внутри таблицы (другая строка с тем же значением)
      for (var j = 0; j < allItems.length; j++) {
        var other = allItems[j];
        if (other === item || isEmptyRow(other)) continue;
        if (other[f.key] && other[f.key] === val) return f.label + ' дублируется в таблице';
      }
      // дубль в базе
      if (existingDevices && existingDevices[f.key] && existingDevices[f.key][val] !== undefined) {
        return f.label + ' уже есть в базе (id ' + existingDevices[f.key][val] + ')';
      }
    }
    return null;
  }

  // мягкая проверка всех строк без запуска сохранения (после парсинга)
  function revalidateAll() {
    var items = collectRows();
    items.forEach(function (item) {
      if (item.tr.classList.contains('dva-row-ok')) return; // уже созданные не трогаем
      if (isEmptyRow(item)) { setStatus(item, '—'); return; }
      var err = validate(item, items);
      if (err === 'выберите филиал' && item.tr.dataset.fleetError) err = 'филиал не найден';
      if (err) setStatus(item, err, true);
      else setStatus(item, '—');
    });
  }

  function startSave() {
    if (saving) return;
    var allItems = collectRows();
    queue = allItems.filter(function (item) {
      if (isEmptyRow(item)) { setStatus(item, '—'); return false; } // пустые строки молча пропускаем
      var err = validate(item, allItems);
      if (err) { setStatus(item, err, true); return false; }
      return true;
    });
    if (!queue.length) { showRouteToast('Нет корректных строк для сохранения', 2500); return; }
    saving = true;
    stats = { ok: 0, fail: 0 };
    $('dvaSaveBtn').disabled = true;
    updateSummary();
    nextRow();
  }

  function nextRow() {
    if (!queue.length) { finishSave(); return; }
    var item = queue.shift();
    current = { item: item, phase: 'devadd', devId: null, vehId: null, timer: null };
    setStatus(item, 'создание устройства…');
    armTimer();
    dvaSend({ name: 'Device Edit', type: 'etbl', mid: 2, act: 'rowadd' });
  }

  function armTimer() {
    clearTimeout(current.timer);
    current.timer = setTimeout(function () {
      failCurrent('таймаут ответа сервера');
    }, 15000);
  }

  function failCurrent(errText) {
    if (!current) return;
    clearTimeout(current.timer);
    setStatus(current.item, 'ошибка: ' + errText, true);
    stats.fail++;
    updateSummary();
    current = null;
    setTimeout(nextRow, 300);
  }

  function checkErr(data) {
    if (data.ern && data.ern !== 0) return data.msg || ('ern=' + data.ern);
    if (data.res && data.res[0] && data.res[0].ern && data.res[0].ern !== 0) return data.res[0].msg || ('ern=' + data.res[0].ern);
    return null;
  }

  function stepResponse(data) {
    var item = current.item;
    var err = checkErr(data);
    if (err) { failCurrent(err); return; }

    if (current.phase === 'devadd') {
      var devRow = data.res && data.res[0] && data.res[0].f && data.res[0].f[0];
      if (!devRow || devRow.id == null) { failCurrent('сервер не вернул id устройства'); return; }
      current.devId = devRow.id;
      current.phase = 'devsave';
      setStatus(item, 'запись устройства…');
      armTimer();
      var devCols = {
        id: String(current.devId),
        imei: item.imei, iccid: item.iccid, phone: item.phone,
        workstatus: DEV_DEFAULTS.workstatus, debug: DEV_DEFAULTS.debug,
        proto: item.proto || DEV_DEFAULTS.proto, maxinactive: DEV_DEFAULTS.maxinactive,
        periodicaltime: DEV_DEFAULTS.periodicaltime, betweentimeout: DEV_DEFAULTS.betweentimeout
      };
      dvaSend({ name: 'Device Edit', type: 'etbl', mid: 2, act: 'rowsave', cols: devCols });
    } else if (current.phase === 'devsave') {
      current.phase = 'vehadd';
      setStatus(item, 'создание ТС…');
      armTimer();
      dvaSend({ name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'rowadd' });
    } else if (current.phase === 'vehadd') {
      var vehRow = data.res && data.res[0] && data.res[0].f && data.res[0].f[0];
      if (!vehRow || vehRow.id == null) { failCurrent('сервер не вернул id транспорта'); return; }
      current.vehId = vehRow.id; // обычно совпадает с devId; если нет — используем возвращённый
      current.phase = 'vehsave';
      setStatus(item, 'запись ТС…');
      armTimer();
      var vehCols = {
        id: String(current.vehId),
        number: item.number || item.imei,
        brand: String(item.brand), model: String(item.model),
        link: VEH_DEFAULTS.link, notes: item.notes,
        fleet: String(item.fleet),
        deviceid: String(current.devId) // автопривязка к устройству
      };
      dvaSend({ name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'rowsave', cols: vehCols });
    } else if (current.phase === 'vehsave') {
      clearTimeout(current.timer);
      setStatus(item, 'готово (id ' + current.devId + ')');
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
    $('dvaSaveBtn').disabled = false;
    var el = $('dvaSummary');
    if (el) el.textContent = 'Создано ' + stats.ok + ' из ' + (stats.ok + stats.fail) + (stats.fail ? ', ошибок: ' + stats.fail : '');
    showRouteToast('Создано ' + stats.ok + ' из ' + (stats.ok + stats.fail), 4000);
    // рефреш таблиц через штатный sendRequest (оверлей обновится сам)
    try {
      sendRequest({ name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'setup', filter: [], nowait: true, waitfor: [], usr: authUser, pwd: authPwd, uid: authUid, lang: 'ru' });
    } catch (e) { console.warn('dva: refresh failed', e); }
  }

  // ---------- Перехват ответов WS (вызывается из ws.js) ----------

  window.__handleDeviceVehicleAdd = function (data) {
    try {
      if (!data || !data.name) return false;
      if (data.name !== 'Device Edit' && data.name !== 'Vehicle Edit Distribution') return false;

      // загрузка справочников: перехватываем init/setup, пока refs не собраны
      if (refsLoading) {
        if (data.name === 'Vehicle Edit Distribution' && data.act === 'init' && !vedInitReceived && data.res && data.res[0] && data.res[0].cols) {
          captureRefsFromCols(data.res[0].cols);
          vedInitReceived = true;
          maybeFinishRefs();
          return true;
        }
        if (data.name === 'Vehicle Edit Distribution' && data.act === 'setup' && !vedSetupReceived && data.res && data.res[0] && Array.isArray(data.res[0].f)) {
          captureModelsFromRows(data.res[0].f);
          vedSetupReceived = true;
          maybeFinishRefs();
          return true;
        }
        if (data.name === 'Device Edit' && data.act === 'setup' && !devSetupReceived && data.res && data.res[0] && Array.isArray(data.res[0].f)) {
          captureExistingDevices(data.res[0].f);
          devSetupReceived = true;
          maybeFinishRefs();
          return true;
        }
      }

      if (!saving || !current) return false;
      if (data.name === 'Device Edit' && data.act === 'rowadd' && current.phase === 'devadd') { stepResponse(data); return true; }
      if (data.name === 'Device Edit' && data.act === 'rowsave' && current.phase === 'devsave') { stepResponse(data); return true; }
      if (data.name === 'Vehicle Edit Distribution' && data.act === 'rowadd' && current.phase === 'vehadd') { stepResponse(data); return true; }
      if (data.name === 'Vehicle Edit Distribution' && data.act === 'rowsave' && current.phase === 'vehsave') { stepResponse(data); return true; }
      return false;
    } catch (e) {
      console.warn('dva handler error', e);
      return false;
    }
  };

  // если справочники подгрузились, а пустая строка уже есть — обновить её селекты
  function fillEmptyRowSelects() {
    var trs = tbody().querySelectorAll('tr');
    if (!trs.length) {
      var m = modal();
      if (m && m.style.display === 'block') addRow();
      return;
    }
    for (var i = 0; i < trs.length; i++) {
      var selects = trs[i].querySelectorAll('select');
      for (var j = 0; j < selects.length; j++) {
        if (selects[j].options.length) continue;
        var opts = j === 0 ? refs.brands : (j === 1 ? refs.models : refs.fleets.slice());
        var def = j === 0 ? VEH_DEFAULTS.brand : (j === 1 ? VEH_DEFAULTS.model : '');
        if (j === 2) opts.unshift({ key: '', val: '— выберите филиал —' });
        var ns = buildSelect(opts, def);
        selects[j].parentNode.replaceChild(ns, selects[j]);
      }
    }
  }

  // ---------- Открытие/закрытие ----------

  window.openDeviceVehicleAddModal = function () {
    var m = modal();
    if (!m) return;
    // всегда перечитываем справочники и базу устройств — данные могли измениться с прошлого открытия
    if (!refsLoading) requestRefs();
    m.style.display = 'block';
    if (!tbody().querySelector('tr') && refsReady()) addRow();
  };

  function closeModal() {
    if (saving) { showRouteToast('Идёт сохранение, дождитесь завершения', 2500); return; }
    var m = modal();
    if (m) m.style.display = 'none';
  }
  window.closeDeviceVehicleAddModal = closeModal;

  // ---------- Привязка событий ----------

  function bind() {
    // кнопка «Добавить ТС» в шапке оверлея списка ТС
    // (биндим здесь: vehicleOverlay находится в DOM после тегов <script>,
    // поэтому топ-левел код ui.js её не видит)
    var vehicleAddBtn = $('vehicleAddBtn');
    if (vehicleAddBtn && !vehicleAddBtn.dataset.bound) {
      vehicleAddBtn.addEventListener('click', function () {
        window.openDeviceVehicleAddModal();
      });
      vehicleAddBtn.dataset.bound = '1';
    }
    var parseBtn = $('dvaParseBtn');
    if (parseBtn) parseBtn.addEventListener('click', function () {
      if (!refsReady()) { showRouteToast('Справочники ещё загружаются, повторите через секунду', 2500); return; }
      var n = parsePaste($('dvaPasteArea').value);
      if (n > 0) { $('dvaPasteArea').value = ''; showRouteToast('Добавлено строк: ' + n, 2000); revalidateAll(); }
      else showRouteToast('Не удалось распознать ни одной строки', 2500);
    });
    var addBtn = $('dvaAddRowBtn');
    if (addBtn) addBtn.addEventListener('click', function () {
      if (!refsReady()) { showRouteToast('Справочники ещё загружаются, повторите через секунду', 2500); return; }
      addRow();
    });
    // живая перепроверка дублей при ручном редактировании ячеек
    tbody().addEventListener('change', function () {
      if (!saving) revalidateAll();
    });
    var saveBtn = $('dvaSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', startSave);
    var cancelBtn = $('dvaCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    var closeBtn = $('dvaCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
