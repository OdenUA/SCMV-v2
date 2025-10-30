// Utility & helper functions
function normalizeDateKey(str) {
  if (!str || typeof str !== "string") return str;
  if (str.length >= 19) return str.slice(0, 19);
  return str;
}
function buildVehicleMeta(row) {
  if (!row) return null;
  var numberVal = row.number;
  if (numberVal == null) {
    var dynamicKey = Object.keys(row).find(function (k) {
      return /number/i.test(k);
    });
    if (dynamicKey) numberVal = row[dynamicKey];
  }
  return { id: row.id, fleet: row.fleet, number: numberVal || "" };
}
function parseRelativeDurationToMs(str) {
  if (!str || typeof str !== "string") return null;
  str = str.trim();
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(str)) {
    var parts = str.split(":").map(function (n) {
      return parseInt(n, 10);
    });
    if (parts.some(isNaN)) return null;
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  }
  var years = 0,
    months = 0,
    days = 0,
    h = 0,
    m = 0,
    s = 0;
  var y = str.match(/(\d+)\s*year/);
  if (y) years = parseInt(y[1], 10) || 0;
  var mo = str.match(/(\d+)\s*mon/);
  if (mo) months = parseInt(mo[1], 10) || 0;
  var d = str.match(/(\d+)\s*day/);
  if (d) days = parseInt(d[1], 10) || 0;
  var t = str.match(/(\d{1,2}):(\d{2}):(\d{2})$/);
  if (t) {
    h = parseInt(t[1], 10) || 0;
    m = parseInt(t[2], 10) || 0;
    s = parseInt(t[3], 10) || 0;
  }
  var totalDays = years * 365 + months * 30 + days;
  return (totalDays * 24 * 3600 + h * 3600 + m * 60 + s) * 1000;
}
function getRowAgeGrade(row, nowTs) {
  var ageMs = null;
  if (row) {
    if (row.fdate) {
      var dt = new Date(row.fdate);
      if (!isNaN(dt)) ageMs = nowTs - dt.getTime();
    }
    if (ageMs == null && row.sdate) {
      var rel = parseRelativeDurationToMs(row.sdate);
      if (rel != null) ageMs = rel;
    }
  }
  if (ageMs == null) return { ageMs: null, gradeColor: null };
  var d = 24 * 60 * 60 * 1000;
  var t1 = 5 * d,
    t2 = 30 * d,
    t3 = 180 * d,
    t4 = 365 * d;
  var color = null;
  var category = null;
  if (ageMs > t4) { color = "#facacaff"; category = ">365"; }
  else if (ageMs > t3) { color = "#fce3d3ff"; category = ">180"; }
  else if (ageMs > t2) { color = "#ffecc7ff"; category = ">30"; }
  else if (ageMs > t1) { color = "#fff7ecff"; category = ">5"; }
  else { color = "#ffffff"; category = "0"; }
  return { ageMs: ageMs, gradeColor: color, ageCategory: category };
}
function formatDate(date) {
  var d = new Date(date);
  var pad = function (n) {
    return n.toString().padStart(2, "0");
  };
  return (
    pad(d.getDate()) +
    "." +
    pad(d.getMonth() + 1) +
    "." +
    d.getFullYear().toString().slice(-2) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes()) +
    ":" +
    pad(d.getSeconds())
  );
}

// Generic table population (moved from legacy monolith). Shows all object keys except internal 'layer'.
function populateTable(tbody, thead, dataArray) {
  if (!tbody || !thead) {
    return;
  }
  thead.innerHTML = "";
  tbody.innerHTML = "";
  if (!Array.isArray(dataArray) || dataArray.length === 0) {
    tbody.innerHTML = '<tr><td colspan="100%">Пустой набор данных.</td></tr>';
    return;
  }
  var headers = Object.keys(dataArray[0]);
  // Add Actions column header for GPS anomalies
  var needsActions = dataArray.some(function(obj){ 
    var type = obj["Anomaly Type"];
    return type === "Out of Bounds" || type === "Distance Jump" || type === "Speed Spike"; 
  });
  var hr = document.createElement("tr");
  headers.forEach(function (h) {
    if (h === "layer") return;
    var th = document.createElement("th");
    th.textContent = h;
    hr.appendChild(th);
  });
  if (needsActions) {
    var thAction = document.createElement("th");
    thAction.textContent = "Actions";
    hr.appendChild(thAction);
  }
  thead.appendChild(hr);
  dataArray.forEach(function (obj, idx) {
    var tr = document.createElement("tr");
    headers.forEach(function (h) {
      if (h === "layer") return;
      var td = document.createElement("td");
      var v = obj[h];
      if (typeof v === "boolean") v = v ? "Yes" : "No";
      td.textContent = v;
      tr.appendChild(td);
    });
    // Add Actions cell with scissors button for GPS anomalies
    if (needsActions) {
      var tdAction = document.createElement("td");
      var anomType = obj["Anomaly Type"];
      if (anomType === "Out of Bounds" || anomType === "Distance Jump" || anomType === "Speed Spike") {
        var btnScissors = document.createElement("button");
        btnScissors.type = "button";
        btnScissors.className = "btn btn-link anomaly-scissors-btn";
        btnScissors.title = "Сформировать SQL для удаления";
        btnScissors.innerHTML = "✂️";
        btnScissors.addEventListener("click", function(e){
          e.stopPropagation();
          generateAnomalySql(obj);
        });
        tdAction.appendChild(btnScissors);
      }
      tr.appendChild(tdAction);
    }
    tr.addEventListener("click", function () {
      if (
        previouslySelectedLayer &&
        previouslySelectedLayer.options &&
        previouslySelectedLayer.options.originalStyle
      ) {
        previouslySelectedLayer.setStyle(
          previouslySelectedLayer.options.originalStyle
        );
      }
      var anomaly = dataArray[idx];
      if (anomaly && anomaly.layer) {
        if (!anomaly.layer.options.originalStyle) {
          anomaly.layer.options.originalStyle = {
            color: anomaly.layer.options.color,
            weight: anomaly.layer.options.weight,
          };
        }
        anomaly.layer.setStyle({
          color: "#007bff",
          weight: (anomaly.layer.options.weight || 3) + 3,
        });
        try {
          anomaly.layer.bringToFront();
        } catch (e) {}
        if (anomaly.layer.getBounds) {
          map.fitBounds(anomaly.layer.getBounds(), {
            padding: [50, 50],
            maxZoom: 16,
          });
        }
        previouslySelectedLayer = anomaly.layer;
      }
    });
    tbody.appendChild(tr);
  });
}

// Generate SQL for deleting GPS anomaly points
function generateAnomalySql(anomaly) {
  try {
    var startTime = anomaly["Start Time"];
    var endTime = anomaly["End Time"];
    if (!startTime || !endTime) {
      showRouteToast("⚠ Не удалось определить временной диапазон", 2200);
      return;
    }
    
    // Parse times in format DD.MM.YY HH:mm:ss
    function parseAnomalyTime(str) {
      if (!str) return null;
      var m = String(str).match(/^(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
      if (!m) return null;
      var dd = m[1], mm = m[2], yy = m[3], hh = m[4], mi = m[5], ss = m[6];
      var fullYear = '20' + yy;
      return new Date(fullYear, parseInt(mm,10)-1, parseInt(dd,10), parseInt(hh,10), parseInt(mi,10), parseInt(ss,10));
    }
    
    var startDate = parseAnomalyTime(startTime);
    var endDate = parseAnomalyTime(endTime);
    
    if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      showRouteToast("⚠ Ошибка парсинга времени", 2200);
      return;
    }
    
    // Expand range +/- 1 second
    startDate.setSeconds(startDate.getSeconds() - 1);
    endDate.setSeconds(endDate.getSeconds() + 1);
    
    var deviceId = (typeof deviceIdInput !== 'undefined' && deviceIdInput) ? (deviceIdInput.value || '') : '';
    if (!deviceId) {
      showRouteToast("⚠ Не определен ID устройства", 2200);
      return;
    }
    
    var pad = function(n) { return n.toString().padStart(2, '0'); };
    var formatDateTime = function(d) {
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    };
    
    var sqlCommands = '';
    sqlCommands += '-- Аномалия: ' + (anomaly["Anomaly Type"] || '') + '\n';
    sqlCommands += '-- От ' + formatDateTime(startDate) + ' до ' + formatDateTime(endDate) + '\n';
    
    var affectedDates = [];
    var current = new Date(startDate.getTime());
    
    while (current.getTime() <= endDate.getTime()) {
      var dayEnd = new Date(current.getTime());
      dayEnd.setHours(23, 59, 59, 999);
      var segmentEnd = new Date(Math.min(dayEnd.getTime(), endDate.getTime()));
      
      var segmentStartStr = buildLocalDateParam(formatDateTime(current), false);
      var segmentEndStr = buildLocalDateParam(formatDateTime(segmentEnd), true);
      
      sqlCommands += "DELETE FROM snsrmain WHERE deviceid='" + deviceId + "' AND wdate >= '" + segmentStartStr + "' AND wdate <= '" + segmentEndStr + "';\n";
      
      // Save date for recalcstartstop
      var dateStr = current.getFullYear() + '-' + pad(current.getMonth() + 1) + '-' + pad(current.getDate());
      affectedDates.push(dateStr);
      
      current = new Date(dayEnd.getTime() + 1);
    }
    
    // Add recalcstartstop calls for each affected date
    affectedDates.forEach(function(dateStr) {
      sqlCommands += "SELECT recalcstartstop(" + deviceId + ", '" + dateStr + "'::date, true);\n";
    });
    
    // Show SQL in modal
    if (typeof sqlModal !== 'undefined' && sqlModal) {
      sqlModal.style.display = 'block';
    }
    if (typeof sqlOutput !== 'undefined' && sqlOutput) {
      sqlOutput.textContent = sqlCommands;
    }
    
    showRouteToast('✂️ SQL для удаления аномалии готов', 2200);
  } catch (err) {
    console.warn('generateAnomalySql failed', err);
    showRouteToast('⚠ Ошибка генерации SQL', 2200);
  }
}

// Make polylines clickable in route mode & show nearest point popup for Device Track
function attachRouteAwareClick(layer) {
  if (!layer || !layer.on) return;
  layer.on("click", function (ev) {
    if (routeModeActive) {
      var ll = ev.latlng;
      if (ll && typeof onRouteMapClick === "function") {
        onRouteMapClick({ latlng: ll });
      }
      if (ev.originalEvent && ev.originalEvent.stopPropagation)
        ev.originalEvent.stopPropagation();
      return;
    }
    if (
      layer._dtPoints &&
      Array.isArray(layer._dtPoints) &&
      layer._dtPoints.length
    ) {
      var clickLL = ev.latlng;
      if (clickLL) {
        var nearest = null,
          minD = Infinity;
        layer._dtPoints.forEach(function (p) {
          var d = clickLL.distanceTo(L.latLng(p.lat, p.lng));
          if (d < minD) {
            minD = d;
            nearest = p;
          }
        });
        if (nearest) {
          if (!window._deviceTrackPointPopup) {
            window._deviceTrackPointPopup = L.popup({
              autoPan: true,
              closeButton: true,
            });
          }
          window._deviceTrackPointPopup
            .setLatLng([nearest.lat, nearest.lng])
            .setContent("<b>Время:</b> " + nearest.wdate)
            .openOn(map);
        }
      }
    } else if (layer.getPopup && layer.getPopup()) {
      try {
        layer.openPopup();
      } catch (e) {}
    }
  });
}
