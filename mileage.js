// Mileage report & gaps
function processMileageReport(segments) {
  // Use global _mileageData if available
  if (Array.isArray(window._mileageData) && window._mileageData.length > 0) {
    segments = window._mileageData;
  }
  if (!segments.length) return;
  var allCoords = [];
  lastMileageSegments = segments;
  mileageGapLayers.forEach(function (l) {
    try {
      trackLayerGroup.removeLayer(l);
    } catch (_) {}
  });
  mileageGapLayers = [];
  // Снять старые стрелки отчёта (декораторы ссылаются на удаляемые линии)
  try { if (typeof unregisterSmartArrows === 'function') { unregisterSmartArrows('mileage'); unregisterSmartArrows('mileage-gap'); } } catch (_) {}
  segments.forEach(function (segment) {
    if (segment.coordinates && segment.coordinates.length) {
      var segmentCoords = segment.coordinates;
      allCoords = allCoords.concat(segmentCoords);
      try {
        var segColor = segment.ismoved === false ? "#888888" : "#000000";
        var segLine = L.polyline(segmentCoords, {
          color: segColor,
          weight: 3,
          opacity: 0.85,
        });
        var timeInfo = [];
        if (segment.fdate) timeInfo.push("Начало: " + segment.fdate);
        if (segment.tdate) timeInfo.push("Конец: " + segment.tdate);
        if (segment.period) timeInfo.push("Длительность: " + segment.period);
        if (segment.ismoved === false) timeInfo.push("Стоянка");
        var popupHtml = "<b>Сегмент</b><br>" + timeInfo.join("<br>");
        segLine.on("click", function (ev) {
          if (routeModeActive) {
            var ll =
              ev.latlng || (ev.target.getCenter && ev.target.getCenter());
            if (ll) onRouteMapClick({ latlng: ll });
            ev.originalEvent &&
              ev.originalEvent.stopPropagation &&
              ev.originalEvent.stopPropagation();
            return;
          }
          if (!window._segmentClickPopup) {
            window._segmentClickPopup = L.popup({
              autoPan: true,
              closeButton: true,
            });
          }
          window._segmentClickPopup
            .setLatLng(ev.latlng)
            .setContent(popupHtml)
            .openOn(map);
        });
        segLine.addTo(trackLayerGroup);
        // Стрелки направления через общий "умный" движок (map.js): интервал в метрах,
        // без стрелок на стоянках и GPS-шуме, пересчёт при зуме. Стоянки (ismoved === false)
        // стрелками не помечаются.
        segLine._ownDirectionArrows = true;
        if (segment.ismoved !== false) {
          try { registerSmartArrows('mileage', segLine, segColor); } catch (e) { console.warn('segment arrows fail', e); }
        }
      } catch (e) {
        console.warn("segment draw fail", e);
      }
      if (segment.ismoved === false) {
        var key = normalizeDateKey(segment.fdate);
        if (key && segment.coordinates.length) {
          if (!mileageStopCoords[key]) {
            var first = segment.coordinates[0];
            mileageStopCoords[key] = {
              coord: first.slice ? first : first,
              period: segment.period,
            };
          }
        }
      }
    }
  });
  if (allCoords.length > 1) {
    var fitLine = L.polyline(allCoords);
    map.fitBounds(fitLine.getBounds());
    L.marker(allCoords[0], { icon: startIcon })
      .addTo(trackLayerGroup)
      .bindPopup("<b>Старт</b>");
    L.marker(allCoords[allCoords.length - 1], { icon: endIcon })
      .addTo(trackLayerGroup)
      .bindPopup("<b>Финиш</b>");
  }
  drawMileageGaps();
  updateAllLineWidths();
  rebuildStopMarkers();
  renderStartstopStopsTable();
}
function drawMileageGaps() {
  if (!lastMileageSegments || lastMileageSegments.length < 2) return;
  try { if (typeof unregisterSmartArrows === 'function') unregisterSmartArrows('mileage-gap'); } catch (_) {}
  var moved = lastMileageSegments.filter(function (s) {
    return (
      Array.isArray(s.coordinates) &&
      s.coordinates.length &&
      s.ismoved !== false
    );
  });
  if (moved.length < 2) return;
  moved.sort(function (a, b) {
    if (a.fdate && b.fdate) return a.fdate.localeCompare(b.fdate);
    return 0;
  });
  for (var i = 0; i < moved.length - 1; i++) {
    var curr = moved[i];
    var next = moved[i + 1];
    var currEnd = curr.coordinates[curr.coordinates.length - 1];
    var nextStart = next.coordinates[0];
    if (!currEnd || !nextStart) continue;
    var dist = L.latLng(currEnd[0], currEnd[1]).distanceTo(
      L.latLng(nextStart[0], nextStart[1])
    );
    if (dist < 1) continue;
    var gapLine = L.polyline([currEnd, nextStart], {
      color: "#ff0000",
      dashArray: "4,6",
      weight: 3,
      opacity: 0.95,
    })
      .addTo(trackLayerGroup)
      .bindPopup(
        "<b>Пропуск</b><br>От: " +
          (curr.tdate || curr.fdate || "") +
          "<br>До: " +
          (next.fdate || "") +
          "<br>Дистанция: " +
          (dist / 1000).toFixed(3) +
          " км"
      );
    gapLine._ownDirectionArrows = true;
    try { registerSmartArrows('mileage-gap', gapLine, '#ff0000'); } catch (e) { console.warn('gap arrows fail', e); }
    mileageGapLayers.push(gapLine);
  }
}
