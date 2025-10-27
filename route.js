// Route building logic
function showRouteToast(text, duration) {
  duration = duration || 3000;
  var div = document.createElement("div");
  div.className = "route-toast";
  div.textContent = text;
  document.body.appendChild(div);
  setTimeout(function () {
    div.remove();
  }, duration);
}
function toggleRouteMode() {
  if (!map) return;
  routeModeActive ? stopRouteMode() : startRouteMode();
}
function startRouteMode() {
  if (routeModeActive) return;
  clearRouteArtifacts();
  routeModeActive = true;
  routePointsManual = [];
  routeClickCount = 0;
  routeBuilt = false;
  updateRouteButton();
  map.getContainer().style.cursor = "crosshair";
  map.on("click", onRouteMapClick, true);
  // Prevent other popups from opening while in route mode
  try {
    if (!map._routeModePopupGuarded) {
      map.on('popupopen', function(e){
        // close any popup that tries to open during route mode
        if (routeModeActive && e && e.popup) {
          try { e.popup._close(); } catch(_) { try { map.closePopup(e.popup); } catch(_) {} }
          if (e && e.originalEvent && e.originalEvent.stopPropagation) e.originalEvent.stopPropagation();
        }
      }, true);
      map._routeModePopupGuarded = true;
    }
    // close any currently open popup to avoid accidental interaction
    if (routeModeActive) map.closePopup();
  } catch (_) {}
  // Unbind parking popups so they don't open during route mode; keep markers interactive so their click
  // handlers can still receive events and add route points.
  parkingMarkers.forEach(function (pm) {
    try {
      if (pm.getPopup()) {
        pm._storedPopupContent = pm.getPopup().getContent();
        pm.unbindPopup();
      }
      // intentionally keep pm._icon pointer events and leaflet-interactive class intact
    } catch (_) {}
  });
  document.body.classList.add("route-mode-active");
  showRouteToast("🎯 Кликните на карту для выбора начальной точки (1/25)");
}
function stopRouteMode(options) {
  var opts = options || {};
  var silent = !!opts.silent;
  routeModeActive = false;
  if (map) {
    map.getContainer().style.cursor = "";
    map.off("click", onRouteMapClick, true);
  }
  if (!routeBuilt) {
    clearRouteTempMarkers();
    if (routeManualPolyline) {
      trackLayerGroup.removeLayer(routeManualPolyline);
      routeManualPolyline = null;
    }
  }
  updateRouteButton();
  if (!silent) {
    showRouteToast("🛑 Режим маршрута выключен", 2000);
  }
  parkingMarkers.forEach(function (pm) {
    try {
      if (pm._storedPopupContent) {
        pm.bindPopup(pm._storedPopupContent);
        delete pm._storedPopupContent;
      }
      // icon state preserved; no pointer-events/class changes needed
    } catch (_) {}
  });
  document.body.classList.remove("route-mode-active");
  try { map.closePopup(); } catch(_) {}
}
function onRouteMapClick(e) {
  if (!routeModeActive) return;
  if (routeClickCount >= 25) return;
  var lat = e.latlng.lat,
    lng = e.latlng.lng;
  routePointsManual.push({ lat: lat, lng: lng });
  routeClickCount++;
  var number = routeClickCount;
  var m = L.marker([lat, lng], {
    interactive: false,
    keyboard: false,
    bubblingMouseEvents: false,
    icon: L.divIcon({
      className: "manual-route-point",
      html: '<div class="route-point">' + number + "</div>",
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    }),
  });
  m.addTo(trackLayerGroup);
  routeTempMarkers.push(m);
  if (routeClickCount === 1) {
    showRouteToast("📍 Точка 1 добавлена.");
  } else if (routeClickCount < 25) {
    showRouteToast(
      "📍 Точка " + routeClickCount + " добавлена (" + routeClickCount + "/25)."
    );
  } else {
    showRouteToast("📍 Достигнуто 25 точек. Строю маршрут...");
    buildGoogleMapsRouteManual();
    setTimeout(stopRouteMode, 1500);
  }
  updateRouteButton();
  updateResetButtonState();
}
function updateRouteButton() {
  if (routeControlRef) {
    var toggleEl = routeControlRef.querySelector(".rt-toggle");
    var resetEl = routeControlRef.querySelector(".rt-reset");
    if (toggleEl) {
      if (!routeModeActive) {
        toggleEl.style.background = "";
        toggleEl.style.color = "";
        toggleEl.title = "Режим построения маршрута";
      } else {
        toggleEl.style.background = "#198754";
        toggleEl.style.color = "#fff";
        toggleEl.title =
          routeClickCount < 2 ? "Выход из режима" : "Завершить и построить";
      }
    }
    if (resetEl) {
      resetEl.style.opacity = routePointsManual.length ? "1" : "0.4";
    }
  }
}
// Track-cut selection via popups (two clicks on scissors inside point popup)
function createTrackCutButton(lat, lng, wdate) {
  if (!wdate) return null;
  try {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-link track-cut-btn';
    btn.title = 'Запомнить точку для удаления диапазона';
    btn.innerHTML = '✂️';
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      handleTrackCutSelection({ point: { lat: lat, lng: lng, wdate: wdate }, button: btn });
    });
    return btn;
  } catch (err) {
    console.warn('createTrackCutButton failed', err);
    return null;
  }
}
function handleTrackCutSelection(selection) {
  var point = selection && (selection.point || selection);
  var button = selection && selection.button;
  if (!point || !point.wdate) {
    showRouteToast('Не удалось определить время точки', 2200);
    return;
  }
  if (trackCutFirstPoint && trackCutFirstButton && button === trackCutFirstButton) {
    try { trackCutFirstButton.classList.remove('track-cut-selected'); } catch(_){ }
    trackCutFirstPoint = null;
    trackCutFirstButton = null;
    showRouteToast('Выбор первой точки сброшен', 2000);
    return;
  }
  if (!trackCutFirstPoint) {
    trackCutFirstPoint = point;
    if (trackCutFirstButton && trackCutFirstButton !== button) {
      try { trackCutFirstButton.classList.remove('track-cut-selected'); } catch(_){ }
    }
    trackCutFirstButton = button || null;
    if (trackCutFirstButton) {
      try { trackCutFirstButton.classList.add('track-cut-selected'); } catch(_){ }
    }
    showRouteToast('Первая точка выбрана: ' + point.wdate, 2200);
    return;
  }
  var first = trackCutFirstPoint;
  var firstBtn = trackCutFirstButton;
  trackCutFirstPoint = null;
  trackCutFirstButton = null;
  if (firstBtn) {
    try { firstBtn.classList.remove('track-cut-selected'); } catch(_){ }
  }
  showTrackCutSql(first, point);
}
function showTrackCutSql(first, second) {
  var sqlText = buildTrackCutSql(first, second);
  if (!sqlText) {
    showRouteToast('Не удалось сформировать SQL', 2400);
    return;
  }
  try {
    if (sqlModal) sqlModal.style.display = 'block';
    if (sqlOutput) sqlOutput.textContent = sqlText;
  } catch (err) {
    console.warn('Не удалось открыть модальное окно SQL', err);
  }
  showRouteToast('SQL для удаления готов', 2200);
}
function buildTrackCutSql(first, second) {
  if (!first || !second) return '';
  var parse = (typeof parseTrackDate === 'function') ? parseTrackDate : function (s) { return new Date(s); };
  var parseLocalWdate = function (raw) {
    if (!raw) return new Date(NaN);
    var m = raw.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})[T\s]([0-9]{2}):([0-9]{2}):([0-9]{2})$/);
    if (m) {
      return new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6])
      );
    }
    return parse(raw);
  };
  var startDate = parseLocalWdate(first.wdate);
  var endDate = parseLocalWdate(second.wdate);
  if (!startDate || isNaN(startDate.getTime())) startDate = parse(first.wdate);
  if (!endDate || isNaN(endDate.getTime())) endDate = parse(second.wdate);
  if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    console.warn('track-cut: failed to parse dates', first, second);
    return '';
  }
  if (startDate.getTime() > endDate.getTime()) {
    var tmp = startDate;
    startDate = endDate;
    endDate = tmp;
    var tmpPoint = first;
    first = second;
    second = tmpPoint;
  }
  var pad = function (n) { return n.toString().padStart(2, '0'); };
  var formatDateTime = function (d) {
    return (
      d.getFullYear() +
      '-' + pad(d.getMonth() + 1) +
      '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) +
      ':' + pad(d.getMinutes()) +
      ':' + pad(d.getSeconds())
    );
  };
  var deviceId = (typeof deviceIdInput !== 'undefined' && deviceIdInput) ? (deviceIdInput.value || '') : '';
  var sqlCommands = '';
  sqlCommands += '-- От ' + (first.wdate || formatDateTime(startDate)) + ' до ' + (second.wdate || formatDateTime(endDate)) + '\n';
  var current = new Date(startDate.getTime());
  while (current.getTime() <= endDate.getTime()) {
    var dayEnd = new Date(current.getTime());
    dayEnd.setHours(23, 59, 59, 999);
    var segmentEnd = new Date(Math.min(dayEnd.getTime(), endDate.getTime()));
    var segmentStartStr = buildLocalDateParam(formatDateTime(current), false);
    var segmentEndStr = buildLocalDateParam(formatDateTime(segmentEnd), true);
    sqlCommands += "delete from snsrmain where deviceid='" + deviceId + "' and wdate >= '" + segmentStartStr + "' and wdate <= '" + segmentEndStr + "';\n";
    current = new Date(dayEnd.getTime() + 1);
  }
  return sqlCommands;
}
function updateResetButtonState() {
  if (!routeControlRef) return;
  var resetEl = routeControlRef.querySelector(".rt-reset");
  if (resetEl) {
    var enabled = Array.isArray(routePointsManual) && routePointsManual.length > 0;
    resetEl.style.opacity = enabled ? "1" : "0.4";
  }
}
// Reset manual route: clear markers, polylines and state
function resetManualRoute() {
  try {
    // Remove temp markers
    clearRouteTempMarkers();
    // Remove manual polyline if any
    if (routeManualPolyline) {
      try { trackLayerGroup.removeLayer(routeManualPolyline); } catch(_) {}
      routeManualPolyline = null;
    }
    // Remove road polyline if any
    if (routeRoadPolyline) {
      try { trackLayerGroup.removeLayer(routeRoadPolyline); } catch(_) {}
      routeRoadPolyline = null;
    }
    // Reset state
    routePointsManual = [];
    routeClickCount = 0;
    routeBuilt = false;
    routeDistanceKm = null;
    routeMapsUrl = null;
    if (manualRouteInfoDiv) manualRouteInfoDiv.style.display = 'none';
    updateRouteButton();
    updateResetButtonState();
    showRouteToast('♻️ Маршрут сброшен', 1400);
  } catch (err) { console.warn('resetManualRoute failed', err); }
}
function clearRouteTempMarkers() {
  routeTempMarkers.forEach(function (m) {
    trackLayerGroup.removeLayer(m);
  });
  routeTempMarkers = [];
}
function clearRouteArtifacts() {
  clearRouteTempMarkers();
  if (routeManualPolyline) {
    trackLayerGroup.removeLayer(routeManualPolyline);
    routeManualPolyline = null;
  }
  if (routeRoadPolyline) {
    trackLayerGroup.removeLayer(routeRoadPolyline);
    routeRoadPolyline = null;
  }
  routeDistanceKm = null;
  routeMapsUrl = null;
  if (manualRouteInfoDiv) {
    manualRouteInfoDiv.style.display = "none";
  }
  updateResetButtonState();
}
function buildGoogleMapsRouteManual() {
  if (routePointsManual.length < 2) {
    showRouteToast("❌ Нужно минимум 2 точки", 2500);
    return;
  }
  routeBuilt = true;
  buildRoadRoute().then(function (success) {
    if (!success) {
      showRouteToast("ℹ️ Не удалось получить маршрут по дорогам", 3000);
    }
  });
  var baseUrl = "https://www.google.com/maps/dir/";
  var waypoints = routePointsManual
    .map(function (p) {
      return p.lat + "," + p.lng;
    })
    .join("/");
  var centerLat =
    routePointsManual.reduce(function (s, p) {
      return s + p.lat;
    }, 0) / routePointsManual.length;
  var centerLng =
    routePointsManual.reduce(function (s, p) {
      return s + p.lng;
    }, 0) / routePointsManual.length;
  routeMapsUrl =
    baseUrl +
    waypoints +
    "/@" +
    centerLat +
    "," +
    centerLng +
    ",12z/data=!3m1!4b1!4m2!4m1!3e0";
  renderManualRouteInfo();
  showRouteToast("✅ Маршрут сформирован.", 2500);
}
function renderManualRouteInfo() {
  if (!manualRouteInfoDiv) return;
  if (!routeBuilt) {
    manualRouteInfoDiv.style.display = "none";
    return;
  }
  manualRouteInfoDiv.style.display = "block";
  var html = "<b>Маршрут:</b> " + routePointsManual.length + " точ.";
  if (routeDistanceKm) {
    html += " | Дистанция: " + routeDistanceKm.toFixed(2) + " км";
  } else {
    html += " | Дистанция: рассчитывается";
  }
  if (routeMapsUrl) {
    html +=
      ' | <a href="' +
      routeMapsUrl +
      '" target="_blank" rel="noopener">Google Maps</a>';
  }
  manualRouteInfoDiv.innerHTML = html;
}
function removeLastManualPoint() {
  if (!routeModeActive) return;
  if (routePointsManual.length === 0) return;
  if (routeBuilt) {
    showRouteToast("Маршрут уже построен. Сбросьте.", 2500);
    return;
  }
  routePointsManual.pop();
  routeClickCount = routePointsManual.length;
  var lastMarker = routeTempMarkers.pop();
  if (lastMarker) {
    trackLayerGroup.removeLayer(lastMarker);
  }
  routeTempMarkers.forEach(function (m, idx) {
    var num = idx + 1;
    m.setIcon(
      L.divIcon({
        className: "manual-route-point",
        html: '<div class="route-point">' + num + "</div>",
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      })
    );
  });
  updateRouteButton();
  updateResetButtonState();
  showRouteToast("⏪ Удалена последняя точка", 1200);
}
async function buildRoadRoute() {
  if (routePointsManual.length < 2) return false;
  var serviceUrl = "https://router.project-osrm.org/route/v1/driving";
  var totalDistance = 0;
  var combinedCoords = [];
  for (var i = 0; i < routePointsManual.length - 1; i++) {
    var a = routePointsManual[i];
    var b = routePointsManual[i + 1];
    var url =
      serviceUrl +
      "/" +
      a.lng +
      "," +
      a.lat +
      ";" +
      b.lng +
      "," +
      b.lat +
      "?overview=full&geometries=geojson";
    try {
      var res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      var json = await res.json();
      if (!json.routes || !json.routes[0]) throw new Error("No routes");
      var r = json.routes[0];
      totalDistance += r.distance;
      var coords = r.geometry.coordinates.map(function (c) {
        return [c[1], c[0]];
      });
      if (i === 0) combinedCoords = coords;
      else combinedCoords = combinedCoords.concat(coords.slice(1));
    } catch (err) {
      console.warn("OSRM segment failed", err);
      return false;
    }
  }
  routeDistanceKm = totalDistance / 1000;
  if (routeRoadPolyline) {
    trackLayerGroup.removeLayer(routeRoadPolyline);
  }
  routeRoadPolyline = L.polyline(combinedCoords, {
    color: "#0d6efd",
    weight: currentLineWidth() + 1,
  }).addTo(trackLayerGroup);
  routeRoadPolyline.bringToFront();
  map.fitBounds(routeRoadPolyline.getBounds(), { padding: [30, 30] });
  renderManualRouteInfo();
  return true;
}
