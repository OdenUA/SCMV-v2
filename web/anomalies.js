// ============================================================
// ANOMALIES.JS - Track anomaly detection and visualization
// ============================================================

// --- Utility functions ---

// Universal date parser (supports legacy and ISO formats)
function parseTrackDate(str) {
  if (!str) return new Date(NaN);
  if (typeof str !== 'string') return new Date(str);
  if (/^(\d{2})\.(\d{2})\.(\d{2})\s\d{2}:\d{2}:\d{2}$/.test(str)) return new Date('20' + str.replace(/(\d{2})\.(\d{2})\.(\d{2})\s/, '$3-$2-$1T'));
  if (/^(\d{2})\.(\d{2})\.(\d{4})\s\d{2}:\d{2}:\d{2}$/.test(str)) return new Date(str.replace(/(\d{2})\.(\d{2})\.(\d{4})\s/, '$3-$2-$1T'));
  // Server sends local time, not UTC - parse as local time without 'Z' suffix
  if (/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.test(str)) {
    var m = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)) return new Date(str);
  return new Date(str);
}

// Check if coordinates are out of bounds
function isOutOfBounds(lat, lon) {
  return (
    lat < BOUNDS.MIN_LAT ||
    lat > BOUNDS.MAX_LAT ||
    lon < BOUNDS.MIN_LON ||
    lon > BOUNDS.MAX_LON
  );
}

// Format date for anomaly table: DD.MM.YY HH:mm:ss
function formatAnomalyTime(dt) {
  var d = typeof dt === 'string' ? parseTrackDate(dt) : dt;
  if (!(d instanceof Date) || isNaN(d)) return '';
  var pad = function (n) { return n.toString().padStart(2, '0'); };
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + String(d.getFullYear()).slice(-2) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

// Polyline click handler (supports route mode)
function attachRouteAwareClick(poly) {
  if (!poly || !poly._dtPoints || !Array.isArray(poly._dtPoints)) return;
  poly.on('click', function (ev) {
    // If route mode is active, consume the click and convert it into a route point
    if (routeModeActive) {
      var ll = ev.latlng || (ev && ev.layer && ev.layer.getLatLng && ev.layer.getLatLng());
      if (ll && typeof onRouteMapClick === 'function') {
        try { onRouteMapClick({ latlng: ll }); } catch (_) { }
      }
      if (ev && ev.originalEvent && ev.originalEvent.stopPropagation) ev.originalEvent.stopPropagation();
      return;
    }
    var ll = ev.latlng; if (!ll) return;
    var pts = poly._dtPoints;
    var minD = Infinity, nearest = null;
    for (var j = 0; j < pts.length; j++) {
      var d = map.distance(ll, L.latLng(pts[j].lat, pts[j].lng));
      if (d < minD) { minD = d; nearest = pts[j]; if (d < 3) break; }
    }
    if (!nearest) return;
    if (window._trackNearestMarker) { trackLayerGroup.removeLayer(window._trackNearestMarker); }
    window._trackNearestMarker = L.circleMarker([nearest.lat, nearest.lng], { radius: 7, color: '#ff4136', weight: 2, fillColor: '#ff4136', fillOpacity: 0.9 }).addTo(trackLayerGroup);
    // Bind popup but honor route mode by delegating clicks
    try {
      var popupNode = document.createElement('div');
      popupNode.innerHTML = '<b>' + (nearest.wdate || '') + '</b>';
      if (typeof createTrackCutButton === 'function') {
        var cutBtn = createTrackCutButton(nearest.lat, nearest.lng, nearest.wdate);
        if (cutBtn) {
          cutBtn.classList.add('track-cut-popup-btn');
          popupNode.appendChild(cutBtn);
        }
      }
      window._trackNearestMarker.bindPopup(popupNode);
      window._trackNearestMarker.on('click', function (ev) {
        if (routeModeActive) {
          var ll = ev && ev.latlng ? ev.latlng : window._trackNearestMarker.getLatLng();
          if (ll && typeof onRouteMapClick === 'function') { onRouteMapClick({ latlng: ll }); }
          if (ev && ev.originalEvent && ev.originalEvent.stopPropagation) ev.originalEvent.stopPropagation();
        } else {
          try { window._trackNearestMarker.openPopup(); } catch (_) { }
        }
      });
      window._trackNearestMarker.openPopup();
    } catch (_) { try { window._trackNearestMarker.openPopup(); } catch (_) { } }
  });
}

// --- Add Out of Bounds anomaly ---
function addOutOfBoundsAnomaly(group, allPoints, anomalies) {
  var anomalyPoints = allPoints.filter(function (p) {
    var d = parseTrackDate(p.wdate);
    return d >= group.startTime && d <= group.endTime;
  });
  if (!anomalyPoints.length) return;
  var startIndex = allPoints.indexOf(anomalyPoints[0]);
  var visualPoints =
    startIndex > 0
      ? [allPoints[startIndex - 1]].concat(anomalyPoints)
      : anomalyPoints;
  var anomalyLatLngs = visualPoints.map(function (p) {
    return [p.latitude, p.longitude];
  });
  var poly = L.polyline(anomalyLatLngs, { color: "#800080", weight: 4 })
    .addTo(trackLayerGroup)
    .bindPopup(
      "<b>Аномалия: Вне границ</b><br>С: " +
      formatDate(group.startTime) +
      "<br>По: " +
      formatDate(group.endTime)
    );
  attachRouteAwareClick(poly);
  var dist = 0;
  for (var k = 1; k < anomalyLatLngs.length; k++) {
    dist += L.latLng(anomalyLatLngs[k - 1]).distanceTo(
      L.latLng(anomalyLatLngs[k])
    );
  }
  var durSec = (group.endTime - group.startTime) / 1000;
  var durDisplay = durSec >= 3600 ? (durSec / 3600).toFixed(2) + ' h' : durSec >= 60 ? (durSec / 60).toFixed(1) + ' m' : Math.round(durSec) + ' s';
  anomalies.push({
    "Start Time": formatAnomalyTime(group.startTime),
    "End Time": formatAnomalyTime(group.endTime),
    "Anomaly Type": "Out of Bounds",
    "Calculated Speed (km/h)": "N/A",
    "Reported Speed (km/h)": "N/A",
    "Duration": durDisplay,
    "Distance (km)": (dist / 1000).toFixed(2),
    layer: poly,
  });
}

// --- Detect anomalies in Raw Device Track ---
function detectRawTrackAnomalies(parsed) {
  window._rawTrackGapLayers = [];
  window._rawTrackSpikeLayers = [];
  window._rawTrackJumpLayers = [];

  for (var i = 1; i < parsed.length; i++) {
    var prev = parsed[i - 1], curr = parsed[i];
    var tPrev = parseTrackDate(prev.wdate), tCurr = parseTrackDate(curr.wdate);
    var dt = tCurr - tPrev;
    var dist = L.latLng(prev.lat, prev.lng).distanceTo(L.latLng(curr.lat, curr.lng));
    var speedKph = dt > 0 ? dist / 1000 / (dt / 3600000) : 0;

    // Time Gap
    if (dt > ANOMALY_RAW_GAP_THRESHOLD_MS) {
      var gapLine = L.polyline([[prev.lat, prev.lng], [curr.lat, curr.lng]], { color: '#ff4136', weight: 4, opacity: 0.95, dashArray: '8,6' }).addTo(trackLayerGroup)
        .bindPopup('<b>Разрыв</b><br>' + prev.wdate + ' → ' + curr.wdate + '<br>' + Math.round(dt / 60000) + ' мин');
      gapLine._gapInfo = { start: prev, end: curr, index: i - 1 };
      window._rawTrackGapLayers.push(gapLine);
    }

    // Speed Spike
    if (dt > 0 && speedKph > ANOMALY_RAW_SPEED_THRESHOLD_KPH) {
      var spikeLine = L.polyline([[prev.lat, prev.lng], [curr.lat, curr.lng]], { color: '#ffdc00', weight: 4, opacity: 0.95, dashArray: '6,4' }).addTo(trackLayerGroup)
        .bindPopup('<b>Speed Spike</b><br>' + prev.wdate + ' → ' + curr.wdate + '<br>' + speedKph.toFixed(2) + ' км/ч');
      spikeLine._spikeInfo = { start: prev, end: curr, index: i - 1, speed: speedKph };
      window._rawTrackSpikeLayers.push(spikeLine);
    }

    // Position Jump (distance > 1km between consecutive points)
    if (dist >= ANOMALY_POSITION_JUMP_DISTANCE_M) {
      var jumpLine = L.polyline([[prev.lat, prev.lng], [curr.lat, curr.lng]], { color: '#ff4136', weight: 4, opacity: 0.95, dashArray: '10,5' }).addTo(trackLayerGroup)
        .bindPopup('<b>Position Jump</b><br>' + prev.wdate + ' → ' + curr.wdate + '<br>Расстояние: ' + (dist / 1000).toFixed(2) + ' км');
      jumpLine._jumpInfo = { start: prev, end: curr, index: i - 1, distance: dist };
      window._rawTrackJumpLayers.push(jumpLine);
    }
  }
}

// --- Link anomaly indices for table highlighting ---
function linkAnomalyIndices(anomalies) {
  anomalies.forEach(function (anom) {
    // Time Gap highlight
    if (anom["Anomaly Type"] === "Time Gap" && anom["Start Time"] && anom["End Time"]) {
      anom._gapIndex = null;
      if (window._rawTrackGapLayers) {
        for (var i = 0; i < window._rawTrackGapLayers.length; i++) {
          var gap = window._rawTrackGapLayers[i];
          if (gap._gapInfo && gap._gapInfo.start.wdate === anom["Start Time"] && gap._gapInfo.end.wdate === anom["End Time"]) {
            anom._gapIndex = i;
            break;
          }
        }
      }
    }
    // Speed Spike highlight
    if (anom["Anomaly Type"] === "Speed Spike" && anom["Start Time"] && anom["End Time"]) {
      anom._spikeIndex = null;
      if (window._rawTrackSpikeLayers) {
        for (var i = 0; i < window._rawTrackSpikeLayers.length; i++) {
          var spike = window._rawTrackSpikeLayers[i];
          if (spike._spikeInfo && spike._spikeInfo.start.wdate === anom["Start Time"] && spike._spikeInfo.end.wdate === anom["End Time"]) {
            anom._spikeIndex = i;
            break;
          }
        }
      }
    }
    // Position Jump highlight
    if (anom["Anomaly Type"] === "Position Jump" && anom["Start Time"] && anom["End Time"]) {
      anom._jumpIndex = null;
      if (window._rawTrackJumpLayers) {
        for (var i = 0; i < window._rawTrackJumpLayers.length; i++) {
          var jump = window._rawTrackJumpLayers[i];
          if (jump._jumpInfo && jump._jumpInfo.start.wdate === anom["Start Time"] && jump._jumpInfo.end.wdate === anom["End Time"]) {
            anom._jumpIndex = i;
            break;
          }
        }
      }
    }
  });
  return anomalies;
}
