// WebSocket communication & requests
var __statusClearTimer = null;
// map of request id/name -> timestamp when request was sent
var __reqStartTimes = {};
function setReqStart(name){ try { __reqStartTimes[name] = Date.now(); } catch(_){} }
function clearReqStart(name){ try{ delete __reqStartTimes[name]; }catch(_){} }
// Helper formatting (duplicate small helper to avoid circular deps)
function _formatMs(ms){ try{ if(ms==null||isNaN(ms)) return ''; if(ms<1000) return String(ms)+' ms'; var s=(ms/1000); return s.toFixed(1) + ' s'; }catch(e){ return String(ms)+' ms'; } }
function showResponseElapsed(name){ try { var el = document.getElementById('responseTime'); if(!el) return; var t = __reqStartTimes[name]; if(!t) return; var ms = Date.now() - t; el.textContent = name + ': ' + _formatMs(ms); delete __reqStartTimes[name]; } catch(e){ } }
function updateStatus(msg, color, autoClearMs){
  statusDiv = document.getElementById('status');
  if(!statusDiv) return;
  statusDiv.textContent = msg;
  if(color) statusDiv.style.color = color; else statusDiv.style.color = '#555';
  if(__statusClearTimer){ clearTimeout(__statusClearTimer); __statusClearTimer=null; }
  if(autoClearMs){
    __statusClearTimer = setTimeout(function(){
      if(statusDiv && statusDiv.textContent===msg){ statusDiv.textContent=''; }
    }, autoClearMs);
  }
}

function connect() {
  // Re-query statusDiv in case of dynamic relocation
  statusDiv = document.getElementById('status');
  socket = new WebSocket(wsUrl);
  socket.onopen = function () {
    updateStatus('Соединение установлено.', 'green', 4000);
    requestVehicleSelectMin();
    try {
      if (!authLoggedIn && localStorage.getItem("dt_remember") === "1") {
        var u = localStorage.getItem("dt_user") || "";
        var p = localStorage.getItem("dt_pwd") || "";
        if (u && p) {
          if (loginUserInput) loginUserInput.value = u;
          if (loginPasswordInput) loginPasswordInput.value = p;
          sendLogin();
        }
      }
    } catch (e) {
      console.warn("Auto-login failed", e);
    }
  };
  socket.onmessage = function (event) {
    var data = JSON.parse(event.data);
    try {
      // Lightweight incoming-packet summary for vehicle-related messages
      if (data && data.name && (data.name.indexOf('Vehicle') === 0 || data.name.indexOf('Vehicle') > -1)) {
        try {
          var sample = {};
          sample.name = data.name;
          if (data.res && data.res[0]) {
            var pkt = data.res[0];
            if (pkt.f && Array.isArray(pkt.f)) sample.rows = pkt.f.length;
            if (pkt.cols && Array.isArray(pkt.cols)) sample.cols = pkt.cols.length;
          }
        } catch (e) { console.debug('WS.RECV vehicle summary failed', e); }
      }
    } catch (e) {}
    // Generic acknowledgement of reply (will be refined below)
    updateStatus('Ответ получен...', 'green', 4000);
    // For timing: if this response corresponds to a monitored request, show elapsed
    try {
      if(data && data.name){
        // normalize known names
        if(data.name === 'Mileage Report') showResponseElapsed('Mileage Report');
        else if(data.name === 'Vehicle Track') showResponseElapsed('Vehicle Track');
        else if(data.name === 'Device Alarm') showResponseElapsed('Device Alarm');
        else if(data.name === 'Device Log') showResponseElapsed('Device Log');
        else if(data.name === 'Startstop accumulation' || data.name === 'Startstop Sum Result') showResponseElapsed('Mileage Report');
        // Full Device Track setup responses come under 'Device Track' as well (handled elsewhere)
      }
    } catch(e){}
    // NOTE: do NOT hide the global loading overlay here —
    // the overlay should be dismissed only after the UI has finished
    // rendering the overlay content (tables, mapping, etc.). Hiding
    // here caused the spinner to disappear before DOM updates completed.
  // Allow device_log.js to capture its packets first
  try { if(window.__handleDeviceLogResponse && window.__handleDeviceLogResponse(data)) { return; } } catch(e) { console.warn('DeviceLog handler error', e); }
  // Full Device Track setup (raw) capture early
  try { if(window.__handleFullTrackSetup && window.__handleFullTrackSetup(data)) { return; } } catch(e){ console.warn('FullTrack handler error', e); }
  // Audit response handler (audit.js will register this)
  try { if(window.__handleAuditResponse && data && data.name === 'Audit' && window.__handleAuditResponse(data)) { return; } } catch(e){ console.warn('Audit handler error', e); }
  // Report response handler (reports.js will register this)
  try { if(window.__handleReportResponse && window.__handleReportResponse(data)) { return; } } catch(e){ console.warn('Report handler error', e); }
    if (data.name === "login" && data.res && data.res[0]) {
      var r = data.res[0];
      if (r.uid) {
        setAuthInfo(
          r.uid,
          loginUserInput ? loginUserInput.value : "",
          loginPasswordInput ? loginPasswordInput.value : ""
        );
  // show Online status via status dot
  try { var dot = document.getElementById('loginStatusDot'); if(dot){ dot.classList.remove('status-offline'); dot.classList.add('status-online'); dot.title = 'Online'; } }catch(_){}
        showRouteToast("✅ Логин успешен");
        requestVehicleSelectMin();
      } else {
        try { var dotErr = document.getElementById('loginStatusDot'); if(dotErr){ dotErr.classList.remove('status-online'); dotErr.classList.add('status-offline'); dotErr.title = data.msg || 'Offline'; } } catch(_){}
        showRouteToast("⚠ Ошибка логина");
      }
      return;
    }
    if ((data.name === "Vehicle Select Min" || data.name === "Vehicle Show" || data.name === "Vehicle Edit Distribution") && data.res && data.res[0]) {
      var packet = data.res[0];
      if (packet.cols) {
        var fleetCol = packet.cols.find(function (c) {
          return c.f === "fleet" && Array.isArray(c.k);
        });
        if (fleetCol) {
          fleetKeyMap = {};
          fleetCol.k.forEach(function (entry) {
            if (entry && entry.key !== undefined) {
              fleetKeyMap[entry.key] = entry.val;
            }
          });
        }
        // Some servers return rowsave confirmations as cols payload without packet.f
        try {
          var colsPayload = data.cols || packet.cols || (data.res && data.res[0] && data.res[0].cols) || null;
          // detect id field case-insensitively
          var detectId = function(obj){ if(!obj) return null; if(obj.id !== undefined) return obj.id; if(obj.ID !== undefined) return obj.ID; if(obj.Id !== undefined) return obj.Id; // fallback: search keys
            var k = Object.keys(obj).find(function(kk){ return kk.toLowerCase() === 'id'; }); return k ? obj[k] : null; };
          var rawIdVal = detectId(colsPayload);
          if (colsPayload && rawIdVal != null && data.name === 'Vehicle Edit Distribution') {
            try {
              var savedId = String(rawIdVal);
              console.debug('Vehicle Edit Distribution (cols-only): save confirmation for id=', savedId, 'colsKeys=', Object.keys(colsPayload));
              var pending = window.pendingVehicleSaves && window.pendingVehicleSaves[savedId];
              if (pending) {
                // update vehicleShowData row if present
                if (window.vehicleShowData && Array.isArray(window.vehicleShowData)) {
                  var row = window.vehicleShowData.find(function(x){ return String(x.id) === savedId; });
                  if (row) {
                    Object.keys(colsPayload).forEach(function(k){ row[k] = colsPayload[k]; });
                    tryApplyFleetMapping();
                  }
                }
                // finalize UI similar to rowsave handling
                try {
                  var tr = pending.tr;
                  Object.keys(pending.newValues || {}).forEach(function(k){
                    var headers = Array.prototype.slice.call(vehicleTableHead.querySelectorAll('tr:first-child th')).map(function(th){ return (th.dataset && th.dataset.key) ? th.dataset.key : th.textContent.replace(/ ▲| ▼$/,''); });
                    var idx = headers.indexOf(k);
                    if (idx === -1) return;
                    var cell = tr.children[idx]; if (!cell) return;
                    var newVal = colsPayload[k] !== undefined ? String(colsPayload[k]) : pending.newValues[k];
                    cell.textContent = newVal;
                  });
                  try { pending.btn.disabled = false; pending.btn.textContent = 'Редактировать'; pending.btn.dataset.editing = '0'; } catch(e){}
                  try { document.querySelectorAll('.vehicle-edit-btn').forEach(function(b){ try{ b.disabled = false; }catch(_){}}); } catch(_){ }
                } catch(e){ console.warn('Finalize saved row UI failed (cols-only)', e); }
                try { if (pending.btn && pending.btn._cancelBtn && pending.btn._cancelBtn.parentNode) pending.btn._cancelBtn.parentNode.removeChild(pending.btn._cancelBtn); } catch(_){}
                try { delete window.pendingVehicleSaves[savedId]; } catch(_){}
                showRouteToast('Сохранено', 1200);
                // schedule refresh with force-apply
                try {
                  window._vehicleShowForceApply = true;
                  console.debug('Vehicle Edit (cols-only): set _vehicleShowForceApply = true and sending refresh');
                  var req = { name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'setup', filter: [], nowait: true, waitfor: [], usr: authUser, pwd: authPwd, uid: authUid, lang: 'ru' };
                  sendRequest(req);
                } catch(e){ console.warn('refresh Vehicle Edit Distribution (cols-only) failed', e); }
              }
            } catch(e){ console.warn('Vehicle Edit Distribution (cols-only) handling error', e); }
          }
        } catch(e) {}
      }
      if (packet.f && Array.isArray(packet.f)) {
        if (data.name === 'Vehicle Edit Distribution') {
          // Edit Distribution explicitly targets the edit view — always apply
          vehicleShowData = packet.f.slice();
          vehicleShowData.forEach(function (r, i) { if (r && r.__origIndex === undefined) r.__origIndex = i; });
          tryApplyFleetMapping();
          // clear loading skeleton if present
          try { if(window._vehicleShowLoading) delete window._vehicleShowLoading; } catch(_){}
        } else if (data.name === 'Vehicle Show') {
          // Vehicle Show (Device List) normally should not overwrite an active Edit view.
          // However, if a refresh was explicitly requested after a save, a temporary flag
          // `window._vehicleShowForceApply` may be set — in that case apply immediately.
          if (window._vehicleShowForceApply) {
            try { delete window._vehicleShowForceApply; } catch(_){}
            vehicleShowData = packet.f.slice();
            vehicleShowData.forEach(function (r, i) { if (r && r.__origIndex === undefined) r.__origIndex = i; });
            tryApplyFleetMapping();
          } else if (typeof vehicleShowMode === 'undefined' || vehicleShowMode !== 'edit') {
            vehicleShowData = packet.f.slice();
            vehicleShowData.forEach(function (r, i) { if (r && r.__origIndex === undefined) r.__origIndex = i; });
            tryApplyFleetMapping();
          } else {
            // we're currently editing — stash device-list payload so it can be applied later if needed
            try { window._vehicleShowPending = packet.f.slice(); } catch(_){}
          }
        } else {
          vehicleSelectMinData = packet.f.slice();
          vehicleSelectMinData.forEach(function (r, i) { if (r && r.__origIndex === undefined) r.__origIndex = i; });
          tryApplyFleetMapping();
        }
      }
      // Some 'init' responses return cols without f (no rows). Handle Device Status cols mapping here.
      try {
        if (data.name === 'Device Status' && data.res && data.res[0] && data.res[0].cols) {
          try {
            window.deviceStatusColMaps = window.deviceStatusColMaps || {};
            var colsPayload = data.res[0].cols;
            colsPayload.forEach(function(c){
              try{
                if(c && Array.isArray(c.k) && c.k.length){
                  var map = {};
                  c.k.forEach(function(ent){ if(ent && ent.key!==undefined) map[String(ent.key)] = ent.val; });
                  window.deviceStatusColMaps[c.f] = map;
                }
              }catch(e){}
            });
            console.debug('Device Status cols mapped', Object.keys(window.deviceStatusColMaps));
          } catch(e) { console.warn('Device Status cols parsing failed', e); }
          // don't early-return here — allow other handlers to run if needed
        }
      } catch(e){}
      // Ensure overlay refs and attempt to render table for the current overlay mode
      try {
        if (typeof ensureVehicleOverlay === 'function') ensureVehicleOverlay();
        // If this is an Edit Distribution response, open the overlay in 'show' mode (Device List style)
        if (data.name === 'Vehicle Edit Distribution') {
          try { vehicleOverlayMode = 'show'; vehicleShowMode = 'edit'; } catch(_) {}
          try {
            // clear Device List search and filters for fresh view
            var s = document.getElementById('vehicleShowSearchInput'); if (s) s.value = '';
            if (vehicleOverlay) vehicleOverlay.style.display = 'block';
          } catch(_) {}
        }
        if (typeof renderVehicleTable === 'function') {
          renderVehicleTable();
          try{ hideLoadingOverlay(); }catch(_){ }
        }
      } catch (e) { console.warn('Render vehicle table failed', e); }
      return;
    }
    if (data.res && data.res[0] && data.res[0].f) {
      var responseData = data.res[0].f;
      if (data.name === 'Device Status') {
        try {
          // if this packet contains cols mapping (init response), store maps for fleet/vehicle
          try {
            var pkt = data.res[0];
            if (pkt && pkt.cols && Array.isArray(pkt.cols)) {
              window.deviceStatusColMaps = window.deviceStatusColMaps || {};
              pkt.cols.forEach(function(c){
                try{
                  if(c && Array.isArray(c.k) && c.k.length){
                    var map = {};
                    c.k.forEach(function(ent){ if(ent && ent.key!==undefined) map[String(ent.key)] = ent.val; });
                    window.deviceStatusColMaps[c.f] = map;
                  }
                }catch(e){}
              });
            }
          } catch(e){}
          window.deviceStatusData = Array.isArray(responseData) ? responseData.slice() : [];
          try { if (typeof renderDeviceStatusTable === 'function') renderDeviceStatusTable(); } catch(_){ }
          try { var overlay = document.getElementById('deviceStatusOverlay'); if (overlay) overlay.style.display = 'block'; } catch(_){ }
          // Hide global loading overlay after Device Status UI is rendered
          try{ hideLoadingOverlay(); }catch(_){ }
        } catch(e) { console.warn('Device Status handling failed', e); }
        return;
      }
      if (data.name === "Startstop accumulation") {
        if (Array.isArray(responseData)) {
          if(!window._suppressRawTrackStops){
            processStartstopAccumulationServerData(responseData);
            rebuildStopMarkers();
            renderStartstopStopsTable();
          }
          if (
            Object.keys(mileageStopCoords).length === 0 &&
            !mileageAutoRequested
          ) {
            mileageAutoRequested = true;
            requestAutoMileageReport();
          }
        }
        return;
      } else if (data.name === "Startstop Sum Result") {
        populateTable(
          startstopSumResultTbody,
          startstopSumResultThead,
          responseData
        );
        return;
      }
      // Handle Vehicle Edit Distribution save confirmations/errors
      if (data.name === 'Vehicle Edit Distribution') {
        var colsPayload = data.cols || (data.res && data.res[0] && data.res[0].cols) || null;
        var r = data.res && data.res[0] ? data.res[0] : null;
        // If server returned cols for saved row (either top-level echo or in res), treat as success
        if (colsPayload && colsPayload.id) {
          try {
            var savedId = String(colsPayload.id);
            console.debug('Vehicle Edit Distribution: save confirmation received for id=', savedId, 'cols=', colsPayload);
            var pending = window.pendingVehicleSaves && window.pendingVehicleSaves[savedId];
            if (pending) {
              // update vehicleShowData row if present
              if (window.vehicleShowData && Array.isArray(window.vehicleShowData)) {
                var row = window.vehicleShowData.find(function(x){ return String(x.id) === savedId; });
                if (row) {
                  Object.keys(colsPayload).forEach(function(k){
                    row[k] = colsPayload[k];
                  });
                  tryApplyFleetMapping();
                }
              }
              // finalize UI: replace editable inputs by new text
              try {
                var tr = pending.tr;
                Object.keys(pending.newValues || {}).forEach(function(k){
                    var headers = Array.prototype.slice.call(vehicleTableHead.querySelectorAll('tr:first-child th')).map(function(th){ return (th.dataset && th.dataset.key) ? th.dataset.key : th.textContent.replace(/ ▲| ▼$/,''); });
                  var idx = headers.indexOf(k);
                  if (idx === -1) return;
                  var cell = tr.children[idx];
                  if (!cell) return;
                  var newVal = colsPayload[k] !== undefined ? String(colsPayload[k]) : pending.newValues[k];
                  cell.textContent = newVal;
                });
                  // re-enable and reset button label
                  try { pending.btn.disabled = false; pending.btn.textContent = 'Редактировать'; pending.btn.dataset.editing = '0'; } catch(e){}
                  // re-enable any other edit buttons
                  try { document.querySelectorAll('.vehicle-edit-btn').forEach(function(b){ try{ b.disabled = false; }catch(_){}}); } catch(_){}
                } catch (e) { console.warn('Finalize saved row UI failed', e); }
              // clear pending
                try { 
                  // remove cancel button if present
                  try { if (pending.btn && pending.btn._cancelBtn && pending.btn._cancelBtn.parentNode) pending.btn._cancelBtn.parentNode.removeChild(pending.btn._cancelBtn); } catch(_){}
                  delete window.pendingVehicleSaves[savedId]; 
                } catch(_){}
              showRouteToast('Сохранено', 1200);
              // Request fresh edit distribution data to refresh overlay
              try {
                setTimeout(function(){
                  try { updateStatus('Обновление данных после сохранения...', 'blue', 1200); }catch(_){ }
                  try {
                    window._vehicleShowForceApply = true;
                    console.debug('Vehicle Edit: set _vehicleShowForceApply = true and scheduling refresh request');
                    var req = { name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'setup', filter: [], nowait: true, waitfor: [], usr: authUser, pwd: authPwd, uid: authUid, lang: 'ru' };
                    sendRequest(req);
                    console.debug('Vehicle Edit: refresh request sent', req);
                  } catch(e){ console.warn('refresh Vehicle Edit Distribution request failed', e); }
                }, 200);
              } catch (_) {}
              return;
            }
          } catch(e){ console.warn('Vehicle Edit Distribution save handling error', e); }
        }
        // If not success, consider error path: look for ern or msg
        // If we reached here, it likely indicates an error. Restore pending if exists
        try {
          var errMsg = (r && r.msg) || data.msg || (r && r.ern !== undefined ? ('err#'+r.ern) : 'Ошибка сохранения');
          console.debug('Vehicle Edit Distribution: save error detected, msg=', errMsg, 'data=', data);
          // try to find any pending and restore
          if (window.pendingVehicleSaves) {
            Object.keys(window.pendingVehicleSaves).forEach(function(pid){
              var p = window.pendingVehicleSaves[pid];
              try {
                var tr = p.tr;
                // restore original values
                Object.keys(p.originalValues || {}).forEach(function(k){
                  var headers = Array.prototype.slice.call(vehicleTableHead.querySelectorAll('tr:first-child th')).map(function(th){ return (th.dataset && th.dataset.key) ? th.dataset.key : th.textContent.replace(/ ▲| ▼$/,''); });
                  var idx = headers.indexOf(k);
                  if (idx === -1) return;
                  var cell = tr.children[idx];
                  if (!cell) return;
                  cell.textContent = p.originalValues[k] || '';
                });
                try { 
                  p.btn.disabled = false; p.btn.textContent = 'Редактировать'; p.btn.dataset.editing = '0'; 
                  try { if (p.btn && p.btn._cancelBtn && p.btn._cancelBtn.parentNode) p.btn._cancelBtn.parentNode.removeChild(p.btn._cancelBtn); } catch(_){}
                } catch(_){}
                  // re-enable any other edit buttons
                  try { document.querySelectorAll('.vehicle-edit-btn').forEach(function(b){ try{ b.disabled = false; }catch(_){}}); } catch(_){}
              } catch(e){}
              try { delete window.pendingVehicleSaves[pid]; } catch(_){}
            });
          }
          showRouteToast('Ошибка: ' + errMsg, 3000);
        } catch(e){ console.warn('Vehicle Edit Distribution error handling failed', e); }
        return;
      }
    }
    trackLayerGroup.clearLayers();
  // Remove previously displayed parking markers and gap-lines on any new track/data response
    try {
      if (parkingMarkers && parkingMarkers.length) {
        parkingMarkers.forEach(function(m){ try { trackLayerGroup.removeLayer(m); } catch(_){ } });
        parkingMarkers = [];
      }
      if (mileageGapLayers && mileageGapLayers.length) {
        mileageGapLayers.forEach(function(g){ try { trackLayerGroup.removeLayer(g); } catch(_){ } });
        mileageGapLayers = [];
      }
    } catch(e){ console.warn('Очистка стоянок при обновлении трека не удалась', e); }
    if (directionDecorator) {
      directionDecorator.remove();
    }
    if (data.res && data.res[0] && data.res[0].f) {
      var response = data.res[0].f;
      var id =
        data.filter &&
        data.filter.find(function (f) {
          return f.selectedvihicleid || f.selecteddeviceid;
        });
      // Removed setting of currentIdDisplay per UI cleanup request
      if (data.name === "Mileage Report") {
        // Do NOT clear Full Device Track (setup) table on Mileage report
        processMileageReport(response);
        updateStatus('Mileage Report: получено', 'green', 5000);
  } else if (data.name === "Vehicle Track") {
        if (vehicleSelectMinData) {
          var f2 =
            data.filter &&
            data.filter.find(function (f) {
              return f.selectedvihicleid || f.selecteddeviceid;
            });
          var incomingId = f2
            ? f2.selectedvihicleid
              ? f2.selectedvihicleid[0]
              : f2.selecteddeviceid
              ? f2.selecteddeviceid[0]
              : null
            : null;
          if (
            incomingId != null &&
            (!selectedVehicleMeta ||
              String(selectedVehicleMeta.id) !== String(incomingId))
          ) {
            var row = vehicleSelectMinData.find(function (r) {
              return String(r.id) === String(incomingId);
            });
            if (row) {
              selectedVehicleMeta = buildVehicleMeta(row);
              updateDeviceTrackHeader();
            }
          }
        }
        tableHead.innerHTML = "";
        try {
          var anomalies = processDeviceTrack(response);
             if(anomalies && anomalies.length){
               populateTable(tableBody, tableHead, anomalies);
               updateStatus('Device Track: найдено аномалий: '+anomalies.length, 'green', 6000);
               // Add click handler for gap highlight
               setTimeout(function(){
                 var rows = tableBody.querySelectorAll('tr');
                 anomalies.forEach(function(anom, idx){
                   var row = rows[idx];
                   // Time Gap highlight
                   if(anom["Anomaly Type"] === "Time Gap" && anom._gapIndex != null && window._rawTrackGapLayers && row){
                     row.addEventListener('click', function(){
                       window._rawTrackGapLayers.forEach(function(g){g.setStyle({color:'#ff4136',weight:4,opacity:0.95,dashArray:'8,6'});});
                       var gapLine = window._rawTrackGapLayers[anom._gapIndex];
                       if(gapLine){
                         gapLine.setStyle({color:'#FFD700',weight:7,opacity:1,dashArray:null});
                         gapLine.bringToFront();
                         gapLine.openPopup();
                         setTimeout(function(){gapLine.setStyle({color:'#ff4136',weight:4,opacity:0.95,dashArray:'8,6'});},2000);
                       }
                     });
                   }
                   // Speed Spike highlight
                   if(anom["Anomaly Type"] === "Speed Spike" && anom._spikeIndex != null && window._rawTrackSpikeLayers && row){
                     row.addEventListener('click', function(){
                       window._rawTrackSpikeLayers.forEach(function(s){s.setStyle({color:'#ffdc00',weight:4,opacity:0.95,dashArray:'6,4'});});
                       var spikeLine = window._rawTrackSpikeLayers[anom._spikeIndex];
                       if(spikeLine){
                         spikeLine.setStyle({color:'#ff4136',weight:7,opacity:1,dashArray:null});
                         spikeLine.bringToFront();
                         spikeLine.openPopup();
                         setTimeout(function(){spikeLine.setStyle({color:'#ffdc00',weight:4,opacity:0.95,dashArray:'6,4'});},2000);
                       }
                     });
                   }
                 });
               }, 100);
             } else {
               tableBody.innerHTML = '<tr><td colspan="100%">Аномалий не обнаружено.</td></tr>';
               updateStatus('Device Track: без аномалий', 'green', 5000);
             }
          // drawRawDeviceTrack only, do not draw ordinary track (black lines)
          if(typeof drawRawDeviceTrack === 'function') drawRawDeviceTrack(response);
        } catch(e){
          console.warn('raw track rendering failed', e);
        }
  // Allow displaying parkings for future requests (if needed)
        setTimeout(function(){ window._suppressRawTrackStops = false; }, 50);
      }
    } else {
      tableBody.innerHTML = '<tr><td colspan="100%">Нет данных.</td></tr>';
      tableHead.innerHTML = "";
      updateStatus('Ответ пустой', '#dc3545', 6000);
    }
  };
  socket.onclose = function () {
    updateStatus('Соединение потеряно. Повторное подключение...', 'red');
    setTimeout(connect, 5000);
  };
  socket.onerror = function (err) {
    updateStatus('Ошибка: '+err.message, 'red', 8000);
  };
}
function sendRequest(req) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    updateStatus('WebSocket не подключен.', 'red', 6000);
    return;
  }
  try{
  // If this is a split request, do not reset state and do not clear tables
    if(req && req._splitBatch){
      // skip clearing logic
    } else {
      // If request contains date/device filters, detect changed values and clear tables BEFORE sending
      try{
        if(req && typeof req === 'object' && Array.isArray(req.filter)){
          var curFrom = null, curTo = null, curDev = null;
          req.filter.forEach(function(f){ try{ if(!f || typeof f !== 'object') return; var keys = Object.keys(f); keys.forEach(function(k){ var lk = k.toLowerCase(); if(lk.indexOf('datefrom')!==-1 || lk.indexOf('pgdatefrom')!==-1) { var v = f[k]; if(Array.isArray(v) && v.length) curFrom = String(v[0]); else curFrom = v; } else if(lk.indexOf('dateto')!==-1 || lk.indexOf('pgdateto')!==-1) { var v2 = f[k]; if(Array.isArray(v2) && v2.length) curTo = String(v2[0]); else curTo = v2; } else if(lk.indexOf('device')!==-1 || lk.indexOf('vihicle')!==-1 || lk.indexOf('vihicleid')!==-1) { var v3 = f[k]; if(Array.isArray(v3) && v3.length) curDev = String(v3[0]); else curDev = v3; } }); }catch(e){} });
          function toTs(s){ try{ if(!s) return null; if(typeof s !== 'string') s = String(s); if(s.length===16) s = s + ':00'; var d = new Date(s); if(!isNaN(d.getTime())) return d.getTime(); var p = Date.parse(s); return isNaN(p)?null:p; }catch(e){return null;} }
          // Normalize value for string fallback comparison: strip seconds and trailing Z/offset when present
          function normalizeStrDate(s){ try{ if(!s) return null; var ss = String(s).trim(); // remove seconds (:ss) if present
              // e.g. convert 2025-10-14T12:34:56Z -> 2025-10-14T12:34
              var m = ss.match(/^(.*T\d{2}:\d{2})(?::\d{2}(?:[Zz]|[+-].*)?)?$/);
              if(m) return m[1]; // minute precision string
              // if no T time part, return trimmed string
              return ss.replace(/\s+$/, ''); }catch(e){return String(s);} }
          var curFromTs = toTs(curFrom);
          var curToTs = toTs(curTo);
          var lastFromTs = (typeof window._lastSeenDateFrom !== 'undefined' && window._lastSeenDateFrom) ? toTs(window._lastSeenDateFrom) : null;
          var lastToTs = (typeof window._lastSeenDateTo !== 'undefined' && window._lastSeenDateTo) ? toTs(window._lastSeenDateTo) : null;
    // Compare at minute resolution to avoid spurious differences caused by seconds
    function toMin(ts){ try{ if(ts==null) return null; return Math.floor(Number(ts)/60000); }catch(e){return null;} }
    var lastFromMin = lastFromTs !== null ? toMin(lastFromTs) : null;
    var lastToMin = lastToTs !== null ? toMin(lastToTs) : null;
    var curFromMin = curFromTs !== null ? toMin(curFromTs) : null;
    var curToMin = curToTs !== null ? toMin(curToTs) : null;
    // Primary comparison: both sides parsed -> compare minutes
    var datesChanged = (lastFromMin !== null && curFromMin !== null && lastFromMin !== curFromMin) || (lastToMin !== null && curToMin !== null && lastToMin !== curToMin);
    // Fallback: if one side failed to parse, compare normalized minute-precision strings
    if(!datesChanged){
      try{
        var lastFromStrNorm = normalizeStrDate(window._lastSeenDateFrom);
        var lastToStrNorm = normalizeStrDate(window._lastSeenDateTo);
        var curFromStrNorm = normalizeStrDate(curFrom);
        var curToStrNorm = normalizeStrDate(curTo);
        if(lastFromStrNorm !== null && curFromStrNorm !== null && lastFromStrNorm !== curFromStrNorm) datesChanged = true;
        if(lastToStrNorm !== null && curToStrNorm !== null && lastToStrNorm !== curToStrNorm) datesChanged = true;
      }catch(e){}
    }
    var deviceChanged = (typeof window._lastSeenDeviceId !== 'undefined' && curDev != null && window._lastSeenDeviceId !== curDev);
          // (debug logging removed)
    // Update last-seen snapshots immediately so subsequent rapid requests see the new values
    try{ if(curFrom != null) window._lastSeenDateFrom = curFrom; if(curTo != null) window._lastSeenDateTo = curTo; if(curDev != null) window._lastSeenDeviceId = curDev; }catch(_){ }
    // Call handler and provide the computed change flags to avoid recomputation using globals
    if(datesChanged || deviceChanged){ try{ if(typeof window.handleDeviceOrDateChange === 'function') window.handleDeviceOrDateChange({source:'sendRequest', name: req && req.name, _raw: !!req._raw, datesChanged: datesChanged, deviceChanged: deviceChanged}); }catch(_){} }
        }
      }catch(e){ /* ignore parsing errors */ }
    }
  }catch(e){}
  try{
    // Show global loading overlay for overlay-related requests so user sees dim + spinner
    try{
      if(req && req.name && (req.name === 'Vehicle Show' || req.name === 'Vehicle Edit Distribution' || req.name === 'Device Status' || req.name === 'Vehicle Select Min')){
        try{ showLoadingOverlay('Загрузка...'); }catch(_){ }
      }
    }catch(_){ }
  }catch(e){}
  socket.send(JSON.stringify(req));
  updateStatus('Запрос отправлен. Ожидание ответа...', 'blue');
}
function buildLoginRequest() {
  return {
    name: "login",
    type: "login",
    mid: 0,
    act: "setup",
    usr: loginUserInput ? loginUserInput.value : "",
    pwd: loginPasswordInput ? loginPasswordInput.value : "",
    uid: 0,
    lang: "en",
  };
}
function sendLogin() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    statusDiv.textContent = "WebSocket не подключен.";
    statusDiv.style.color = "red";
    return;
  }
  var req = buildLoginRequest();
  statusDiv.textContent = "Отправка логина...";
  statusDiv.style.color = "blue";
  socket.send(JSON.stringify(req));
}
function requestVehicleSelectMin() {
  if (!authLoggedIn) return;
  var initReq = {
    name: "Vehicle Select Min",
    type: "etbl",
    mid: 4,
    act: "init",
    usr: authUser,
    pwd: authPwd,
    uid: authUid,
    lang: "en",
  };
  var setupReq = {
    name: "Vehicle Select Min",
    type: "etbl",
    mid: 4,
    act: "setup",
    filter: [{ selecteduid: [authUid] }],
    nowait: true,
    waitfor: [],
    usr: authUser,
    pwd: authPwd,
    uid: authUid,
    lang: "en",
  };
  sendRequest(initReq);
  setTimeout(function () {
    sendRequest(setupReq);
  }, 150);
}
// Send Vehicle Show (Device List) request
function requestVehicleShow() {
  if (!authLoggedIn) { updateStatus('⚠ Сначала вход', 'orange', 3000); return; }
  var req = {
    name: 'Vehicle Show',
    type: 'etbl',
    mid: 2,
    act: 'setup',
    filter: [],
    nowait: true,
    waitfor: [],
    usr: authUser,
    pwd: authPwd,
    uid: authUid,
    lang: 'ru'
  };
  sendRequest(req);
}
function requestAutoMileageReport() {
  if (!authLoggedIn) return;
  try {
    var dateTo = buildLocalDateParam(dateToInput.value, true);
    var dateFrom = buildLocalDateParam(dateFromInput.value, false);
    var deviceId = deviceIdInput.value;
    var req = {
      name: "Mileage Report",
      type: "map",
      mid: 2,
      act: "filter",
      filter: [
        { selectedvihicleid: [deviceId] },
        { selectedpgdateto: [dateTo] },
        { selectedpgdatefrom: [dateFrom] },
      ],
      usr: authUser,
      pwd: authPwd,
      uid: authUid,
      lang: "en",
    };
    sendRequest(req);
  } catch (e) {
    console.warn("auto mileage failed", e);
  }
}
