// anomalies_cleanup.js
(function() {
  'use strict';

  var cleanupInProgress = false;
  var cleanupData = {
    deviceIds: [],
    dates: [],
    candidates: [], // { deviceId, dateKey, dateFrom, dateTo }
    sql: [],
    pendingMileage: 0, 
    totalMileage: 0,
    startTime: 0,
    
    // For Track Phase
    totalTracks: 0,
    processedTracks: 0,
    
    currentCandidate: null,
    currentMileageDone: 0
  };

  // UI elements (updated from DOM inside)
  function getIds() {
    return {
      statusDiv: document.getElementById('reportStatus'),
      progressText: document.getElementById('reportProgress'),
      progressFill: document.getElementById('reportProgressFill')
    };
  }

  // Hook into global handlers (reuse original approach)
  var originalReportHandler = window.__handleReportResponse;
  window.__handleReportResponse = function(data) {
    if (cleanupInProgress && handleCleanupMileageResponse(data)) {
      return true;
    }
    if (originalReportHandler) return originalReportHandler(data);
    return false;
  };

  var originalTrackHandler = window.__handleFullTrackSetup;
  window.__handleFullTrackSetup = function(data) {
    if (cleanupInProgress && handleCleanupTrackResponse(data)) {
      return true;
    }
    if (originalTrackHandler) return originalTrackHandler(data);
    return false;
  };

  function startCleanupProcess() {
    if (cleanupInProgress) {
      showRouteToast('⚠ Процесс уже запущен...');
      return;
    }

    var deviceIdsText = document.getElementById('reportDeviceIds').value;
    var monthValue = document.getElementById('reportMonth').value;

    if (!deviceIdsText || !monthValue) {
      showRouteToast('⚠ Заполните ID устройств и месяц');
      return;
    }

    var deviceIds = parseDeviceIds(deviceIdsText);
    if (!deviceIds.length) {
      showRouteToast('⚠ Нет ID устройств');
      return;
    }

    // Initialize Progress UI
    var ui = getIds();
    if(ui.statusDiv) ui.statusDiv.style.display = 'block';
    
    var parts = monthValue.split('-');
    var year = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10);
    var dates = generateMonthDates(year, month);

    cleanupData = {
      deviceIds: deviceIds,
      dates: dates,
      candidates: [],
      sql: [],
      pendingMileage: 0,
      totalMileage: deviceIds.length * dates.length,
      currentMileageDone: 0, 
      
      startTime: Date.now(),
      
      // Queueing for Phase 1
      queue: [],
      activeRequests: 0,
      maxConcurrency: 10,
      
      // Phase 2
      totalTracks: 0,
      processedTracks: 0,
      currentCandidate: null
    };
    
    // Start Watchdog
    if (window._acWatchdog) clearInterval(window._acWatchdog);
    window._acWatchdog = setInterval(function() {
        if (!cleanupInProgress) {
             clearInterval(window._acWatchdog); 
             return;
        }
        var elapsed = ((Date.now() - cleanupData.startTime)/1000).toFixed(0);
        console.log('[AC Watchdog] ' + elapsed + 's | Phase 1: ' + cleanupData.currentMileageDone + '/' + cleanupData.totalMileage + ' (Pend: ' + cleanupData.pendingMileage + ', Active: ' + cleanupData.activeRequests + ', Queue: ' + cleanupData.queue.length + ') | Candidates: ' + cleanupData.candidates.length);
    }, 5000);
    
    cleanupInProgress = true;
    updateProgressUI('Шаг 1/2: Анализ пробегов (запросы)...', 0);

    // BATCH REQUEST for Mileage (Phase 1)
    deviceIds.forEach(function(did) {
      dates.forEach(function(dt) {
        // Queue instead of send immediately
        cleanupData.queue.push({did: did, dt: dt});
      });
    });
    
    processQueue();
  }
  
  function processQueue() {
      while (cleanupData.queue.length > 0 && cleanupData.activeRequests < cleanupData.maxConcurrency) {
          var task = cleanupData.queue.shift();
          cleanupData.activeRequests++;
          sendMileageRequest(task.did, task.dt);
      }
  }

  function parseDeviceIds(text) {
    return text.split(/[\s,;\t\n\r]+/).filter(function(s){ return s.trim().length > 0; });
  }

  function generateMonthDates(year, month) {
    var list = [];
    var d = new Date(year, month - 1, 1);
    while (d.getMonth() === month - 1) {
      list.push({
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        dateObj: new Date(d)
      });
      d.setDate(d.getDate() + 1);
    }
    return list;
  }

  function sendMileageRequest(deviceId, dateInfo) {
    var pad = function(n) { return String(n).padStart(2, '0'); };
    var dateFrom = dateInfo.year + '-' + pad(dateInfo.month) + '-' + pad(dateInfo.day) + ' 00:00:00';
    var dateTo = dateInfo.year + '-' + pad(dateInfo.month) + '-' + pad(dateInfo.day) + ' 23:59:59';
    var req = {
      name: 'Startstop Sum Result',
      type: 'etbl',
      mid: 6,
      act: 'filter',
      filter: [
        { selecteduid: [authUid] },
        { selectedvihicleid: [deviceId] },
        { selectedpgdatefrom: [dateFrom] },
        { selectedpgdateto: [dateTo] }
      ],
      usr: authUser,
      pwd: authPwd,
      uid: authUid,
      lang: 'en'
    };
    cleanupData.pendingMileage++;
    // console.log('[AC] Request Mileage:', deviceId, dateFrom);
    sendRequest(req);
  }

  function handleCleanupMileageResponse(data) {
    if (!data || data.name !== 'Startstop Sum Result') return false;
    
    // Extract ID/Date from filter to avoid mixups
    var deviceId = null, dateFrom = null;
    try {
        data.filter.forEach(function(f){
            if(f.selectedvihicleid) deviceId = f.selectedvihicleid[0];
            if(f.selectedpgdatefrom) dateFrom = f.selectedpgdatefrom[0];
        });
    } catch(e){ 
        console.warn('[AC] Filter parse error', e);
        return false; 
    }
    
    if(!deviceId || !dateFrom) {
        // console.warn('[AC] Missing deviceId or dateFrom in response', data);
        return false;
    }

    // Is it ours? (simple check)
    // If we are not running cleanup, we shouldn't steal responses, but the hook checks cleanupInProgress
    
    cleanupData.pendingMileage--;
    cleanupData.activeRequests--;
    cleanupData.currentMileageDone++;

    // Console log for debugging the stuck state
    if (cleanupData.currentMileageDone % 10 === 0 || cleanupData.pendingMileage < 5) {
        console.log('[AC] Mileage Progress:', cleanupData.currentMileageDone, '/', cleanupData.totalMileage, 'Pending:', cleanupData.pendingMileage, 'Active:', cleanupData.activeRequests);
    }
    
    processQueue(); // Trigger next batch
    
    // Parse
    var mileage = 0;
    if (data.res && data.res[0] && data.res[0].f && data.res[0].f[0]) {
      var val = data.res[0].f[0].dest; 
      if (val) {
        mileage = parseFloat(String(val).replace(',', '.'));
      }
    }

    if (mileage > 3000) {
      console.log('[AC] Found candidate > 3000:', deviceId, dateFrom, mileage);
      var dateKey = dateFrom.split(' ')[0];
      cleanupData.candidates.push({
        deviceId: deviceId,
        dateKey: dateKey,
        dateFrom: dateKey + ' 00:00:00',
        dateTo: dateKey + ' 23:59:59',
        mileage: mileage
      });
    }

    // Update Progress
    var pct = (cleanupData.currentMileageDone / cleanupData.totalMileage) * 100;
    updateProgressUI('Шаг 1/2: Анализ пробегов: ' + cleanupData.currentMileageDone + '/' + cleanupData.totalMileage, pct);

    checkMileageCompletion();
    return true; 
  }
  
  function updateProgressUI(text, percent) {
      var ui = getIds();
      if(ui.progressText) ui.progressText.textContent = text;
      if(ui.progressFill) ui.progressFill.style.width = percent + '%';
  }

  function checkMileageCompletion() {
    if (cleanupData.pendingMileage <= 0) {
      console.log('[AC] Phase 1 Complete. Pending:', cleanupData.pendingMileage, 'Total Requests:', cleanupData.totalMileage, 'Processed:', cleanupData.currentMileageDone);
      // Small delay to ensure any lagging UI updates finish
      setTimeout(startTrackAnalysisPhase, 500);
    } else if (cleanupData.currentMileageDone >= cleanupData.totalMileage) {
        // Fallback catch-all if pending counting drifted
        console.warn('[AC] Total processed matched total expected, forcing next phase. Pending was:', cleanupData.pendingMileage);
        setTimeout(startTrackAnalysisPhase, 500);
    }
  }

  function startTrackAnalysisPhase() {
    if (cleanupData.candidates.length === 0) {
      finishCleanupAndShowSql('Аномалий с пробегом > 3000 км не найдено.');
      return;
    }

    cleanupData.totalTracks = cleanupData.candidates.length;
    cleanupData.processedTracks = 0;
    
    updateProgressUI('Шаг 2/2: Загрузка треков (0/' + cleanupData.totalTracks + ')...', 0);
    
    // Start serial processing
    processNextTrackCandidate();
  }

  function processNextTrackCandidate() {
    if (cleanupData.candidates.length === 0) {
       finishCleanupAndShowSql();
       return;
    }

    var cand = cleanupData.candidates.shift();
    cleanupData.currentCandidate = cand;

    var dateFromIso = cand.dateFrom.replace(' ', 'T');
    var dateToIso = cand.dateTo.replace(' ', 'T');

    var req = {
       name:'Device Track', type:'etbl', mid:6, act:'setup',
       filter:[ 
         {selectedpgdateto:[dateToIso]}, 
         {selectedpgdatefrom:[dateFromIso]}, 
         {selecteddeviceid:[cand.deviceId]} 
       ],
       nowait:false, waitfor:['selectedpgdateto'], 
       usr:authUser, pwd:authPwd, uid:authUid, lang:'en'
    };

    // Update Text
    updateProgressUI('Шаг 2/2: Загрузка трека ID:' + cand.deviceId + ' (' + (cleanupData.processedTracks+1) + '/' + cleanupData.totalTracks + ')...', 
       (cleanupData.processedTracks / cleanupData.totalTracks * 100));

    sendRequest(req);
  }

  function handleCleanupTrackResponse(data) {
    if (!data || data.name !== 'Device Track') return false;
    
    // Assume it matches currentCandidate because we execute strictly serially
    if (!cleanupData.currentCandidate) return false;

    var rows = [];
    if (data.res && data.res[0] && data.res[0].f) {
      rows = data.res[0].f;
    }

    // Process rows
    generateSqlForRows(rows, cleanupData.currentCandidate.deviceId);
    
    cleanupData.processedTracks++;
    
    // Next
    processNextTrackCandidate();
    return true;
  }

  function generateSqlForRows(rows, deviceId) {
    var parseDate = function(str) {
      if (typeof window.parseTrackDate === 'function') return window.parseTrackDate(str);
      return new Date(str);
    };

    var anomalyGroups = [];
    var currentAnom = null;

    // Ensure sorted
    rows.sort(function(a,b){
      var da = a.wdate || a.WDATE || a.date;
      var db = b.wdate || b.WDATE || b.date;
      return parseDate(da) - parseDate(db);
    });

    for(var i=0; i<rows.length; i++) {
        var r = rows[i];
        var lat = Number(r.latitude!=null?r.latitude: (r.LATITUDE!=null?r.LATITUDE: r.lat!=null?r.lat: r.Latitude));
        var lon = Number(r.longitude!=null?r.longitude: (r.LONGITUDE!=null?r.LONGITUDE: r.lon!=null?r.lon: r.Longitude));
        var wdate = r.wdate || r.WDATE || r.date;
        var ts = parseDate(wdate).getTime();

        var isBad = false;
        // Check Out Of Bounds
        if (isNaN(lat) || isNaN(lon)) isBad = true; 
        else if (window.isOutOfBounds && window.isOutOfBounds(lat, lon)) isBad = true;

        if (isBad) {
            if (!currentAnom) {
                currentAnom = { start: ts, end: ts };
            } else {
                currentAnom.end = ts;
            }
        } else {
            if (currentAnom) {
                anomalyGroups.push(currentAnom);
                currentAnom = null;
            }
        }
    }
    if (currentAnom) anomalyGroups.push(currentAnom);

    var pad = function(n){ return n.toString().padStart(2,'0'); };
    var formatForSqlLocal = function(t){
      var d = new Date(t);
      return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    };

    anomalyGroups.forEach(function(g) {
        var startEx = g.start - 1000;
        var endEx = g.end + 1000;
        
        var current = new Date(startEx);
        var endDate = new Date(endEx);
        
        while(current < endDate){
            var dayEnd = new Date(current); 
            dayEnd.setHours(23,59,59,999);
            var segmentStart = current;
            var segmentEnd = new Date(Math.min(dayEnd.getTime(), endDate.getTime()));
            
            var sql = "delete from snsrmain where deviceid='" + deviceId + "' and wdate >= '" + formatForSqlLocal(segmentStart) + "' and wdate <= '" + formatForSqlLocal(segmentEnd) + "';";
            cleanupData.sql.push(sql);

            current = new Date(dayEnd.getTime() + 1);
        }
    });
  }

  function finishCleanupAndShowSql(msg) {
    cleanupInProgress = false;
    updateProgressUI('Готово!', 100);
    
    // Show SQL modal
    var modal = document.getElementById('sqlModal');
    var output = document.getElementById('sql-output');
    var close = document.querySelector('.close-button');
    
    if (modal && output) {
      if (cleanupData.sql.length === 0) {
        output.textContent = msg || '-- Аномалий не обнаружено';
      } else {
         var recalcs = generateRecalcSql(cleanupData.sql);
         output.textContent = cleanupData.sql.join('\n') + '\n\n' + recalcs.join('\n');
      }
      modal.style.display = 'block';
      if(close) close.onclick = function(){ modal.style.display = 'none'; };
      
      // Close Reports window to focus on result?
      var reportsOverlay = document.getElementById('reportsOverlay');
      if (reportsOverlay) reportsOverlay.style.display = 'none';
      
    } else {
      console.log('SQL Result:\n', cleanupData.sql.join('\n'));
      alert('SQL output -> console');
    }
  }

  function generateRecalcSql(statements) {
      var map = {};
      statements.forEach(function(s) {
        try {
         var mDid = s.match(/deviceid='([^']+)'/);
         var mWdate = s.match(/wdate >= '([^']+)'/);
         if (mDid && mWdate) {
           var did = mDid[1];
           var dateStr = mWdate[1].split(' ')[0]; // YYYY-MM-DD
           var key = did + '|' + dateStr;
           map[key] = { id: did, date: dateStr };
         }
        } catch(e) {}
      });
      var res = [];
      Object.keys(map).sort().forEach(function(k) {
        var o = map[k];
        // Use explicit SELECT, cast date to ::date and pass true flag
        res.push("SELECT recalcstartstop(" + o.id + ", '" + o.date + "'::date, true);");
      });
      return res;
  }

  // Run exposure
  window.runAnomalyCleanup = startCleanupProcess;

})();
