// Button to copy date from dateFrom to dateTo
document.addEventListener('DOMContentLoaded', function(){
  var btn = document.getElementById('copyDateFromToBtn');
  if(btn){
    btn.addEventListener('click', function(){
      var from = document.getElementById('dateFrom');
      var to = document.getElementById('dateTo');
      if(from && to && from.value){
  // Take only the date portion (YYYY-MM-DD)
        var datePart = from.value.split('T')[0];
        to.value = datePart + 'T23:59';
      }
    });
  }
});
// UI interactions (login, vehicle overlay, tables, directions toggle)
function init() {
  (function preloadRemembered() {
      if (localStorage.getItem("dt_remember") === "1") {
        var u = localStorage.getItem("dt_user") || "";
        var p = localStorage.getItem("dt_pwd") || "";
        if (loginUserInput) loginUserInput.value = u;
        if (loginPasswordInput) loginPasswordInput.value = p;
        if (rememberCheckbox) rememberCheckbox.checked = true;
      }
  })();

  if (loginBtn) {
    loginBtn.addEventListener("click", function (e) {
      e.preventDefault();
      if (!authLoggedIn) {
        sendLogin();
      } else {
        // Perform logout
        authLoggedIn = false;
        authUid = null;
        authUser = null;
        authPwd = null;
          localStorage.removeItem("dt_remember");
          localStorage.removeItem("dt_user");
          localStorage.removeItem("dt_pwd");
        var dot = document.getElementById('loginStatusDot'); if(dot){ dot.classList.remove('status-online'); dot.classList.add('status-offline'); dot.title = 'Offline'; }
        // Clear sensitive dependent UI pieces if needed
          if (tableHead) tableHead.innerHTML = "";
          if (tableBody) tableBody.innerHTML = "";
        // Reset button back to login state
        loginBtn.textContent = "Login";
        loginBtn.classList.remove("btn-success");
        loginBtn.classList.add("btn-danger");
      }
    });
  }

  if (toggleVehicleBtn) {
    toggleVehicleBtn.addEventListener("click", function(){ vehicleOverlayMode = 'selectMin'; toggleVehicleOverlay(); });
  }

  // (Old delegated reset kept for safety but primary binding now in ensureVehicleOverlay)
  if (document.getElementById("vehicleResetFilters")) {
    document.addEventListener("click", function (e) {
      if (
        e.target &&
        e.target.id === "vehicleResetFilters" &&
        !e.target.dataset.bound
      ) {
      try{
        var curFrom = dateFromInput ? dateFromInput.value : null;
        var curTo = dateToInput ? dateToInput.value : null;
        var curDev = deviceIdInput ? deviceIdInput.value : null;
        function toTs(s){ try{ if(!s) return null; if(typeof s !== 'string') s = String(s); if(s.length===16) s = s+':00'; var d=new Date(s); if(!isNaN(d.getTime())) return d.getTime(); var p = Date.parse(s); return isNaN(p)?null:p;}catch(e){return null;} }
        var lastFromTs = (typeof window._lastSeenDateFrom !== 'undefined' && window._lastSeenDateFrom) ? toTs(window._lastSeenDateFrom) : null;
        var lastToTs = (typeof window._lastSeenDateTo !== 'undefined' && window._lastSeenDateTo) ? toTs(window._lastSeenDateTo) : null;
        var curFromTs = toTs(curFrom);
        var curToTs = toTs(curTo);
        var datesChanged = (lastFromTs !== null && curFromTs !== null && lastFromTs !== curFromTs) || (lastToTs !== null && curToTs !== null && lastToTs !== curToTs);
        var deviceChanged = (typeof window._lastSeenDeviceId !== 'undefined' && window._lastSeenDeviceId !== curDev);
        if(datesChanged || deviceChanged){ try{ if(typeof window.handleDeviceOrDateChange === 'function') window.handleDeviceOrDateChange({source:'button.click', button:'Mileage'}); }catch(_){} }
  // Do not update last-seen snapshots here. sendRequest will update them
  // when an actual request is sent so changes are detected reliably.
      }catch(e){}
      }
    });
  }
  var copySqlBtn = document.getElementById("copySqlBtn");
  var copySqlStatus = document.getElementById("copySqlStatus");
  if (copySqlBtn) {
    copySqlBtn.addEventListener("click", function () {
      if (!sqlOutput) return;
      var raw = (sqlOutput.textContent || "").trim();
      var wrapped = "```\n" + raw + "\n```";
      navigator.clipboard
        .writeText(wrapped)
        .then(function () {
          if (copySqlStatus) {
            copySqlStatus.textContent = "Скопировано";
            copySqlStatus.style.display = "inline";
            setTimeout(function () {
              copySqlStatus.style.display = "none";
            }, 1800);
          }
        })
        .catch(function () {
          if (copySqlStatus) {
            copySqlStatus.textContent = "Ошибка";
            copySqlStatus.style.display = "inline";
            setTimeout(function () {
              copySqlStatus.style.display = "none";
            }, 1800);
          }
        });
    });
  }

  // Modal: SQL generation is now triggered from report-specific buttons

  if (closeModalBtn) {
    closeModalBtn.addEventListener("click", function () {
      sqlModal.style.display = "none";
    });
  }

  window.addEventListener("click", function (e) {
    if (e.target === sqlModal) {
      sqlModal.style.display = "none";
    }
  });

  // Requests buttons
  // Ensure backward-compatible split checkbox element exists
  (function ensureSplitCheckboxCompat(){
    try{
      var compat = document.getElementById('splitDevLogCheckbox');
      if(!compat){
        var hidden = document.createElement('input'); hidden.type='checkbox'; hidden.id='splitDevLogCheckbox'; hidden.style.display='none'; document.body.appendChild(hidden);
      }
      var toggle = document.getElementById('splitDevLogToggle');
      if(toggle && !toggle.dataset.bound){
        toggle.addEventListener('click', function(e){
          try{
            var pressed = toggle.getAttribute('aria-pressed') === 'true';
            pressed = !pressed;
            toggle.setAttribute('aria-pressed', pressed ? 'true' : 'false');
            // visual state
            if(pressed){ toggle.classList.remove('btn-secondary'); toggle.classList.add('btn-primary'); } else { toggle.classList.remove('btn-primary'); toggle.classList.add('btn-secondary'); }
            var compatEl = document.getElementById('splitDevLogCheckbox'); if(compatEl) compatEl.checked = pressed;
          }catch(e){}
        });
        toggle.dataset.bound = '1';
      }
    }catch(e){}
  })();

  // Adjust Dev Log + Split buttons so combined width equals width of a single Dev Log button
  function adjustDevLogButtons(){
    try{
  var wrapper = document.getElementById('devLogWrapper');
  var sendBtn = document.getElementById('sendDeviceLog');
  var splitBtn = document.getElementById('splitDevLogToggle');
  var mileageBtn = document.getElementById('sendMileageReport');
  var trackBtn = document.getElementById('sendDeviceTrack');
  var trackRawBtn = document.getElementById('sendDeviceTrackRaw');
  var topLeft = document.getElementById('actionTopLeft');
  var topRight = document.getElementById('actionTopRight');
  var bottomLeft = document.getElementById('actionBottomLeft');
  var bottomRight = document.getElementById('actionBottomRight');
  if(!wrapper || !sendBtn || !splitBtn || !trackRawBtn || !topLeft || !topRight || !bottomLeft || !bottomRight) return;
  // ensure top buttons fill their containers
  try{ if(mileageBtn){ mileageBtn.style.width = '100%'; mileageBtn.style.boxSizing='border-box'; } }catch(_){ }
  try{ if(trackBtn){ trackBtn.style.width = '100%'; trackBtn.style.boxSizing='border-box'; } }catch(_){ }
  try{ if(trackRawBtn){ trackRawBtn.style.width = '100%'; trackRawBtn.style.boxSizing='border-box'; } }catch(_){ }
  // bottom-right: split between Dev Log (flexible) and Split (minimal)
  var brWidth = Math.floor(bottomRight.getBoundingClientRect().width || 160);
  var splitMin = 36;
  var gap = 6;
  var available = brWidth - gap - splitMin;
  if(available < 40) available = Math.max(40, brWidth - gap - splitMin);
  try{ sendBtn.style.flex = '0 0 ' + Math.floor(available) + 'px'; sendBtn.style.boxSizing='border-box'; }catch(_){ }
  try{ splitBtn.style.flex = '0 0 ' + Math.ceil(splitMin) + 'px'; splitBtn.style.boxSizing='border-box'; }catch(_){ }
    }catch(e){ console.warn('adjustDevLogButtons failed', e); }
  }
  // call adjustment on init and on window resize
  try{ window.addEventListener('resize', function(){ setTimeout(adjustDevLogButtons, 50); }); }catch(e){}
  if (sendMileageReportBtn) {
    sendMileageReportBtn.addEventListener("click", function () {
      if (!authLoggedIn) {
        showRouteToast("⚠ Сначала выполните вход");
        return;
      }
      var dateTo = buildLocalDateParam(dateToInput.value, true);
      var dateFrom = buildLocalDateParam(dateFromInput.value, false);
      var deviceId = deviceIdInput.value;
      if (lastDeviceIdForMileage && lastDeviceIdForMileage !== deviceId) {
          if (window.clearFullDeviceTrackTable)
            window.clearFullDeviceTrackTable();
      }
      lastDeviceIdForMileage = deviceId;
      if (vehicleSelectMinData && deviceId) {
        var row = vehicleSelectMinData.find(function (r) {
          return String(r.id) === String(deviceId);
        });
        if (row) {
          selectedVehicleMeta = buildVehicleMeta(row);
          updateDeviceTrackHeader();
        }
      }
      // Clear previous mileage data
      window._mileageData = [];
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
      // sendRequest will detect date/device changes and call the central handler before sending

      // record request start for response timing
  try{ setReqStart && setReqStart('Mileage Report'); } catch(_){}
  sendRequest(req);
      sendAdditionalRequests(dateFrom, dateTo, deviceId);
    });
  }

  if (sendDeviceTrackBtn) {
    sendDeviceTrackBtn.addEventListener("click", function () {
      if (!authLoggedIn) {
        showRouteToast("⚠ Сначала выполните вход");
        return;
      }
        if (mileageGapLayers && mileageGapLayers.length) {
          mileageGapLayers.forEach(function (g) {
            trackLayerGroup.removeLayer(g);
          });
          mileageGapLayers = [];
        }
      var dateTo = buildLocalDateParam(dateToInput.value, true);
      var dateFrom = buildLocalDateParam(dateFromInput.value, false);
      var deviceId = deviceIdInput.value;
      if (vehicleSelectMinData && deviceId) {
        var row = vehicleSelectMinData.find(function (r) {
          return String(r.id) === String(deviceId);
        });
        if (row) {
          selectedVehicleMeta = buildVehicleMeta(row);
          updateDeviceTrackHeader();
        }
      }
      // Clear previous track data
      window._trackData = [];
  // Ensure default render mode for normal Track is polyline
  window.rawTrackRenderMode = 'polyline'; if(typeof window.updateRawTrackModeButton === 'function') window.updateRawTrackModeButton();
      window._suppressRawTrackStops = true;

      var mileageReq = {
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

      var trackReq = {
        name: "Vehicle Track",
        type: "map",
        mid: 2,
        act: "filter",
        filter: [
          { selectedpgdateto: [dateTo] },
          { selectedpgdatefrom: [dateFrom] },
          { selectedvihicleid: [deviceId] },
        ],
        usr: authUser,
        pwd: authPwd,
        uid: authUid,
        lang: "en",
      };
  // sendRequest will handle date/device change detection and call the central handler

  try{ setReqStart && setReqStart('Mileage Report'); } catch(_){ }
  try{ setReqStart && setReqStart('Vehicle Track'); } catch(_){ }
  sendRequest(mileageReq);
  sendRequest(trackReq);
      sendAdditionalRequests(dateFrom, dateTo, deviceId);
    });
  }

  var sendDeviceTrackRawBtn = document.getElementById('sendDeviceTrackRaw');
  if(sendDeviceTrackRawBtn){
    sendDeviceTrackRawBtn.addEventListener('click', function(){
      if (!authLoggedIn) { showRouteToast('⚠ Сначала выполните вход'); return; }
      // Keep similar pre-checks as normal Track: clear gap layers etc
      try{ if(mileageGapLayers && mileageGapLayers.length){ mileageGapLayers.forEach(function(g){ try{ trackLayerGroup.removeLayer(g);}catch(_){} }); mileageGapLayers=[]; } }catch(e){ console.warn('Не удалось очистить стоянки перед Device Track Raw', e); }
      var dateTo = buildLocalDateParam(dateToInput.value, true);
      var dateFrom = buildLocalDateParam(dateFromInput.value, false);
      var deviceId = deviceIdInput.value;
      if (vehicleSelectMinData && deviceId) {
        var row = vehicleSelectMinData.find(function (r) { return String(r.id) === String(deviceId); });
        if (row) { selectedVehicleMeta = buildVehicleMeta(row); updateDeviceTrackHeader(); }
      }
      window._trackData = [];
  // Force points-only mode for Track Raw
  try { window.rawTrackRenderMode = 'points'; if(typeof window.updateRawTrackModeButton === 'function') window.updateRawTrackModeButton(); } catch(_){}
  window._suppressRawTrackStops = true;
      var trackReq = {
        name: "Vehicle Track",
        type: "map",
        mid: 2,
        act: "filter",
        filter: [
          { selectedpgdateto: [dateTo] },
          { selectedpgdatefrom: [dateFrom] },
          { selectedvihicleid: [deviceId] }
        ],
        usr: authUser,
        pwd: authPwd,
        uid: authUid,
        lang: 'en'
      };
  // mark this request as raw-track so central handler can treat it specially
  try{ trackReq._raw = true; }catch(_){ }
  // sendRequest will handle date/device change detection and call the central handler

  setReqStart && setReqStart('Vehicle Track');
  sendRequest(trackReq);
      setTimeout(function(){ window._suppressRawTrackStops = false; }, 50);
    });
  }

  setDefaultDates();
  if(typeof initVehicleColorFilters==='function') initVehicleColorFilters();
  ensureVehicleOverlay();
  // adjust Dev Log buttons layout
  setTimeout(adjustDevLogButtons, 40);
  // Ensure floating panel toggle FAB behavior
  (function setupPanelFab(){
      var fab = document.getElementById('panelFabToggle');
      var panel = document.getElementById('filterPanel');
      if(!fab || !panel) return;

      // persistent collapsed state stored on panel.dataset.collapsed = '1'|'0'
      var setCollapsed = function(collapsed){
        if(collapsed){
          panel.classList.add('collapsed');
          panel.dataset.collapsed = '1';
          fab.setAttribute('aria-pressed','false');
        } else {
          panel.classList.remove('collapsed');
          panel.dataset.collapsed = '0';
          fab.setAttribute('aria-pressed','true');
        }
      };

      // Modes: 'always' (panel always visible), 'hover' (panel hidden, show on hover)
      var currentMode = panel.dataset.mode || 'always'; // default to always visible

      var applyMode = function(){
        if(currentMode === 'always'){
          setCollapsed(false);
          // remove hover listeners
          panel.removeEventListener('mouseenter', panelEnterHandler);
          panel.removeEventListener('mouseleave', panelLeaveHandler);
          fab.removeEventListener('mouseenter', panelEnterHandler);
          fab.removeEventListener('mouseleave', panelLeaveHandler);
        } else if(currentMode === 'hover'){
          setCollapsed(true);
          // add hover listeners to both panel and fab
          panel.addEventListener('mouseenter', panelEnterHandler);
          panel.addEventListener('mouseleave', panelLeaveHandler);
          fab.addEventListener('mouseenter', panelEnterHandler);
          fab.addEventListener('mouseleave', panelLeaveHandler);
        }
      };

      var panelEnterHandler = function(){
        if(currentMode === 'hover'){
          setCollapsed(false);
        }
      };

      var panelLeaveHandler = function(){
        if(currentMode === 'hover'){
          setCollapsed(true);
        }
      };

      // initialize
      panel.dataset.mode = currentMode;
      applyMode();

      if(!fab.dataset.bound){
        fab.addEventListener('click', function(e){
          e.stopPropagation();
          // toggle mode
          currentMode = (currentMode === 'always') ? 'hover' : 'always';
          panel.dataset.mode = currentMode;
          applyMode();
        });
        fab.dataset.bound = '1';
      }
    })();
}

function setAuthInfo(uid, user, pwd) {
  authUid = uid;
  authUser = user;
  authPwd = pwd;
  authLoggedIn = true;
  if (rememberCheckbox && rememberCheckbox.checked) {
      localStorage.setItem("dt_remember", "1");
      localStorage.setItem("dt_user", user || "");
      localStorage.setItem("dt_pwd", pwd || "");
  } else {
      localStorage.removeItem("dt_remember");
      localStorage.removeItem("dt_user");
      localStorage.removeItem("dt_pwd");
  }
  if (loginInfo) {
    // Do not display numeric UID on the page; show username (if available) or keep blank
    loginInfo.textContent = user ? String(user) : '';
    loginInfo.style.color = "#198754";
  }
  if (loginBtn) {
    loginBtn.disabled = false;
    loginBtn.textContent = "Logout";
    loginBtn.classList.remove("btn-danger");
    loginBtn.classList.add("btn-success");
  }
}

function tryApplyFleetMapping() {
  if (!fleetKeyMap) return;
  var applyTo = function (arr) {
    if (!arr || !Array.isArray(arr)) return;
    arr.forEach(function (r) {
      if (r && Object.prototype.hasOwnProperty.call(r, "fleet")) {
        var original = r.fleet;
        if (original == null) return;
        // preserve original key so edits can submit the ID instead of display name
        if (r.__fleetKey === undefined) r.__fleetKey = original;
        if (fleetKeyMap.hasOwnProperty(original)) {
          r.fleet = fleetKeyMap[original];
        } else if (typeof original === "number" || /^\d+$/.test(String(original))) {
          var num = parseInt(original, 10);
          if (fleetKeyMap.hasOwnProperty(num)) r.fleet = fleetKeyMap[num];
        }
      }
    });
  };
  applyTo(vehicleSelectMinData);
  applyTo(vehicleShowData);
}

function updateDeviceTrackHeader() {
  // Now displays only fleet | number in side panel header
  if (!vehicleMetaDisplay) return;
  if (selectedVehicleMeta) {
    var parts = [];
    if (selectedVehicleMeta.fleet != null && selectedVehicleMeta.fleet !== "")
      parts.push(String(selectedVehicleMeta.fleet));
    if (selectedVehicleMeta.number != null && selectedVehicleMeta.number !== "")
      parts.push(String(selectedVehicleMeta.number));
    vehicleMetaDisplay.textContent = parts.join(" | ");
  } else {
    vehicleMetaDisplay.textContent = "";
  }
}

function renderVehicleTable() {
  // Choose active dataset based on overlay mode
  var activeData = vehicleOverlayMode === 'show' ? vehicleShowData : vehicleSelectMinData;
  if (!activeData || !activeData.length) {
    if (vehicleTableHead) vehicleTableHead.innerHTML = "";
    if (vehicleTableBody)
      vehicleTableBody.innerHTML = "<tr><td>Нет данных</td></tr>";
    return;
  }
  if (!vehicleColumns) vehicleColumns = Object.keys(activeData[0] || {});
  // Capture focus info BEFORE rebuild (only for column filter inputs inside thead)
  var activeEl = document.activeElement;
  var activeCol =
    activeEl && activeEl.dataset && activeEl.dataset.column
      ? activeEl.dataset.column
      : null;
  var caretPos =
    activeEl && typeof activeEl.selectionStart === "number"
      ? activeEl.selectionStart
      : null;

  applyVehicleFilters();
  var data = vehicleFilteredData || activeData;
  if (vehicleTableHead) vehicleTableHead.innerHTML = "";
  if (vehicleTableBody) vehicleTableBody.innerHTML = "";
  var headersBase = data.length
    ? Object.keys(data[0])
    : vehicleColumns
    ? vehicleColumns.slice()
    : Object.keys(activeData[0] || {});
  var headers = headersBase.filter(function (h) {
    return h !== "__origIndex" && h !== "__fleetKey";
  });
  if (headers.indexOf("№") === -1) headers.unshift("№");
  // Add Action column for per-row buttons (selection) only for non-vehicle (TS) overlays
  if (vehicleOverlayMode !== 'selectMin') {
    if (headers.indexOf('Action') === -1) headers.push('Action');
  }

  // Header row (sorting)
  var trHead = document.createElement("tr");
  // mark the header row with the requested class so it can be selected via
  // #vehicleTableHead > tr:nth-child(1) and similar XPaths
  trHead.className = 'vehicle-filter-row';
  headers.forEach(function (h) {
    var th = document.createElement("th");
    // Preserve original key for lookups via data-key, but show a friendly label
    th.dataset.key = h;
    var displayLabel = h;
    try {
      var hlc = String(h).toLowerCase();
      if (hlc === 'контроль' || hlc === 'control') displayLabel = 'Питание';
    } catch (e) {}
    th.textContent = displayLabel;
    th.style.cursor = "pointer";
    th.addEventListener("click", function () {
      toggleVehicleSort(h);
    });
    if (vehicleSortState.column === h) {
      th.textContent = displayLabel + (vehicleSortState.dir === 1 ? " ▲" : " ▼");
    }
    trHead.appendChild(th);
  });
  vehicleTableHead.appendChild(trHead);

  // Filter inputs row
  var filterRow = document.createElement("tr");
  filterRow.className = "vehicle-filter-row";
  headers.forEach(function (h) {
    var thf = document.createElement("th");
    if (h !== "№" && h !== 'Action') {
      var inp = document.createElement("input");
      inp.type = "text";
      inp.placeholder = "Фильтр";
      if (vehicleColumnFilters[h]) inp.value = vehicleColumnFilters[h];
      inp.dataset.column = h;
      inp.addEventListener("input", function () {
        vehicleColumnFilters[h] = inp.value;
        // Re-render but preserve focus via capture at top
        renderVehicleTable();
      });
      thf.appendChild(inp);
    }
    filterRow.appendChild(thf);
  });
  vehicleTableHead.appendChild(filterRow);

  // Make header row and filter row sticky within overlay scroll container
  try {
    var headRow = vehicleTableHead.querySelector('tr');
    if (headRow) {
      // ensure header th have sticky top and sit above the filter row
      Array.prototype.slice
        .call(headRow.querySelectorAll('th'))
        .forEach(function (th) {
          th.style.position = 'sticky';
          th.style.top = '0px';
          th.style.zIndex = 3;
          th.style.background = '#f8f9fa';
        });
      // compute header height and expose it as a CSS variable on the overlay body
      var headerH = headRow.offsetHeight || 0;
      try {
        var overlayBody = vehicleOverlay ? vehicleOverlay.querySelector('.vehicle-overlay-body') : null;
        if (overlayBody && overlayBody.style) {
          overlayBody.style.setProperty('--vehicle-table-filter-top', headerH + 'px');
        }
      } catch (e) {}
    }
  } catch (e) {}

  // ensure we recompute sticky positions on resize while overlay is open
  try {
    if (vehicleOverlay && !vehicleOverlay.dataset.resizeBound) {
      window.addEventListener('resize', function () {
        try { renderVehicleTable(); } catch (e) {}
      });
      vehicleOverlay.dataset.resizeBound = '1';
    }
  } catch (e) {}

  // Restore focus if still relevant
  if (activeCol) {
    var newInput = vehicleTableHead.querySelector(
      'input[data-column="' + activeCol + '"]'
    );
    if (newInput) {
      newInput.focus();
      if (caretPos != null) {
        try {
          newInput.selectionStart = newInput.selectionEnd = Math.min(
            caretPos,
            newInput.value.length
          );
        } catch (e) {}
      }
    }
  }

  // Device List button: open vehicle overlay and request full Vehicle Show
  var deviceListBtn = document.getElementById('deviceListBtn');
  if (deviceListBtn && !deviceListBtn.dataset.bound) {
    deviceListBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align: middle; margin-right:4px;"><path fill="currentColor" d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>Device List';
    deviceListBtn.addEventListener('click', function(){
      // set overlay mode to 'show' so render uses vehicleShowData
      try{ vehicleOverlayMode = 'show'; } catch(_){}
  // ensure Device List uses list mode (not edit mode) so Action shows 'Select'
      try{ vehicleShowMode = 'list'; } catch(_){ }
      // Reuse existing overlay toggle behavior to ensure consistent UI
      try { toggleVehicleOverlay(); } catch(e){ try{ ensureVehicleOverlay(); if(vehicleOverlay) vehicleOverlay.style.display='block'; }catch(_){}}
  // Reset filters for Device List on open
  try { var showSi = document.getElementById('vehicleShowSearchInput'); if (showSi) showSi.value = ''; } catch(_){}
  vehicleSortState = { column: null, dir: 1 }; vehicleColumnFilters = {};
      renderVehicleTable();
      // If we have a pending Vehicle Show payload (stashed while editing), apply it first
      try{
        if(window._vehicleShowPending && Array.isArray(window._vehicleShowPending)){
          vehicleShowData = window._vehicleShowPending.slice();
          vehicleShowData.forEach(function(r,i){ if(r && r.__origIndex===undefined) r.__origIndex = i; });
          tryApplyFleetMapping();
          delete window._vehicleShowPending;
          renderVehicleTable();
        }
      }catch(e){ console.warn('apply pending vehicle show failed', e); }
      // Request server data for Vehicle Show
      try{
        updateStatus('Запрос списка устройств...', 'blue', 3000);
        if(typeof requestVehicleShow === 'function') requestVehicleShow();
      } catch(e){ console.warn('requestVehicleShow failed', e); }
    });
    deviceListBtn.dataset.bound = '1';
  }

  if (!data.length) {
    // If we're waiting for edit payload, render skeleton rows
    if (window._vehicleShowLoading) {
      var skeletonCount = 6;
      for (var si=0; si<skeletonCount; si++) {
        var trSk = document.createElement('tr'); trSk.className='skeleton-row';
        for (var sh=0; sh<headers.length; sh++){
          var tdSk = document.createElement('td'); tdSk.className='skeleton-cell'; tdSk.innerHTML = '<div class="skeleton-line"></div>'; trSk.appendChild(tdSk);
        }
        vehicleTableBody.appendChild(trSk);
      }
      return;
    }
    var trEmpty = document.createElement("tr");
    var tdEmpty = document.createElement("td");
    tdEmpty.colSpan = headers.length;
    tdEmpty.textContent = "Нет результатов";
    trEmpty.appendChild(tdEmpty);
    vehicleTableBody.appendChild(trEmpty);
    return;
  }
  var frag = document.createDocumentFragment();
  var nowTs = Date.now();
  data.forEach(function (row, idx) {
    var ageInfo = getRowAgeGrade(row, nowTs);
    var rowColor = ageInfo.gradeColor;
    var rowCat = ageInfo.ageCategory; // ">365", ">180", ">30", ">5" or null
    if (window.vehicleColorVisibility) {
      if (
        rowCat &&
        Object.prototype.hasOwnProperty.call(
          window.vehicleColorVisibility,
          rowCat
        )
      ) {
        if (!window.vehicleColorVisibility[rowCat]) {
          return; // skip hidden category
        }
      }
    }
    var tr = document.createElement("tr");
    headers.forEach(function (h) {
      var td = document.createElement("td");
      if (h === "№") {
        td.textContent = (
          row.__origIndex != null ? row.__origIndex + 1 : idx + 1
        ).toString();
      } else if (h === 'Action') {
          try { td.classList.add('action-cell'); } catch(_){}
        // In edit mode for Vehicle Show, render Edit/Save toggle button per row
        if (vehicleOverlayMode === 'show' && vehicleShowMode === 'edit') {
          var editBtn = document.createElement('button');
          editBtn.className = 'btn btn-warning btn-xs vehicle-edit-btn';
          editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align: middle; margin-right:4px;"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>Редактировать';
          // Track edit state on the button
          editBtn.dataset.editing = '0';
          editBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            var tr = ev.target.closest('tr');
            if (!tr) return;
            var editing = editBtn.dataset.editing === '1';
            if (!editing) {
              console.debug('Vehicle edit: entering edit mode for row', row && row.id, row);
              // Switch to editing mode: replace cells for number, brand, model, notes, fleet with inputs/selects
              editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align: middle; margin-right:4px;"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>Сохранить';
              editBtn.dataset.editing = '1';
              // disable other edit buttons so only one row is editable at a time
              try {
                var allEditBtns = document.querySelectorAll('.vehicle-edit-btn');
                Array.prototype.slice.call(allEditBtns).forEach(function(b){ if (b !== editBtn) try{ b.disabled = true; }catch(_){}});
              } catch(_){}
              // create Cancel button next to editBtn
              var cancelBtn = document.createElement('button');
              cancelBtn.className = 'btn btn-secondary btn-xs';
              cancelBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align: middle; margin-right:4px;"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>Отменить';
              cancelBtn.addEventListener('click', function(ev2){
                ev2.stopPropagation();
                try {
                  // restore original values from data-orig
                  var headers = Array.prototype.slice.call(vehicleTableHead.querySelectorAll('tr:first-child th')).map(function(th){ return (th.dataset && th.dataset.key) ? th.dataset.key : th.textContent.replace(/ ▲| ▼$/,''); });
                  ['number','brand','model','notes','fleet'].forEach(function(col){
                    var idx = headers.indexOf(col);
                    if (idx === -1) return;
                    var cell = tr.children[idx];
                    if (!cell) return;
                    var orig = cell.getAttribute('data-orig');
                    cell.textContent = orig != null ? orig : '';
                    try { cell.removeAttribute('data-orig'); } catch(_){}
                  });
                  // reset edit button state
                  editBtn.dataset.editing = '0';
                  editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align: middle; margin-right:4px;"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>Редактировать';
                  editBtn.disabled = false;
                  // re-enable other edit buttons
                  try { document.querySelectorAll('.vehicle-edit-btn').forEach(function(b){ try{ b.disabled = false;}catch(_){}}); } catch(_){}
                  // remove cancel button from DOM
                  if (cancelBtn && cancelBtn.parentNode) cancelBtn.parentNode.removeChild(cancelBtn);
                  // remove any pending save entry for this id (not yet sent usually)
                  try { var rid = String(row && row.id || ''); if (window.pendingVehicleSaves && window.pendingVehicleSaves[rid]) delete window.pendingVehicleSaves[rid]; } catch(_){}
                } catch (e) { console.warn('Cancel edit failed', e); }
              });
              // attach for later cleanup by save/finalize
              editBtn._cancelBtn = cancelBtn;
              td.appendChild(cancelBtn);
              // find cell indices for the editable columns
              var headers = Array.prototype.slice.call(vehicleTableHead.querySelectorAll('tr:first-child th')).map(function(th){ return (th.dataset && th.dataset.key) ? th.dataset.key : th.textContent.replace(/ ▲| ▼$/,''); });
              ['number','brand','model','notes','fleet'].forEach(function(col){
                var idx = headers.indexOf(col);
                if (idx === -1) return;
                var cell = tr.children[idx];
                if (!cell) return;
                var val = cell.textContent || '';
                // store original value on the cell to allow restore on error
                try { cell.setAttribute('data-orig', val); } catch(_){}
                if (col === 'fleet') {
                  // create select with fleetKeyMap options
                  var sel = document.createElement('select');
                  sel.style.width = '100%';
                  sel.className = 'fleet-select';
                  // add an empty option
                  var emptyOpt = document.createElement('option'); emptyOpt.value = ''; emptyOpt.textContent = '--'; sel.appendChild(emptyOpt);
                  if (fleetKeyMap) {
                    console.debug('Vehicle edit: building fleet select from fleetKeyMap, entries=', Object.keys(fleetKeyMap).length);
                    // build array of {k, name} and sort by name (case-insensitive)
                    var opts = Object.keys(fleetKeyMap).map(function(k){ return {k:k, name: String(fleetKeyMap[k]||'')}; });
                    opts.sort(function(a,b){ return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
                    console.debug('Vehicle edit: sorted fleet options sample=', opts.slice(0,5));
                    opts.forEach(function(oEntry){
                      var o = document.createElement('option');
                      o.value = oEntry.k;
                      o.textContent = oEntry.name;
                      sel.appendChild(o);
                    });
                  }
                  // try select current mapped name back to key if possible
                  try{
                    // Prefer the preserved original key if present on the row
                    var preferred = (row && row.__fleetKey != null) ? String(row.__fleetKey) : null;
                    if (preferred && sel.querySelector('option[value="'+preferred+'"]')) {
                      sel.value = preferred;
                    } else {
                      var currentKey = Object.keys(fleetKeyMap || {}).find(function(k){ return String(fleetKeyMap[k]) === String(val); });
                      if(currentKey) sel.value = currentKey; else sel.value = '';
                    }
                  }catch(_){}
                  cell.innerHTML = '';
                  cell.appendChild(sel);
                } else {
                  // For notes, provide an input with a button to paste persistent Note
                  if (col === 'notes') {
                    var wrapper = document.createElement('div'); wrapper.className = 'notes-input-wrap';
                    var inp = document.createElement('input');
                    inp.type = 'text';
                    inp.value = val;
                    inp.style.flex = '1 1 auto';
                    inp.style.padding = '4px 6px';
                    inp.style.boxSizing = 'border-box';
                    // button with clipboard/note icon
                    var noteBtn = document.createElement('button');
                    noteBtn.type = 'button';
                    noteBtn.className = 'btn btn-sm btn-outline';
                    // simple icon (pencil+paper) using emoji for cross-browser simplicity
                    noteBtn.innerHTML = '&#x1F4DD;';
                    noteBtn.title = 'Вставить Note';
                    noteBtn.addEventListener('click', function(ev){
                      ev.stopPropagation();
                      try {
                        var saved = '';
                        try { saved = localStorage.getItem('vehicleOverlayNote') || ''; } catch(e){}
                        inp.value = saved;
                        // trigger input event so later save picks it up
                        try { var ev2 = new Event('input', { bubbles: true }); inp.dispatchEvent(ev2); } catch(e){}
                      } catch(e){ console.warn('Insert Note into notes failed', e); }
                    });
                    wrapper.appendChild(inp);
                    wrapper.appendChild(noteBtn);
                    cell.innerHTML = '';
                    cell.appendChild(wrapper);
                  } else {
                    var inp = document.createElement('input');
                    inp.type = 'text';
                    inp.value = val;
                    inp.style.width = '100%';
                    cell.innerHTML = '';
                    cell.appendChild(inp);
                  }
                }
              });
            } else {
              // Save: collect values and send update request
              editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align: middle; margin-right:4px;"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>Редактировать';
              editBtn.dataset.editing = '0';
                var headers = Array.prototype.slice.call(vehicleTableHead.querySelectorAll('tr:first-child th')).map(function(th){ return (th.dataset && th.dataset.key) ? th.dataset.key : th.textContent.replace(/ ▲| ▼$/,''); });
              var payload = {};
              ['number','brand','model','notes','fleet'].forEach(function(col){
                var idx = headers.indexOf(col);
                if (idx === -1) return;
                var cell = tr.children[idx];
                if (!cell) return;
                var input = cell.querySelector('input,select');
                if (!input) return;
                var v = input.value;
                // For fleet, send key (not display name)
                if (col === 'fleet') {
                  payload['fleet'] = v;
                } else {
                  payload[col] = v;
                }
                // replace cell content with new text
                cell.textContent = v;
              });
              // include id to identify row
              if (row && row.id != null) payload.id = row.id;
              // Send update request to server in the exact format required
              try {
                // prepare cols and register pending save so ws.js can handle confirmation
                console.debug('Vehicle edit: preparing rowsave payload for id=', payload.id, payload);
                editBtn.disabled = true;
                var cols = {};
                // include only provided keys
                Object.keys(payload).forEach(function(k){ cols[k] = String(payload[k]); });
                var req = {
                  name: 'Vehicle Edit Distribution',
                  type: 'etbl',
                  mid: 2,
                  act: 'rowsave',
                  cols: cols,
                  usr: authUser,
                  pwd: authPwd,
                  uid: authUid,
                  lang: 'ru'
                };
                // Save state so we can restore UI on error or finalize on success
                try {
                  var rid = String(payload.id || '');
                  var originalValues = {};
                  // capture original text for editable cells so we can restore if needed
                  ['number','brand','model','notes','fleet'].forEach(function(col){
                    var headers = Array.prototype.slice.call(vehicleTableHead.querySelectorAll('tr:first-child th')).map(function(th){ return (th.dataset && th.dataset.key) ? th.dataset.key : th.textContent.replace(/ ▲| ▼$/,''); });
                    var idx = headers.indexOf(col);
                    if (idx === -1) return;
                    var cell = tr.children[idx];
                    if (!cell) return;
                    originalValues[col] = cell.getAttribute('data-orig') || cell.textContent || '';
                  });
                  pendingVehicleSaves[rid] = { btn: editBtn, tr: tr, originalValues: originalValues, newValues: cols };
                  console.debug('Vehicle edit: registered pending save for id=', rid, pendingVehicleSaves[rid]);
                  // Optimistically apply new values to vehicleShowData so overlay updates immediately
                  try {
                    if (window.vehicleShowData && Array.isArray(window.vehicleShowData)) {
                      var existing = window.vehicleShowData.find(function(x){ return String(x.id) === String(rid); });
                      if (existing) {
                        Object.keys(cols).forEach(function(k){ existing[k] = cols[k]; });
                        tryApplyFleetMapping();
                        // clear loading skeleton and re-render
                        try { if(window._vehicleShowLoading) delete window._vehicleShowLoading; } catch(_){}
                        try { if(typeof renderVehicleTable === 'function') renderVehicleTable(); } catch(_){}
                      }
                    }
                  } catch(e){ console.warn('Optimistic apply of vehicle edit failed', e); }
                } catch (e) { console.warn('Register pending save failed', e); }
                sendRequest(req);
                showRouteToast('Сохранение отправлено', 1600);
              } catch (e) { console.warn('Save vehicle edit failed', e); try{ editBtn.disabled = false; }catch(_){ } }
            }
          });
              // mark action cell so CSS can expand it in edit mode
              try{ td.classList.add('action-edit-mode'); }catch(_){ }
              td.appendChild(editBtn);
        } else {
          var btn = document.createElement('button');
          btn.className = 'btn btn-primary btn-xs';
          // If hiding is requested for selectMin overlay, do not render button
          var shouldHideButton = (typeof hideVehicleSelectButton !== 'undefined' && hideVehicleSelectButton === true && vehicleOverlayMode === 'selectMin');
          if (!shouldHideButton) {
            btn.textContent = 'Выбрать';
            // make the button perform the same action as row click by delegating to tr's click handler
            btn.addEventListener('click', function(ev){
              ev.stopPropagation();
              // attempt delegated row click (works for selectMin), then always ensure selection
              try { if (tr && typeof tr.click === 'function') { tr.click(); } } catch(e){}
              // perform selection directly (works when overlay is Device List / show)
              try {
                if (row && row.id != null) {
                  deviceIdInput.value = row.id;
                  selectedVehicleMeta = buildVehicleMeta(row);
                  updateDeviceTrackHeader();
                  try { if (typeof window.handleDeviceOrDateChange === 'function') window.handleDeviceOrDateChange({source:'ui.select'}); else if (window.clearFullDeviceTrackTable) window.clearFullDeviceTrackTable(); } catch(_){ }
                  if (vehicleOverlay) vehicleOverlay.style.display = 'none';
                  showRouteToast('✅ Выбрано устройство ID ' + row.id, 1800);
                }
              } catch(e){}
            });
            td.appendChild(btn);
          }
        }
      } else {
        var val = row[h];
        if (val == null) val = "";
        td.textContent = val;
      }
      tr.appendChild(td);
    });
    if (rowColor) tr.style.background = rowColor;
    // Row click handler: select device (only for selectMin overlay to avoid changing other overlays)
    tr.addEventListener('click', function(){
      try {
        if (vehicleOverlayMode !== 'selectMin') return; // don't change behavior in other overlays
        if (row && row.id != null) {
          deviceIdInput.value = row.id;
          selectedVehicleMeta = buildVehicleMeta(row);
          updateDeviceTrackHeader();
          try { if (typeof window.handleDeviceOrDateChange === 'function') window.handleDeviceOrDateChange({source:'ui.select'}); else if (window.clearFullDeviceTrackTable) window.clearFullDeviceTrackTable(); } catch(_){}
          if (vehicleOverlay) vehicleOverlay.style.display = 'none';
          showRouteToast('✅ Выбрано устройство ID ' + row.id, 1800);
          // Clear logs/tables
          try {
            if (window.hardClearDeviceLogTables) {
              window.hardClearDeviceLogTables();
            } else if (typeof clearTable === 'function' && window.deviceAlarmThead) {
              clearTable(deviceAlarmThead, deviceAlarmTbody);
              clearTable(deviceLogThead, deviceLogTbody);
            }
            if (window.lastDeviceIdForLogs !== undefined) window.lastDeviceIdForLogs = null;
          } catch (e) {}
        }
      } catch(e) { console.warn('Row click select failed', e); }
    });
    frag.appendChild(tr);
  });
  vehicleTableBody.appendChild(frag);
}

// Initialize color filter visibility map (default: only #fff7ecff visible)
if (!window.vehicleColorVisibility) {
  window.vehicleColorVisibility = {
    ">365": false,
    ">180": false,
    ">30": false,
    ">5": true,
    "0": true,
  };
}

function initVehicleColorFilters() {
  var ctr = document.getElementById("vehicleColorFilters");
  if (!ctr || ctr.dataset.bound) return;
  ctr.dataset.bound = "1";
  ctr.addEventListener("click", function (e) {
    var btn = e.target.closest(".color-filter-btn");
    if (!btn) return;
    var cat = btn.getAttribute("data-cat");
    if (!cat) return;
    window.vehicleColorVisibility[cat] = !window.vehicleColorVisibility[cat];
    btn.classList.toggle("active", window.vehicleColorVisibility[cat]);
    renderVehicleTable();
  });
  // set initial active states
  Array.prototype.slice
    .call(ctr.querySelectorAll(".color-filter-btn"))
    .forEach(function (b) {
      var c = b.getAttribute("data-cat");
      b.classList.toggle("active", !!window.vehicleColorVisibility[c]);
    });
}

function applyVehicleFilters() {
  var searchInput = document.getElementById("vehicleSearchInput");
  var showSearchInput = document.getElementById("vehicleShowSearchInput");
  var showResetBtn = document.getElementById("vehicleShowResetBtn");
  // Use active dataset based on overlay mode
  var activeData = vehicleOverlayMode === 'show' ? vehicleShowData : vehicleSelectMinData;
  if (!activeData) {
    vehicleFilteredData = null;
    return;
  }
  var term = '';
  if (vehicleOverlayMode === 'show') {
    term = ((showSearchInput && showSearchInput.value) || "").trim().toLowerCase();
  } else {
    term = ((searchInput && searchInput.value) || "").trim().toLowerCase();
  }
  var data = activeData.slice();
  if (term) {
    data = data.filter(function (r) {
      return Object.values(r).some(function (v) {
        return String(v).toLowerCase().includes(term);
      });
    });
  }
  Object.keys(vehicleColumnFilters).forEach(function (col) {
    var val = vehicleColumnFilters[col];
    if (val == null || val === "") return;
    var needle = String(val).toLowerCase();
    data = data.filter(function (r) {
      return String(r[col] || "")
        .toLowerCase()
        .includes(needle);
    });
  });
  if (vehicleSortState.column) {
    var col = vehicleSortState.column;
    var dir = vehicleSortState.dir;
    if (col === "№") {
      data.sort(function (a, b) {
        var ai = a.__origIndex || 0;
        var bi = b.__origIndex || 0;
        return (ai - bi) * dir;
      });
    } else {
      data.sort(function (a, b) {
        var av = a[col],
          bv = b[col];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (!isNaN(parseFloat(av)) && !isNaN(parseFloat(bv)))
          return (parseFloat(av) - parseFloat(bv)) * dir;
        return (
          String(av).localeCompare(String(bv), "ru", { numeric: true }) * dir
        );
      });
    }
  }
  vehicleFilteredData = data;
  // Apply color/category filters only for the 'selectMin' overlay (vehicle). Device List ('show') should not be filtered by these buttons.
  try {
    if (vehicleOverlayMode === 'selectMin') {
      var activeCats = Object.keys(window.vehicleColorVisibility || {}).filter(function(c){ return !!window.vehicleColorVisibility[c]; });
      if (activeCats && activeCats.length > 0) {
        vehicleFilteredData = vehicleFilteredData.filter(function(r){
          var info = getRowAgeGrade(r, Date.now());
          var cat = info.ageCategory || (info.ageCategory===null && null);
          // Only include rows whose computed category matches one of the active categories
          return activeCats.indexOf(String(cat)) !== -1;
        });
      }
    }
  } catch(e){ console.warn('Color filter failed', e); }
}

function toggleVehicleSort(column) {
  if (vehicleSortState.column === column) {
    vehicleSortState.dir *= -1;
  } else {
    vehicleSortState.column = column;
    vehicleSortState.dir = 1;
  }
  renderVehicleTable();
}

function ensureVehicleOverlay() {
  if (!vehicleOverlay)
    vehicleOverlay = document.getElementById("vehicleOverlay");
  if (!vehicleTableHead)
    vehicleTableHead = document.getElementById("vehicleTableHead");
  if (!vehicleTableBody)
    vehicleTableBody = document.getElementById("vehicleTableBody");
  if (!closeVehicleOverlayBtn)
    closeVehicleOverlayBtn = document.getElementById("closeVehicleOverlayBtn");
  var searchInput = document.getElementById("vehicleSearchInput");
  var showSearchInput = document.getElementById("vehicleShowSearchInput");
  var showResetBtn = document.getElementById("vehicleShowResetBtn");
  var resetBtn = document.getElementById("vehicleResetFilters");
  // Show/hide filter toolbar and mode-specific search depending on overlay mode
  try {
    var toolbar = vehicleOverlay ? vehicleOverlay.querySelector('.vehicle-overlay-toolbar') : null;
    if (toolbar) {
      toolbar.style.display = (vehicleOverlayMode === 'selectMin') ? '' : 'none';
    }
  if (showSearchInput) showSearchInput.style.display = (vehicleOverlayMode === 'show') ? '' : 'none';
  if (showResetBtn) showResetBtn.style.display = (vehicleOverlayMode === 'show') ? '' : 'none';
  } catch(e){}
  // Bind events only once using dataset flag
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.addEventListener("input", function () {
      renderVehicleTable();
    });
    searchInput.dataset.bound = "1";
  }
  if (showSearchInput && !showSearchInput.dataset.bound) {
    showSearchInput.addEventListener("input", function () {
      renderVehicleTable();
    });
    showSearchInput.dataset.bound = "1";
  }
  if (showResetBtn && !showResetBtn.dataset.bound) {
    showResetBtn.addEventListener('click', function(){
      try { if (showSearchInput) showSearchInput.value = ''; } catch(_){}
      // also clear any column filters/state used for show mode
      vehicleColumnFilters = {};
      vehicleSortState = { column: null, dir: 1 };
      renderVehicleTable();
    });
    showResetBtn.dataset.bound = '1';
  }
  if (resetBtn && !resetBtn.dataset.bound) {
    resetBtn.addEventListener("click", function () {
      var si = document.getElementById("vehicleSearchInput");
      if (si) si.value = "";
      vehicleSortState = { column: null, dir: 1 };
      vehicleColumnFilters = {};
      renderVehicleTable();
    });
    resetBtn.dataset.bound = "1";
  }
  // Bind Note input (persisted between overlay opens)
  try {
    var noteInput = document.getElementById('vehicleOverlayNoteInput');
    if (noteInput && !noteInput.dataset.bound) {
      try { var saved = localStorage.getItem('vehicleOverlayNote'); if (saved != null) noteInput.value = saved; } catch(e){}
      noteInput.addEventListener('change', function(){ try{ localStorage.setItem('vehicleOverlayNote', noteInput.value || ''); }catch(e){} });
      noteInput.addEventListener('blur', function(){ try{ localStorage.setItem('vehicleOverlayNote', noteInput.value || ''); }catch(e){} });
      noteInput.dataset.bound = '1';
    }
  } catch(e) { console.warn('Binding vehicleOverlayNoteInput failed', e); }
  if (closeVehicleOverlayBtn && !closeVehicleOverlayBtn.dataset.bound) {
    closeVehicleOverlayBtn.addEventListener("click", function () {
      if (vehicleOverlay) vehicleOverlay.style.display = "none";
    });
    closeVehicleOverlayBtn.dataset.bound = "1";
  }
}

  // Edit Vehicle button: send Vehicle Edit Distribution setup request
  var editVehicleBtn = document.getElementById('editVehicleBtn');
  if (editVehicleBtn && !editVehicleBtn.dataset.bound) {
    editVehicleBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align: middle; margin-right:4px;"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>Edit Vehicle';
    editVehicleBtn.addEventListener('click', function(){
      if (!authLoggedIn) { showRouteToast('⚠ Сначала выполните вход'); return; }
      var req = {
        name: 'Vehicle Edit Distribution',
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
      try {
        updateStatus('Отправка Vehicle Edit Distribution...', 'blue', 2000);
        sendRequest(req);
      } catch (e) { console.warn('send Vehicle Edit Distribution failed', e); }
      // Immediately switch overlay to edit mode and clear any Device List content
      try {
        vehicleOverlayMode = 'show';
        vehicleShowMode = 'edit';
        // show loading skeleton while waiting for edit distribution
        try { window._vehicleShowLoading = true; } catch(_){}
        // clear any previously shown Device List rows so user does not see stale data
        try {
          vehicleShowData = [];
          if (window._vehicleShowPending) delete window._vehicleShowPending;
          if (typeof tryApplyFleetMapping === 'function') tryApplyFleetMapping();
          renderVehicleTable();
          updateStatus('Открыт режим редактирования — ждём данных...', 'blue', 3000);
        } catch (ie) {}
        // ensure overlay DOM exists and open it
        try { toggleVehicleOverlay(); } catch (e2) { try { ensureVehicleOverlay(); if (vehicleOverlay) vehicleOverlay.style.display = 'block'; } catch (_) {} }
        // reset and focus the show search input (cleared)
        setTimeout(function () { try { var si = document.getElementById('vehicleShowSearchInput'); if (si) { si.value = ''; si.focus(); } } catch (e) { } }, 20);
      } catch (e) { console.warn('Failed to open vehicle overlay for edit', e); }
    });
    editVehicleBtn.dataset.bound = '1';
  }

    // Add Vehicle button — simplified: send a Device Edit rowadd with fixed auth and refresh overlay
    try{
      var vehicleAddBtn = document.getElementById('vehicleAddBtn');
      if(vehicleAddBtn && !vehicleAddBtn.dataset.bound){
        vehicleAddBtn.addEventListener('click', function(){
          try{
            // Send the exact request structure as requested (only auth fields differ)
            var req = { name: 'Device Edit', type: 'etbl', mid: 2, act: 'rowadd', usr: authUser, pwd: authPwd, uid: authUid, lang: 'ru' };
            try{ sendRequest(req); showRouteToast('Добавление устройства отправлено', 1200); } catch(e){ console.warn('sendRequest rowadd failed', e); showRouteToast('Ошибка отправки',2000); }
            // Refresh Vehicle Edit Distribution after a short delay so overlay updates
            setTimeout(function(){ try{ var refreshReq = { name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'setup', filter: [], nowait: true, waitfor: [], usr: authUser, pwd: authPwd, uid: authUid, lang: 'ru' }; sendRequest(refreshReq); }catch(_){ } }, 700);
          }catch(e){ console.warn('vehicleAddBtn click failed', e); }
        });
        vehicleAddBtn.dataset.bound = '1';
      }
    }catch(e){ console.warn('Binding Add Vehicle button failed', e); }

function toggleVehicleOverlay() {
  ensureVehicleOverlay();
  if (!vehicleOverlay) return;
  if (
    vehicleOverlay.style.display === "none" ||
    vehicleOverlay.style.display === ""
  ) {
    var si = document.getElementById("vehicleSearchInput");
    if (si) si.value = "";
    vehicleSortState = { column: null, dir: 1 };
    vehicleColumnFilters = {};
    renderVehicleTable();
    if (typeof initVehicleColorFilters === "function")
      initVehicleColorFilters();
    vehicleOverlay.style.display = "block";
    // After making overlay visible, always request fresh data depending on current overlay mode
    setTimeout(function () {
      try {
        var si2 = document.getElementById(vehicleOverlayMode === 'show' ? 'vehicleShowSearchInput' : 'vehicleSearchInput');
        if (si2) si2.focus();
      } catch(e){}
      try {
        // If user is not authenticated, show warning and skip requests
        if (!authLoggedIn) {
          updateStatus('\u26a0 \u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0432\u0445\u043e\u0434', 'orange', 2000);
          return;
        }
        if (vehicleOverlayMode === 'selectMin') {
          // Request minimal select list (vehicle)
          try { requestVehicleSelectMin && requestVehicleSelectMin(); } catch(e){ console.warn('requestVehicleSelectMin failed', e); }
        } else if (vehicleOverlayMode === 'show') {
          // For show mode, choose between edit distribution or normal device list
          if (typeof vehicleShowMode !== 'undefined' && vehicleShowMode === 'edit') {
            try {
              // show loading skeleton while fetching edit distribution
              try { window._vehicleShowLoading = true; } catch(_){}
              try { vehicleShowData = []; if (window._vehicleShowPending) delete window._vehicleShowPending; } catch(_){}
              updateStatus('\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 Vehicle Edit Distribution...', 'blue', 1500);
              var req = { name: 'Vehicle Edit Distribution', type: 'etbl', mid: 2, act: 'setup', filter: [], nowait: true, waitfor: [], usr: authUser, pwd: authPwd, uid: authUid, lang: 'ru' };
              try { sendRequest(req); } catch(e){ console.warn('sendRequest Vehicle Edit Distribution failed', e); }
            } catch(e){ console.warn('request Vehicle Edit Distribution on overlay open failed', e); }
          } else {
            try { requestVehicleShow && requestVehicleShow(); } catch(e){ console.warn('requestVehicleShow failed', e); }
          }
        }
      } catch(e){ console.warn('Overlay auto-refresh on open failed', e); }
    }, 0);
  } else {
    vehicleOverlay.style.display = "none";
  }
}

function sendAdditionalRequests(dateFrom, dateTo, deviceId) {
  if (!authLoggedIn) return;
  var requestAccumulation = {
    name: "Startstop accumulation",
    type: "etbl",
    mid: 5,
    act: "filter",
    filter: [
      { selectedpgdatefrom: [dateFrom] },
      { selectedvihicleid: [deviceId] },
      { selectedpgdateto: [dateTo] },
    ],
    usr: authUser,
    pwd: authPwd,
    uid: authUid,
    lang: "en",
  };
  var requestSum = {
    name: "Startstop Sum Result",
    type: "etbl",
    mid: 7,
    act: "filter",
    filter: [
      { selecteduid: [authUid] },
      { selectedvihicleid: [deviceId] },
      { selectedpgdatefrom: [dateFrom] },
      { selectedpgdateto: [dateTo] },
    ],
    usr: authUser,
    pwd: authPwd,
    uid: authUid,
    lang: "en",
  };
  sendRequest(requestAccumulation);
  sendRequest(requestSum);
}

function setDefaultDates() {
  var now = new Date();
  var todayEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59
  );
  var todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0
  );
  var pad = function (n) {
    return String(n).padStart(2, "0");
  };
  var toLocalDT = function (d) {
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  };
  dateToInput.value = toLocalDT(todayEnd);
  dateFromInput.value = toLocalDT(todayStart);
}

function toggleParkingMarkersVisibility() {
  if (!parkingMarkers || !parkingMarkers.length) return;
  if (parkingsVisible) {
    parkingMarkers.forEach(function (m) {
      m.addTo(trackLayerGroup);
    });
  } else {
    parkingMarkers.forEach(function (m) {
      trackLayerGroup.removeLayer(m);
    });
  }
}
