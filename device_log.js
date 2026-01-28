// device_log.js

// Flag set when Dev Log triggers a full Device Track (setup) request
window._devLogRequestedFull = window._devLogRequestedFull || false;

var lastDeviceIdForLogs = null;
var isDeviceLogInitialized = false;

function clearTable(thead, tbody) {
  if (thead) thead.innerHTML = '';
  if (tbody) tbody.innerHTML = '';
}

function fillTable(thead, tbody, rows) {
  if (!thead || !tbody) {
    return;
  }
  thead.innerHTML = '';
  tbody.innerHTML = '';
  if (!rows || !rows.length) {
    tbody.innerHTML = '<tr><td>Нет данных</td></tr>';
    return;
  }
  var headersAll = Object.keys(rows[0]);
  // Extract IMEI (first non-empty) before filtering
  var imeiVal = null;
  for (var i = 0; i < rows.length; i++) {
    var candidate = rows[i].imei || rows[i].IMEI;
    if (candidate) {
      imeiVal = candidate;
      break;
    }
  }
  var headers = headersAll.filter(function (h) {
    var hl = h.toLowerCase();
    return hl !== 'id' && hl !== 'imei';
  });
  var tr = document.createElement('tr');
  headers.forEach(function (h) {
    var th = document.createElement('th');
    th.textContent = h;
    tr.appendChild(th);
  });
  thead.appendChild(tr);
  var frag = document.createDocumentFragment();
  rows.forEach(function (r) {
    var trR = document.createElement('tr');
    headers.forEach(function (h) {
      var td = document.createElement('td');
      var v = r[h];
      if (v == null) v = '';
      // Escape plain text and convert newlines to <br> so durations inserted as \n become visible
      function escapeHtml(str){ return String(str)
          .replace(/&/g,'&amp;')
          .replace(/</g,'&lt;')
          .replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;')
          .replace(/'/g,'&#39;'); }
      if (typeof v === 'string') {
        if (v.indexOf('<') !== -1) {
          // allow simple HTML but strip scripts and inline event handlers
          var safe = v
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
            .replace(/on\w+\s*=\s*'[^']*'/gi, '')
            .replace(/on\w+\s*=\s*[^'\s>]+/gi, '');
          td.innerHTML = safe;
        } else if (v.indexOf('\n') !== -1) {
          // plain text containing newline(s): escape then convert to <br>
          td.innerHTML = escapeHtml(v).replace(/\n/g,'<br>');
        } else {
          td.textContent = v;
        }
      } else {
        td.textContent = v;
      }
      trR.appendChild(td);
    });
    // Highlight specific alarm messages (only for Device Alarm table)
    try {
      // find text/message column (headers like 'txt','text','msg','message','description')
      var txtIdx = headers.findIndex(function(h){ if(!h) return false; var lh = h.toLowerCase(); return lh.indexOf('txt')!==-1 || lh.indexOf('text')!==-1 || lh.indexOf('msg')!==-1 || lh.indexOf('message')!==-1 || lh.indexOf('description')!==-1; });
      var msg = null;
      if (txtIdx !== -1) {
        var key = headers[txtIdx];
        msg = (r[key] != null) ? String(r[key]) : '';
      }
      if (msg) {
        // normalize: strip HTML tags for matching, perform case-insensitive checks
        var stripped = String(msg).replace(/<[^>]*>/g,'').toLowerCase();
        if (stripped.indexOf('батарея полностью разряжена') !== -1 || stripped.indexOf('выключение')!==-1 && stripped.indexOf('батарея')!==-1) {
          trR.classList.add('dalarm-danger');
        } else if (stripped.indexOf('батарея разряжена') !== -1) {
          trR.classList.add('dalarm-warning');
        } else if (stripped.indexOf('основное питание') !== -1 && /выключ/.test(stripped)) {
          trR.classList.add('dalarm-warning');
        } else if (stripped.indexOf('основное питание') !== -1 && /включ/.test(stripped)) {
          trR.classList.add('dalarm-success');
        }
      }
    } catch (e) { console.warn('Highlight alarms failed', e); }
    frag.appendChild(trR);
  });
  tbody.appendChild(frag);

  // Update table title with IMEI if available
  if (imeiVal) {
    try {
      var container = thead.closest('.table-container');
      if (container) {
        var titleEl = container.querySelector('h2');
        if (titleEl) {
          if (!titleEl.dataset.baseTitle) {
            titleEl.dataset.baseTitle = titleEl.textContent.replace(/\s+\(IMEI:.*\)$/, '');
          }
          titleEl.textContent = titleEl.dataset.baseTitle + ' (IMEI: ' + imeiVal + ')';
        }
      }
    } catch (e) {}
  }
}

window.initDeviceLog = function() {
  if (isDeviceLogInitialized) {
    return;
  }
  // Expose for external triggers (e.g., selecting device via vehicle overlay)
  if (!Object.getOwnPropertyDescriptor(window, 'lastDeviceIdForLogs')) {
    Object.defineProperty(window, 'lastDeviceIdForLogs', {
      get: function () {
        return lastDeviceIdForLogs;
      },
      set: function (v) {
        lastDeviceIdForLogs = v;
      },
      configurable: true // Allow redefining the property for subsequent calls if needed
    });
  }


  function resetLogTitles() {
    try {
      ['Device Alarm', 'Device Log'].forEach(function (base) {
        var sel = Array.prototype.slice.call(document.querySelectorAll('.table-container h2'));
        sel.forEach(function (h) {
          if (!h.dataset) return;
          if (h.dataset.baseTitle && h.textContent.indexOf(h.dataset.baseTitle) === 0) {
            // leave baseTitle as is
            if (h.textContent !== h.dataset.baseTitle) h.textContent = h.dataset.baseTitle;
          } else if (h.textContent === base || h.textContent.startsWith(base + ' (IMEI:')) {
            h.dataset.baseTitle = base;
            h.textContent = base;
          }
        });
      });
    } catch (e) {}
  }

  function hardClearDeviceLogTables() {
    clearTable(deviceAlarmThead, deviceAlarmTbody);
    clearTable(deviceLogThead, deviceLogTbody);
    resetLogTitles();
  }
  window.hardClearDeviceLogTables = hardClearDeviceLogTables;

  function isoRangeFromInputs(){
    var from = dateFromInput && dateFromInput.value ? buildLocalDateParam(dateFromInput.value, false) : null;
    var to = dateToInput && dateToInput.value ? buildLocalDateParam(dateToInput.value, true) : null;
    return {from:from,to:to};
  }

  function buildAlarmRequest(deviceId, fromIso, toIso) {
    return {
      name: 'Device Alarm',
      type: 'etbl',
      mid: 4,
      act: 'filter',
      filter: [{
        selecteddeviceid: [deviceId]
      }, {
        selectedpgdatefrom: [fromIso]
      }, {
        selectedpgdateto: [toIso]
      }],
      usr: authUser,
      pwd: authPwd,
      uid: authUid,
      lang: 'en'
    };
  }

  function buildLogRequest(deviceId, fromIso, toIso) {
    return {
      name: 'Device Log',
      type: 'etbl',
      mid: 5,
      act: 'filter',
      filter: [{
        selecteddeviceid: [deviceId]
      }, {
        selectedpgdateto: [toIso]
      }, {
        selectedpgdatefrom: [fromIso]
      }],
      usr: authUser,
      pwd: authPwd,
      uid: authUid,
      lang: 'en'
    };
  }

  function sendDeviceLogRequests() {
    if (!authLoggedIn) {
      showRouteToast('⚠ Сначала вход');
      return;
    }
    var deviceId = deviceIdInput ? deviceIdInput.value : '';
    if (!deviceId) {
      showRouteToast('⚠ Нет Device ID');
      return;
    }
    if (lastDeviceIdForLogs && lastDeviceIdForLogs !== deviceId) {
      hardClearDeviceLogTables();
      // Отслеживание переключения устройства для автоочистки памяти
      if (typeof window.trackDeviceSwitch === 'function') {
        window.trackDeviceSwitch(deviceId);
      }
    }
    var rng = isoRangeFromInputs();
    if (!rng.from || !rng.to) {
      showRouteToast('⚠ Некорректный диапазон дат');
      return;
    }
    // Scroll to bottom of the page so user sees log tables when Dev Log is requested
    try {
      var bottom = Math.max(document.body.scrollHeight || 0, document.documentElement.scrollHeight || 0);
      window.scrollTo({ top: bottom, behavior: 'smooth' });
    } catch (e) { /* ignore if scrolling not supported */ }
    // Do not hard-clear Device Alarm/Log tables here; let sendRequest decide
    // Show loading placeholders quickly in the table bodies to indicate activity
    try { fillTable(deviceAlarmThead, deviceAlarmTbody, []); } catch(_){}
    try { fillTable(deviceLogThead, deviceLogTbody, []); } catch(_){}
    try {
      window.__dt_setTableLoading('deviceAlarmTable', true);
      window.__dt_setTableLoading('deviceLogTable', true);
    } catch (e) {}
    var alarmReq = buildAlarmRequest(deviceId, rng.from, rng.to);
    var logReq = buildLogRequest(deviceId, rng.from, rng.to);
  updateStatus('Отправка Device Alarm/Log...', 'blue');
  try{ setReqStart && setReqStart('Device Alarm'); } catch(_){}
  try{ setReqStart && setReqStart('Device Log'); } catch(_){}
  // sendRequest will detect date/device changes and call the central handler before sending

  sendRequest(alarmReq);
  sendRequest(logReq);
    lastDeviceIdForLogs = deviceId;
  // After sending logs, initiate retrieval of the full Device Track (setup), if available
    try {
      if (typeof window.requestFullDeviceTrackSetup === 'function') {
        window._devLogRequestedFull = true;
        window.requestFullDeviceTrackSetup();
      }
    } catch (e) {
      console.warn('Не удалось отправить полный трек после Dev Log:', e);
    }
  }

  if (sendDeviceLogBtn && !sendDeviceLogBtn.dataset.bound) {
    sendDeviceLogBtn.addEventListener('click', sendDeviceLogRequests);
    sendDeviceLogBtn.dataset.bound = '1';
  }

  // Auto-clear tables when device ID changes
  if (deviceIdInput && !deviceIdInput.dataset.logsWatcher) {
    var lastSeenValue = deviceIdInput.value;
    var onDeviceIdMaybeChange = function () {
      var val = deviceIdInput.value;
      if (val !== lastSeenValue) {
        lastSeenValue = val;
        if (lastDeviceIdForLogs && val !== lastDeviceIdForLogs) {
          try{ if(typeof window.handleDeviceOrDateChange === 'function') window.handleDeviceOrDateChange({source:'device.change'}); else if(window.hardClearDeviceLogTables) window.hardClearDeviceLogTables(); }catch(_){}
          lastDeviceIdForLogs = null; // force fresh fetch sets
          updateStatus('Device изменён — логи очищены', 'orange', 3000);
        }
      }
    };
    ['input', 'change', 'blur'].forEach(function (ev) {
      deviceIdInput.addEventListener(ev, onDeviceIdMaybeChange);
    });
    deviceIdInput.dataset.logsWatcher = '1';
  }
  isDeviceLogInitialized = true;
}


// Hook into global onmessage by lightweight patch: we rely on ws.js to call our handler.
// We'll monkey-patch socket.onmessage after connect is called; to avoid race, expose handler.
window.__handleDeviceLogResponse = function (data) {
  if (!data || !data.name) return false;

  // Helper: try to extract rows array from various server shapes
  function extractRows(d) {
    try {
      if (d.res && Array.isArray(d.res) && d.res[0]) {
        var candidate = d.res[0];
        if (candidate.f && Array.isArray(candidate.f)) return candidate.f;
        if (Array.isArray(candidate)) return candidate;
      }
      if (d.res && Array.isArray(d.res)) return d.res;
      // fallback: if payload itself is an array
      if (Array.isArray(d)) return d;
    } catch (e) {}
    return null;
  }

  var rows = extractRows(data);
  if (!rows || !Array.isArray(rows)) {
    // If we didn't find rows, be tolerant and return false so other handlers can try
    console.warn('DeviceLog handler: could not extract rows for', data.name, data);
    return false;
  }

  // Helper: try to detect time-like key and sort rows ascending by that time
  function parseTimeValue(v) {
    try {
      if (v == null) return NaN;
      if (typeof v === 'number') {
        // numeric seconds vs ms: if value looks like seconds, convert to ms
        if (v < 1e11) return v * 1000; // likely seconds
        return v; // likely ms
      }
      if (typeof v === 'string') {
        var s = v.trim();
        if (!s) return NaN;
        // numeric string
        var n = Number(s);
        if (!isNaN(n)) {
          if (n < 1e11) return n * 1000;
          return n;
        }
        // ISO or RFC parseable
        var p = Date.parse(s);
        if (!isNaN(p)) return p;
        // try dd.mm.yy or dd.mm.yyyy [ hh:mm:ss]
        var m = s.match(/^(\d{2})\.(\d{2})\.(\d{2,4})(?:[ T](\d{2}):(\d{2}):?(\d{2})?)?/);
        if (m) {
          var day = m[1], mon = m[2], yearPart = m[3];
          var year = yearPart.length === 2 ? ('20' + yearPart) : yearPart;
          var hh = m[4] || '00', mm = m[5] || '00', ss = m[6] || '00';
          return Date.parse(year + '-' + mon + '-' + day + 'T' + hh + ':' + mm + ':' + ss);
        }
      }
    } catch (e) {}
    return NaN;
  }

  function sortRowsByTimeAsc(rowsArr) {
    if (!rowsArr || !rowsArr.length) return;
    var sample = rowsArr[0];
    var keys = Object.keys(sample || {});
    var timeKey = null;
  var preferred = ['time', 'ts', 'datetime', 'date', 'pgdate', 'created', 'createdat', 'datestamp', 'dt', 'sdate'];
    // look for a key that contains any preferred token
    for (var i = 0; i < keys.length; i++) {
      var kl = keys[i].toLowerCase();
      for (var j = 0; j < preferred.length; j++) {
        if (kl.indexOf(preferred[j]) !== -1) {
          timeKey = keys[i];
          break;
        }
      }
      if (timeKey) break;
    }
    // if not found, try to detect by parsability of the first row values
    if (!timeKey) {
      for (var k = 0; k < keys.length; k++) {
        var val = rowsArr[0][keys[k]];
        if (val == null) continue;
        var t = parseTimeValue(val);
        if (!isNaN(t)) {
          timeKey = keys[k];
          break;
        }
      }
    }
    if (!timeKey) return;
    try {
      rowsArr.sort(function (a, b) {
        var ta = parseTimeValue(a[timeKey]);
        var tb = parseTimeValue(b[timeKey]);
        if (isNaN(ta) && isNaN(tb)) return 0;
        if (isNaN(ta)) return 1; // push unknowns to end
        if (isNaN(tb)) return -1;
        return ta - tb; // ascending
      });
    } catch (e) { console.warn('Failed to sort rows by time', e); }
  }

  // For Device Alarm: compute duration of each power state (on/off) as the time until the next opposite-state event
  function computePowerOffDurations(rowsArr) {
    if (!rowsArr || !rowsArr.length) return;
    var sample = rowsArr[0];
    var keys = Object.keys(sample || {});
    // find message key
    var msgKey = null;
    var msgCandidates = ['txt','text','msg','message','description'];
    for (var i = 0; i < keys.length; i++) {
      var kl = keys[i].toLowerCase();
      for (var j = 0; j < msgCandidates.length; j++) {
        if (kl.indexOf(msgCandidates[j]) !== -1) { msgKey = keys[i]; break; }
      }
      if (msgKey) break;
    }
    // find id key to match same device (optional)
    // Prefer explicit device identifiers like 'did' or 'imei' over generic row 'id'
    var idKey = null;
    var idPreferred = ['did','imei','deviceid','selecteddeviceid','device','dev','id'];
    for (var ii = 0; ii < idPreferred.length; ii++) {
      for (var kk = 0; kk < keys.length; kk++) {
        if (keys[kk].toLowerCase() === idPreferred[ii]) {
          idKey = keys[kk]; break;
        }
      }
      if (idKey) break;
    }
    // fallback: partial name match if exact keys not found
    if (!idKey) {
      var idCandidates = ['deviceid','selecteddeviceid','imei','id','dev','device','did'];
      for (var ii2 = 0; ii2 < keys.length; ii2++) {
        var kli2 = keys[ii2].toLowerCase();
        for (var jj2 = 0; jj2 < idCandidates.length; jj2++) {
          if (kli2.indexOf(idCandidates[jj2]) !== -1) { idKey = keys[ii2]; break; }
        }
        if (idKey) break;
      }
    }

  // find time key (similar logic as sorter)
    var timeKey = null;
    var preferred = ['time', 'ts', 'datetime', 'date', 'pgdate', 'created', 'createdat', 'datestamp', 'dt','sdate'];
    for (var k = 0; k < keys.length; k++) {
      var klk = keys[k].toLowerCase();
      for (var p = 0; p < preferred.length; p++) {
        if (klk.indexOf(preferred[p]) !== -1) { timeKey = keys[k]; break; }
      }
      if (timeKey) break;
    }
    // fallback: detect any parsable time field in first row
    if (!timeKey) {
      for (var kk = 0; kk < keys.length; kk++) {
        var val = rowsArr[0][keys[kk]];
        if (val == null) continue;
        var t = parseTimeValue(val);
        if (!isNaN(t)) { timeKey = keys[kk]; break; }
      }
    }
    if (!msgKey || !timeKey) return;

    // detection completed (debug logs removed in production)

    function formatDurationRu(ms) {
      if (!isFinite(ms) || ms < 0) return null;
      var s = Math.floor(ms / 1000);
      var hh = Math.floor(s / 3600);
      var mm = Math.floor((s % 3600) / 60);
      var ss = s % 60;
      var parts = [];
      if (hh) parts.push(hh + 'ч');
      if (mm) parts.push(mm + 'м');
      if (ss || parts.length === 0) parts.push(ss + 'с');
      return parts.join(' ');
    }

    for (var a = 0; a < rowsArr.length; a++) {
      try {
        var rowA = rowsArr[a];
  var msgA = rowA[msgKey] != null ? String(rowA[msgKey]) : '';
  var strippedA = msgA.replace(/<[^>]*>/g,'').toLowerCase();
        if (!msgA) continue;
  var isOff = strippedA.indexOf('основное питание') !== -1 && /выключ/.test(strippedA);
  var isOn = strippedA.indexOf('основное питание') !== -1 && /включ/.test(strippedA);
        if (!isOff && !isOn) continue;
        var idA = idKey ? rowA[idKey] : null;
        var tA = parseTimeValue(rowA[timeKey]);
        if (isNaN(tA)) continue;
        // find next opposite-state event for same device (if idKey) or globally otherwise
        var found = null;
        for (var b = a + 1; b < rowsArr.length; b++) {
          var rowB = rowsArr[b];
          if (idKey && rowB[idKey] != idA) continue;
          var msgB = rowB[msgKey] != null ? String(rowB[msgKey]) : '';
          var strippedB = msgB.replace(/<[^>]*>/g,'').toLowerCase();
          if (!msgB) continue;
          if (isOff && strippedB.indexOf('основное питание') !== -1 && /включ/.test(strippedB)) {
            var tB = parseTimeValue(rowB[timeKey]);
            if (!isNaN(tB) && tB >= tA) { found = tB; break; }
          }
          if (isOn && strippedB.indexOf('основное питание') !== -1 && /выключ/.test(strippedB)) {
            var tB2 = parseTimeValue(rowB[timeKey]);
            if (!isNaN(tB2) && tB2 >= tA) { found = tB2; break; }
          }
        }
        if (found) {
          var durMs = found - tA;
          var formatted = formatDurationRu(durMs);
          if (formatted) {
            try {
              var orig = String(rowA[msgKey] || '');
              // If message contains HTML, try to insert the duration before the last closing block tag
              if (orig.indexOf('<') !== -1) {
                // Prefer to insert before common block tags so the duration appears inside the same block
                var closingMatch = orig.match(/<\/(div|p|li|td)\s*>\s*$/i);
                if (closingMatch) {
                  var tag = closingMatch[1];
                  var re = new RegExp('</' + tag + '>\s*$', 'i');
                  rowA[msgKey] = orig.replace(re, '<br><span class="dalarm-duration">' + formatted + '</span></' + tag + '>');
                } else if (orig.lastIndexOf('</div>') !== -1) {
                  var pos = orig.lastIndexOf('</div>');
                  rowA[msgKey] = orig.slice(0, pos) + '<br><span class="dalarm-duration">' + formatted + '</span>' + orig.slice(pos);
                } else {
                  rowA[msgKey] = orig + '<br><span class="dalarm-duration">' + formatted + '</span>';
                }
              } else {
                // plain text: append newline, which will be rendered as <br> in fillTable
                rowA[msgKey] = orig + '\n' + formatted;
              }
            } catch (ee) {
              // best-effort fallback: append formatted duration as plain text
              rowA[msgKey] = String(rowA[msgKey]) + ' ' + formatted;
            }
          }
        }
      } catch (e) { /* continue */ }
    }
  }

  if (data.name === 'Device Alarm') {
    // sort alarms by time (ascending) when possible
    try { sortRowsByTimeAsc(rows); } catch (e) {}
    // compute durations for power off/on sequences and append to messages
    try { computePowerOffDurations(rows); } catch (e) { console.warn('computePowerOffDurations failed', e); }
    fillTable(deviceAlarmThead, deviceAlarmTbody, rows);
    updateStatus('Device Alarm: ' + rows.length + ' стр.', 'green', 5000);
  try { window.__dt_setTableLoading('deviceAlarmTable', false); } catch (e) {}
    return true;
  }

  if (data.name === 'Device Log') {
    fillTable(deviceLogThead, deviceLogTbody, rows);
    updateStatus('Device Log: ' + rows.length + ' стр.', 'green', 5000);
  try { window.__dt_setTableLoading('deviceLogTable', false); } catch (e) {}
    return true;
  }

  return false;
};

// Hide Device Track Details table container if empty
function hideEmptyTrack() {
  try {
    var trackBody = tableBody; // from globals.js
    var trackContainer = document.querySelector('#resultTable')?.closest('.table-container');
    if (trackBody && trackContainer) {
      if (!trackBody.children.length) {
        trackContainer.style.display = 'none';
      } else {
        trackContainer.style.display = '';
      }
    }
  } catch (e) {}
}
// Observe mutations to track table body to toggle visibility
if (window.MutationObserver && tableBody) {
  var mo = new MutationObserver(function () {
    hideEmptyTrack();
  });
  mo.observe(tableBody, {
    childList: true
  });
  hideEmptyTrack();
}
