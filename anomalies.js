// ============================================================
// ANOMALIES.JS - Track anomaly detection and visualization
// ============================================================

// --- Utility functions ---

var TRACK_DATE_PATTERNS = {
  shortDot: /^(\d{2})\.(\d{2})\.(\d{2})\s(\d{2}):(\d{2}):(\d{2})$/,
  fullDot: /^(\d{2})\.(\d{2})\.(\d{4})\s(\d{2}):(\d{2}):(\d{2})$/,
  localIso: /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/
};

var RAW_TRACK_ANOMALY_CONFIG = {
  'Time Gap': {
    layersKey: '_rawTrackGapLayers',
    infoKey: '_gapInfo',
    indexKey: '_gapIndex',
    popupTitle: 'Разрыв',
    style: { color: '#ff4136', weight: 4, opacity: 0.95, dashArray: '8,6' }
  },
  'Speed Spike': {
    layersKey: '_rawTrackSpikeLayers',
    infoKey: '_spikeInfo',
    indexKey: '_spikeIndex',
    popupTitle: 'Speed Spike',
    style: { color: '#ffdc00', weight: 4, opacity: 0.95, dashArray: '6,4' }
  },
  'Position Jump': {
    layersKey: '_rawTrackJumpLayers',
    infoKey: '_jumpInfo',
    indexKey: '_jumpIndex',
    popupTitle: 'Position Jump',
    style: { color: '#ff4136', weight: 4, opacity: 0.95, dashArray: '10,5' }
  }
};

function buildDateFromParts(year, month, day, hours, minutes, seconds) {
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds)
  );
}

function isValidTrackDate(date) {
  return date instanceof Date && !isNaN(date.getTime());
}

function formatTwoDigits(value) {
  return String(value).padStart(2, '0');
}

function formatDurationLabel(seconds) {
  if (seconds >= 3600) return (seconds / 3600).toFixed(2) + ' h';
  if (seconds >= 60) return (seconds / 60).toFixed(1) + ' m';
  return Math.round(seconds) + ' s';
}

function buildTrackMarkerPopup(point) {
  var popupNode = document.createElement('div');
  popupNode.innerHTML = '<b>' + (point.wdate || '') + '</b>';
  if (typeof createTrackCutButton === 'function') {
    var cutBtn = createTrackCutButton(point.lat, point.lng, point.wdate);
    if (cutBtn) {
      cutBtn.classList.add('track-cut-popup-btn');
      popupNode.appendChild(cutBtn);
    }
  }
  return popupNode;
}

function findNearestTrackPoint(points, latlng) {
  var minDistance = Infinity;
  var nearestPoint = null;
  for (var index = 0; index < points.length; index++) {
    var distance = map.distance(latlng, L.latLng(points[index].lat, points[index].lng));
    if (distance < minDistance) {
      minDistance = distance;
      nearestPoint = points[index];
      if (distance < 3) break;
    }
  }
  return nearestPoint;
}

function focusTrackNearestMarker(point) {
  if (window._trackNearestMarker) {
    trackLayerGroup.removeLayer(window._trackNearestMarker);
  }

  window._trackNearestMarker = L.circleMarker([point.lat, point.lng], {
    radius: 7,
    color: '#ff4136',
    weight: 2,
    fillColor: '#ff4136',
    fillOpacity: 0.9
  }).addTo(trackLayerGroup);

  try {
    window._trackNearestMarker.bindPopup(buildTrackMarkerPopup(point));
    window._trackNearestMarker.on('click', function (ev) {
      if (routeModeActive) {
        var ll = ev && ev.latlng ? ev.latlng : window._trackNearestMarker.getLatLng();
        if (ll && typeof onRouteMapClick === 'function') {
          onRouteMapClick({ latlng: ll });
        }
        if (ev && ev.originalEvent && ev.originalEvent.stopPropagation) {
          ev.originalEvent.stopPropagation();
        }
        return;
      }
      try {
        window._trackNearestMarker.openPopup();
      } catch (_) {}
    });
    window._trackNearestMarker.openPopup();
  } catch (_) {
    try {
      window._trackNearestMarker.openPopup();
    } catch (_2) {}
  }
}

function calculatePolylineDistance(latlngs) {
  var distance = 0;
  for (var index = 1; index < latlngs.length; index++) {
    distance += L.latLng(latlngs[index - 1]).distanceTo(L.latLng(latlngs[index]));
  }
  return distance;
}

function resetRawTrackAnomalyLayers() {
  window._rawTrackGapLayers = [];
  window._rawTrackSpikeLayers = [];
  window._rawTrackJumpLayers = [];
}

function addRawTrackAnomalyLayer(type, latlngs, popupHtml, info) {
  var config = RAW_TRACK_ANOMALY_CONFIG[type];
  if (!config) return null;
  var line = L.polyline(latlngs, config.style)
    .addTo(trackLayerGroup)
    .bindPopup(popupHtml);
  line[config.infoKey] = info;
  window[config.layersKey].push(line);
  return line;
}

function findMatchingRawLayerIndex(type, anomaly) {
  var config = RAW_TRACK_ANOMALY_CONFIG[type];
  var layers = config ? window[config.layersKey] : null;
  if (!config || !layers) return null;

  for (var index = 0; index < layers.length; index++) {
    var info = layers[index][config.infoKey];
    if (info && info.start.wdate === anomaly['Start Time'] && info.end.wdate === anomaly['End Time']) {
      return index;
    }
  }

  return null;
}

function buildRawTrackMetrics(prev, curr) {
  var prevTime = parseTrackDate(prev.wdate);
  var currTime = parseTrackDate(curr.wdate);
  var durationMs = currTime - prevTime;
  var distanceM = L.latLng(prev.lat, prev.lng).distanceTo(L.latLng(curr.lat, curr.lng));
  var speedKph = durationMs > 0 ? distanceM / 1000 / (durationMs / 3600000) : 0;

  return {
    prev: prev,
    curr: curr,
    durationMs: durationMs,
    distanceM: distanceM,
    speedKph: speedKph
  };
}

// Universal date parser (supports legacy and ISO formats)
function parseTrackDate(str) {
  if (!str) return new Date(NaN);
  if (typeof str !== 'string') return new Date(str);
  var match = str.match(TRACK_DATE_PATTERNS.shortDot);
  if (match) {
    return buildDateFromParts('20' + match[3], match[2], match[1], match[4], match[5], match[6]);
  }

  match = str.match(TRACK_DATE_PATTERNS.fullDot);
  if (match) {
    return buildDateFromParts(match[3], match[2], match[1], match[4], match[5], match[6]);
  }

  // Server sends local time, not UTC - parse as local time without 'Z' suffix
  match = str.match(TRACK_DATE_PATTERNS.localIso);
  if (match) {
    return buildDateFromParts(match[1], match[2], match[3], match[4], match[5], match[6]);
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
  if (!isValidTrackDate(d)) return '';
  return formatTwoDigits(d.getDate()) + '.' +
    formatTwoDigits(d.getMonth() + 1) + '.' +
    String(d.getFullYear()).slice(-2) + ' ' +
    formatTwoDigits(d.getHours()) + ':' +
    formatTwoDigits(d.getMinutes()) + ':' +
    formatTwoDigits(d.getSeconds());
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
    var ll = ev.latlng;
    if (!ll) return;

    var nearest = findNearestTrackPoint(poly._dtPoints, ll);
    if (!nearest) return;
    focusTrackNearestMarker(nearest);
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
  var dist = calculatePolylineDistance(anomalyLatLngs);
  var durSec = (group.endTime - group.startTime) / 1000;
  var durDisplay = formatDurationLabel(durSec);
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
  resetRawTrackAnomalyLayers();

  for (var i = 1; i < parsed.length; i++) {
    var metrics = buildRawTrackMetrics(parsed[i - 1], parsed[i]);
    var latlngs = [
      [metrics.prev.lat, metrics.prev.lng],
      [metrics.curr.lat, metrics.curr.lng]
    ];

    // Time Gap
    if (metrics.durationMs > ANOMALY_GAP_THRESHOLD_MS) {
      addRawTrackAnomalyLayer(
        'Time Gap',
        latlngs,
        '<b>Разрыв</b><br>' + metrics.prev.wdate + ' → ' + metrics.curr.wdate + '<br>' + Math.round(metrics.durationMs / 60000) + ' мин',
        { start: metrics.prev, end: metrics.curr, index: i - 1 }
      );
    }

    // Speed Spike
    if (metrics.durationMs > 0 && metrics.speedKph > ANOMALY_SPEED_THRESHOLD_KPH) {
      addRawTrackAnomalyLayer(
        'Speed Spike',
        latlngs,
        '<b>Speed Spike</b><br>' + metrics.prev.wdate + ' → ' + metrics.curr.wdate + '<br>' + metrics.speedKph.toFixed(2) + ' км/ч',
        { start: metrics.prev, end: metrics.curr, index: i - 1, speed: metrics.speedKph }
      );
    }

    // Position Jump (distance > 1km between consecutive points)
    if (metrics.distanceM >= ANOMALY_POSITION_JUMP_DISTANCE_M) {
      addRawTrackAnomalyLayer(
        'Position Jump',
        latlngs,
        '<b>Position Jump</b><br>' + metrics.prev.wdate + ' → ' + metrics.curr.wdate + '<br>Расстояние: ' + (metrics.distanceM / 1000).toFixed(2) + ' км',
        { start: metrics.prev, end: metrics.curr, index: i - 1, distance: metrics.distanceM }
      );
    }
  }
}

// --- Link anomaly indices for table highlighting ---
function linkAnomalyIndices(anomalies) {
  anomalies.forEach(function (anom) {
    var type = anom['Anomaly Type'];
    var config = RAW_TRACK_ANOMALY_CONFIG[type];
    if (!config || !anom['Start Time'] || !anom['End Time']) return;
    anom[config.indexKey] = findMatchingRawLayerIndex(type, anom);
  });
  return anomalies;
}
