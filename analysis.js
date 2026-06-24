// Analysis mode: track segment analyzer ported from Android
(function() {
  'use strict';

  // --- Constants (non-configurable via UI) ---
  var LOW_SATELLITES_THRESHOLD = 6;
  var LOW_VOLTAGE_THRESHOLD = 12;
  var ALTITUDE_SPIKE_THRESHOLD = 500.0;
  var STATIC_MOVING_DISTANCE_THRESHOLD = 50.0;
  var MOVEMENT_DISTANCE_THRESHOLD = 20.0;

  // Dynamic thresholds from Track Raw anomaly settings (globals.js)
  function timeGapMinutes() {
    return (typeof ANOMALY_GAP_THRESHOLD_MS !== 'undefined' ? ANOMALY_GAP_THRESHOLD_MS : 600000) / 60000;
  }
  function speedSpikeThreshold() {
    return typeof ANOMALY_SPEED_THRESHOLD_KPH !== 'undefined' ? ANOMALY_SPEED_THRESHOLD_KPH : 200.0;
  }
  function positionJumpDistanceM() {
    return typeof ANOMALY_POSITION_JUMP_DISTANCE_M !== 'undefined' ? ANOMALY_POSITION_JUMP_DISTANCE_M : 1200.0;
  }
  function jumpSpeedThreshold() {
    return typeof ANOMALY_JUMP_SPEED_THRESHOLD_KPH !== 'undefined' ? ANOMALY_JUMP_SPEED_THRESHOLD_KPH : 50.0;
  }
  function realSpeedThreshold() {
    return typeof ANOMALY_REAL_SPEED_THRESHOLD_KPH !== 'undefined' ? ANOMALY_REAL_SPEED_THRESHOLD_KPH : 10.0;
  }

  var TRACK_ISSUE_META = {
    NONE: { displayName: 'Без ошибок', color: '#4CAF50', emoji: '✅' },
    LOW_SATELLITES: { displayName: 'Мало спутников', color: '#FFC107', emoji: '🟡' },
    LOW_VOLTAGE: { displayName: 'Низкое значение batvoltage', color: '#FF9800', emoji: '🟠' },
    MOVEMENT_WITHOUT_POWER: { displayName: 'Движение без питания', color: '#F44336', emoji: '🔴' },
    POSITION_JUMP: { displayName: 'Скачок позиции', color: '#E91E63', emoji: '🩷' },
    TIME_GAP: { displayName: 'Разрыв данных', color: '#9E9E9E', emoji: '⚫' },
    SPEED_SPIKE: { displayName: 'Скачок скорости', color: '#9C27B0', emoji: '🟣' },
    ALTITUDE_SPIKE: { displayName: 'Аномалия высоты', color: '#795548', emoji: '🟤' },
    STATIC_MOVING: { displayName: 'Статичное движение', color: '#607D8B', emoji: '🔵' }
  };

  var ISSUE_PRIORITY = [
    'MOVEMENT_WITHOUT_POWER',
    'LOW_VOLTAGE',
    'TIME_GAP',
    'SPEED_SPIKE',
    'POSITION_JUMP',
    'LOW_SATELLITES',
    'ALTITUDE_SPIKE',
    'STATIC_MOVING'
  ];

  // --- Helpers ---
  function _analysisEscapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\'/g,'&#39;');
  }

  function padTime(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // Используем проверенный parseTrackDate из anomalies.js (загружается раньше)

  function haversineDistance(lat1, lon1, lat2, lon2) {
    var earthRadiusM = 6371000.0;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLon = (lon2 - lon1) * toRad;
    var lat1Rad = lat1 * toRad;
    var lat2Rad = lat2 * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusM * c;
  }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    var arrA = Array.from(a);
    for (var i = 0; i < arrA.length; i++) {
      if (!b.has(arrA[i])) return false;
    }
    return true;
  }

  function formattedDuration(durationMs) {
    var totalMinutes = Math.floor(durationMs / 60000);
    var hours = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;
    return hours > 0 ? hours + ' ч ' + minutes + ' мин' : minutes + ' мин';
  }

  // --- Parsing ---
  function parseAnalysisTrackResponse(response) {
    if (!Array.isArray(response)) return [];
    var points = [];
    for (var i = 0; i < response.length; i++) {
      var p = response[i];
      // fallback имена полей как в drawRawDeviceTrack
      var lat = Number(p.latitude!=null?p.latitude:(p.LATITUDE!=null?p.LATITUDE:(p.lat!=null?p.lat:(p.Latitude!=null?p.Latitude:NaN))));
      var lon = Number(p.longitude!=null?p.longitude:(p.LONGITUDE!=null?p.LONGITUDE:(p.lon!=null?p.lon:(p.Longitude!=null?p.Longitude:(p.lng!=null?p.lng:NaN)))));
      if (!isFinite(lat) || !isFinite(lon)) continue;
      var wdateRaw = p.wdate || p.WDATE || p.date || p.Date || p.ts || '';
      var ts = parseTrackDate(wdateRaw);
      if (!ts || isNaN(ts.getTime())) continue;
      var speed = p.speed != null ? Number(p.speed) : 0;
      var satellites = p.satelites != null ? Number(p.satelites) : (p.satellites != null ? Number(p.satellites) : null);
      var ignition = p.ignition != null ? Boolean(p.ignition) : true;
      var isMoving = p.ismoves != null ? Boolean(p.ismoves) : false;
      // batvoltage оставляем как есть: для одних устройств это напряжение, для других процент
      var voltage = p.batvoltage != null ? Number(p.batvoltage) : null;
      var altitude = p.altitude != null ? Number(p.altitude) : null;
      points.push({
        latitude: lat,
        longitude: lon,
        timestamp: ts,
        speed: speed,
        satellites: satellites,
        ignition: ignition,
        isMoving: isMoving,
        voltage: voltage,
        altitude: altitude,
        wdate: wdateRaw
      });
    }
    return points;
  }

  // --- Detection ---
  function detectIssuesForPoint(current, prev) {
    var issues = new Set();
    if (current.satellites != null && current.satellites < LOW_SATELLITES_THRESHOLD) {
      issues.add('LOW_SATELLITES');
    }
    if (current.voltage != null && current.voltage < LOW_VOLTAGE_THRESHOLD) {
      issues.add('LOW_VOLTAGE');
    }
    if (prev !== null) {
      var timeDeltaMs = current.timestamp.getTime() - prev.timestamp.getTime();
      var timeDeltaMinutes = timeDeltaMs / 60000;
      if (timeDeltaMinutes > timeGapMinutes()) {
        issues.add('TIME_GAP');
      }
      var distanceMeters = haversineDistance(prev.latitude, prev.longitude, current.latitude, current.longitude);
      var ignition = current.ignition != null ? current.ignition : true;
      var isMoving = current.isMoving != null ? current.isMoving : false;
      if (!ignition && (isMoving || distanceMeters > MOVEMENT_DISTANCE_THRESHOLD)) {
        issues.add('MOVEMENT_WITHOUT_POWER');
      }
      var timeDeltaHours = timeDeltaMs / 3600000;
      if (timeDeltaHours > 0) {
        var calculatedSpeedKmh = (distanceMeters / 1000.0) / timeDeltaHours;
        if (calculatedSpeedKmh > speedSpikeThreshold()) {
          issues.add('SPEED_SPIKE');
        }
        // Position Jump (как в Raw Track): расчётная скорость > порога и заявленная < порога
        if (calculatedSpeedKmh > jumpSpeedThreshold() && current.speed < realSpeedThreshold()) {
          issues.add('POSITION_JUMP');
        }
      }
      // Distance-based Position Jump: расстояние > порога вне зависимости от скорости/времени
      if (distanceMeters >= positionJumpDistanceM()) {
        issues.add('POSITION_JUMP');
      }
      if (prev.altitude != null && current.altitude != null) {
        var altDelta = Math.abs(current.altitude - prev.altitude);
        if (altDelta > ALTITUDE_SPIKE_THRESHOLD) {
          issues.add('ALTITUDE_SPIKE');
        }
      }
      if (current.speed === 0.0 && distanceMeters > STATIC_MOVING_DISTANCE_THRESHOLD) {
        issues.add('STATIC_MOVING');
      }
    }
    return issues;
  }

  // --- Stats ---
  function average(arr) {
    if (!arr.length) return null;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  }

  function calculateStats(points) {
    var satellites = [];
    var voltages = [];
    var speeds = [];
    var totalDistance = 0.0;
    for (var i = 0; i < points.length; i++) {
      if (points[i].satellites != null) satellites.push(points[i].satellites);
      if (points[i].voltage != null) voltages.push(points[i].voltage);
      speeds.push(points[i].speed);
    }
    for (var i = 1; i < points.length; i++) {
      totalDistance += haversineDistance(points[i - 1].latitude, points[i - 1].longitude, points[i].latitude, points[i].longitude);
    }
    return {
      avgSatellites: satellites.length > 0 ? average(satellites) : null,
      minSatellites: satellites.length > 0 ? Math.min.apply(null, satellites) : null,
      maxSatellites: satellites.length > 0 ? Math.max.apply(null, satellites) : null,
      avgVoltage: voltages.length > 0 ? average(voltages) : null,
      minVoltage: voltages.length > 0 ? Math.min.apply(null, voltages) : null,
      maxVoltage: voltages.length > 0 ? Math.max.apply(null, voltages) : null,
      avgSpeed: speeds.length > 0 ? average(speeds) : null,
      maxSpeed: speeds.length > 0 ? Math.max.apply(null, speeds) : null,
      distanceTraveled: totalDistance
    };
  }

  // --- Segments ---
  function createSegment(points, issues) {
    var startTime = points[0].timestamp;
    var endTime = points[points.length - 1].timestamp;
    var durationMs = endTime.getTime() - startTime.getTime();
    return {
      startTime: startTime,
      endTime: endTime,
      issues: new Set(issues),
      points: points,
      duration: durationMs,
      count: points.length,
      stats: calculateStats(points)
    };
  }

  function groupIntoSegments(pointsWithIssues) {
    if (pointsWithIssues.length === 0) return [];
    var segments = [];
    var currentPoints = [pointsWithIssues[0].point];
    var currentIssues = new Set(pointsWithIssues[0].issues);
    for (var i = 1; i < pointsWithIssues.length; i++) {
      var point = pointsWithIssues[i].point;
      var issues = pointsWithIssues[i].issues;
      if (setsEqual(issues, currentIssues)) {
        currentPoints.push(point);
      } else {
        segments.push(createSegment(currentPoints, currentIssues));
        currentPoints = [point];
        currentIssues = new Set(issues);
      }
    }
    segments.push(createSegment(currentPoints, currentIssues));
    return segments;
  }

  function analyzeTrack(points) {
    if (!Array.isArray(points) || points.length === 0) return [];
    var sorted = points.slice().sort(function(a, b) {
      return a.timestamp.getTime() - b.timestamp.getTime();
    });
    var pointsWithIssues = [];
    for (var i = 0; i < sorted.length; i++) {
      var prev = i > 0 ? sorted[i - 1] : null;
      var issues = detectIssuesForPoint(sorted[i], prev);
      pointsWithIssues.push({ point: sorted[i], issues: issues });
    }
    return groupIntoSegments(pointsWithIssues);
  }

  // Compute distance from previous segment's last point to current segment's first point.
  // This gives the "jump" distance for anomaly segments that are isolated single-point segments.
  function computeBoundaryDistances(segments) {
    if (!segments || segments.length < 2) return;
    for (var i = 1; i < segments.length; i++) {
      var prev = segments[i - 1];
      var curr = segments[i];
      if (!prev.points || prev.points.length === 0 || !curr.points || curr.points.length === 0) continue;
      var lastPrev = prev.points[prev.points.length - 1];
      var firstCurr = curr.points[0];
      if (lastPrev == null || firstCurr == null) continue;
      curr.boundaryDistance = haversineDistance(lastPrev.latitude, lastPrev.longitude, firstCurr.latitude, firstCurr.longitude);
    }
  }

  // Effective distance to display: prefer intra-segment distance, fall back to boundary jump for anomalies.
  function getSegmentDistance(seg) {
    var traveled = (seg.stats && seg.stats.distanceTraveled) || 0;
    if (traveled > 0) return traveled;
    if (seg.boundaryDistance && seg.issues && seg.issues.size > 0) return seg.boundaryDistance;
    return 0;
  }

  // --- Presentation helpers ---
  function primaryIssue(issues) {
    if (!issues || issues.size === 0) return 'NONE';
    for (var i = 0; i < ISSUE_PRIORITY.length; i++) {
      if (issues.has(ISSUE_PRIORITY[i])) return ISSUE_PRIORITY[i];
    }
    return 'NONE';
  }

  function issuesLabel(segment) {
    if (!segment.issues || segment.issues.size === 0) return 'Без ошибок';
    var parts = [];
    var arr = Array.from(segment.issues);
    for (var i = 0; i < arr.length; i++) {
      var issue = arr[i];
      parts.push(singleIssueLabel(issue, segment));
    }
    return parts.join(' + ');
  }

  function singleIssueLabel(issue, segment) {
    var meta = TRACK_ISSUE_META[issue] || TRACK_ISSUE_META['NONE'];
    if (issue === 'LOW_VOLTAGE') {
      var voltage = segment && segment.stats && segment.stats.avgVoltage;
      return voltage != null ? 'Низкое значение batvoltage: ' + voltage.toFixed(1) : meta.displayName;
    }
    if (issue === 'POSITION_JUMP') {
      return 'Прыжок позиции';
    }
    if (issue === 'LOW_SATELLITES') {
      var sats = segment && segment.stats && segment.stats.avgSatellites;
      return sats != null ? 'Мало спутников ' + sats.toFixed(1) : meta.displayName;
    }
    return meta.displayName;
  }

  // --- Map highlight helpers ---
  function stopAnalysisBlink() {
    if (window._analysisBlinkTimer) {
      try { clearInterval(window._analysisBlinkTimer); } catch (e) {}
      window._analysisBlinkTimer = null;
    }
  }

  function fitMapToPoints(points, options) {
    if (!map || !points || points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 15, { animate: true });
      return;
    }
    var latlngs = [];
    for (var i = 0; i < points.length; i++) {
      latlngs.push([points[i].latitude, points[i].longitude]);
    }
    var opts = options || {};
    opts.padding = opts.padding || [40, 40];
    opts.maxZoom = opts.maxZoom || 16;
    opts.animate = opts.animate !== false;
    map.fitBounds(L.latLngBounds(latlngs), opts);
  }

  function getAnalysisLayerBaseWeight(layer) {
    var w = (typeof currentLineWidth === 'function' ? currentLineWidth() : 2);
    if (layer && layer._isAnalysisAnomaly) {
      return Math.max(w * 3 + 2, 3);
    }
    if (layer && layer._isAnalysisPolyline) {
      return w * 3;
    }
    return (layer && layer.options && layer.options.weight) || 3;
  }

  function collectAnomalyLayersForSegment(seg, issueFilter) {
    var layers = [];
    if (!seg || !seg.points || seg.points.length === 0) return layers;
    var filterMap = null;
    if (issueFilter) {
      filterMap = {};
      if (typeof issueFilter === 'string') {
        filterMap[issueFilter] = true;
      } else if (issueFilter.size !== undefined) {
        var vals = Array.from(issueFilter);
        for (var i = 0; i < vals.length; i++) filterMap[vals[i]] = true;
      } else {
        filterMap = issueFilter;
      }
    }
    for (var i = 0; i < seg.points.length; i++) {
      var pt = seg.points[i];
      if (!pt || !pt._anomalyLayers) continue;
      for (var j = 0; j < pt._anomalyLayers.length; j++) {
        var layer = pt._anomalyLayers[j];
        if (!layer) continue;
        if (!filterMap || filterMap[layer._anomalyType]) {
          if (layers.indexOf(layer) < 0) layers.push(layer);
        }
      }
    }
    return layers;
  }

  function blinkAnalysisLayers(layers) {
    stopAnalysisBlink();
    if (!layers || layers.length === 0) return;
    var highlightColor = '#FFD700';
    var highlightWeightDelta = 4;
    var intervalMs = 250;
    var cycles = 6;
    var validLayers = [];
    var originals = [];
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      if (!layer || typeof layer.setStyle !== 'function') continue;
      validLayers.push(layer);
      originals.push({
        color: layer.options.color,
        opacity: layer.options.opacity,
        dashArray: layer.options.dashArray
      });
      try { layer.bringToFront(); } catch (e) {}
    }
    if (validLayers.length === 0) return;

    var tick = 0;
    window._analysisBlinkTimer = setInterval(function() {
      var isHighlight = tick % 2 === 0;
      for (var i = 0; i < validLayers.length; i++) {
        var layer = validLayers[i];
        var orig = originals[i];
        var style = {};
        if (isHighlight) {
          style.color = highlightColor;
          style.opacity = 1;
          style.weight = getAnalysisLayerBaseWeight(layer) + highlightWeightDelta;
        } else {
          style.color = orig.color;
          style.opacity = orig.opacity != null ? orig.opacity : 0.9;
          style.weight = getAnalysisLayerBaseWeight(layer);
        }
        if (orig.dashArray != null) style.dashArray = orig.dashArray;
        try { layer.setStyle(style); } catch (e) {}
      }
      tick++;
      if (tick >= cycles) {
        clearInterval(window._analysisBlinkTimer);
        window._analysisBlinkTimer = null;
        for (var i = 0; i < validLayers.length; i++) {
          var layer = validLayers[i];
          var orig = originals[i];
          try {
            layer.setStyle({
              color: orig.color,
              weight: getAnalysisLayerBaseWeight(layer),
              opacity: orig.opacity != null ? orig.opacity : 0.9,
              dashArray: orig.dashArray
            });
          } catch (e) {}
        }
      }
    }, intervalMs);
  }

  // --- Map rendering ---
  function clearAnalysis() {
    stopAnalysisBlink();
    try {
      if (window.analysisLayerGroup) {
        window.analysisLayerGroup.clearLayers();
        if (trackLayerGroup && trackLayerGroup.hasLayer(window.analysisLayerGroup)) {
          trackLayerGroup.removeLayer(window.analysisLayerGroup);
        }
      }
    } catch (e) {}
    try {
      if (window.analysisAnomalyLayerGroup) {
        window.analysisAnomalyLayerGroup.clearLayers();
        if (trackLayerGroup && trackLayerGroup.hasLayer(window.analysisAnomalyLayerGroup)) {
          trackLayerGroup.removeLayer(window.analysisAnomalyLayerGroup);
        }
      }
    } catch (e) {}
    try {
      if (window.analysisSegments && window.analysisSegments.length) {
        for (var i = 0; i < window.analysisSegments.length; i++) {
          var seg = window.analysisSegments[i];
          if (!seg) continue;
          seg._polyline = null;
          if (seg.points) {
            for (var j = 0; j < seg.points.length; j++) {
              var pt = seg.points[j];
              if (pt) pt._anomalyLayers = null;
            }
          }
        }
      }
    } catch (e) {}
    try {
      if (window._analysisRawPoints && window._analysisRawPoints.length) {
        for (var i = 0; i < window._analysisRawPoints.length; i++) {
          var pt = window._analysisRawPoints[i];
          if (pt) pt._anomalyLayers = null;
        }
      }
    } catch (e) {}
    window.analysisSegments = [];
    window.analysisModeActive = false;
    var container = document.getElementById('analysisContainer');
    if (container) container.style.display = 'none';
    var tbody = document.getElementById('analysisTbody');
    if (tbody) tbody.innerHTML = '';
    var thead = document.getElementById('analysisThead');
    if (thead) thead.innerHTML = '';
    var summary = document.getElementById('analysisSummary');
    if (summary) summary.textContent = '';
    var toggle = document.getElementById('analysisViewToggle');
    if (toggle) toggle.style.display = 'none';
    window._analysisRawPoints = null;
  }

  function renderAnalysisSegments(segments) {
    stopAnalysisBlink();
    if (!trackLayerGroup) return;
    try {
      if (window.analysisLayerGroup) {
        window.analysisLayerGroup.clearLayers();
      } else {
        window.analysisLayerGroup = L.layerGroup();
      }
    } catch (e) {
      window.analysisLayerGroup = L.layerGroup();
    }
    try { trackLayerGroup.clearLayers(); } catch (e) {}
    try { if (directionDecorator) directionDecorator.clearLayers(); } catch (e) {}

    var allLatLngs = [];
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var latlngs = [];
      for (var j = 0; j < seg.points.length; j++) {
        latlngs.push([seg.points[j].latitude, seg.points[j].longitude]);
        allLatLngs.push([seg.points[j].latitude, seg.points[j].longitude]);
      }
      var pIssue = primaryIssue(seg.issues);
      var color = TRACK_ISSUE_META[pIssue].color;
      var lineW = (typeof currentLineWidth === 'function' ? currentLineWidth() : 2) * 3;
      var poly = L.polyline(latlngs, { color: color, weight: lineW, opacity: 0.9 }).addTo(window.analysisLayerGroup);
      poly._isAnalysisPolyline = true;
      poly._analysisSegment = seg;
      seg._polyline = poly;
      poly.on('click', function(e) {
        if (routeModeActive) {
          if (e && e.latlng && typeof onRouteMapClick === 'function') onRouteMapClick({ latlng: e.latlng });
          if (e && e.originalEvent && e.originalEvent.stopPropagation) e.originalEvent.stopPropagation();
          return;
        }
        showSegmentDetails(e.target._analysisSegment);
      });
    }
    trackLayerGroup.addLayer(window.analysisLayerGroup);

    if (segments.length > 0 && segments[0].points.length > 0) {
      var first = segments[0].points[0];
      var lastSeg = segments[segments.length - 1];
      var last = lastSeg.points[lastSeg.points.length - 1];
      L.marker([first.latitude, first.longitude], { icon: startIcon }).addTo(window.analysisLayerGroup).bindPopup('<b>Старт</b><br>' + (first.wdate || ''));
      L.marker([last.latitude, last.longitude], { icon: endIcon }).addTo(window.analysisLayerGroup).bindPopup('<b>Финиш</b><br>' + (last.wdate || ''));
    }
    if (allLatLngs.length > 0 && map) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [20, 20] });
    }
  }

  // --- Anomaly overlay rendering (raw points, across segment boundaries) ---
  function renderAnalysisAnomalies(points) {
    try {
      if (window.analysisAnomalyLayerGroup) {
        window.analysisAnomalyLayerGroup.clearLayers();
      } else {
        window.analysisAnomalyLayerGroup = L.layerGroup();
      }
      if (!points || points.length < 2) return;

      // Sort by timestamp to ensure correct prev/curr order in popup
      var sorted = points.slice().sort(function(a, b) {
        return a.timestamp.getTime() - b.timestamp.getTime();
      });

      for (var pi = 1; pi < sorted.length; pi++) {
        var prev = sorted[pi - 1];
        var curr = sorted[pi];
        if (!prev || !curr) continue;
        if (!prev.timestamp || !curr.timestamp) continue;
        var timeDeltaMs = curr.timestamp.getTime() - prev.timestamp.getTime();
        var timeDeltaMinutes = timeDeltaMs / 60000;
        var distanceMeters = haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
        var timeDeltaHours = timeDeltaMs / 3600000;
        var calculatedSpeedKmh = timeDeltaHours > 0 ? (distanceMeters / 1000.0) / timeDeltaHours : 0;

        var anomalyType = null;
        if (timeDeltaMinutes > timeGapMinutes()) {
          anomalyType = 'TIME_GAP';
        } else if (calculatedSpeedKmh > speedSpikeThreshold()) {
          anomalyType = 'SPEED_SPIKE';
        } else if (distanceMeters >= positionJumpDistanceM()) {
          anomalyType = 'POSITION_JUMP';
        } else if (calculatedSpeedKmh > jumpSpeedThreshold() && curr.speed < realSpeedThreshold()) {
          anomalyType = 'POSITION_JUMP';
        }

        if (anomalyType) {
          var style = { color: '#ff4136', weight: 4, opacity: 0.95 };
          if (anomalyType === 'TIME_GAP') {
            style.dashArray = '8,6';
          } else if (anomalyType === 'POSITION_JUMP') {
            style.dashArray = '10,5';
          }
          var popupHtml = '<b>Аномалия: ' + anomalyType + '</b><br>От: ' + (prev.wdate || '') + '<br>До: ' + (curr.wdate || '');
          popupHtml += '<br>Расстояние: ' + (distanceMeters / 1000).toFixed(2) + ' км';
          popupHtml += '<br>Скорость: ' + calculatedSpeedKmh.toFixed(2) + ' км/ч';
          var aLineW = (typeof currentLineWidth === 'function' ? currentLineWidth() : 2) * 3;
          style.weight = Math.max(aLineW + 2, 3);
          var aPoly = L.polyline([[prev.latitude, prev.longitude], [curr.latitude, curr.longitude]], style)
            .bindPopup(popupHtml)
            .addTo(window.analysisAnomalyLayerGroup);
          aPoly._isAnalysisAnomaly = true;
          aPoly._anomalyType = anomalyType;
          if (!curr._anomalyLayers) curr._anomalyLayers = [];
          curr._anomalyLayers.push(aPoly);
        }
      }
      trackLayerGroup.addLayer(window.analysisAnomalyLayerGroup);
    } catch (e) {
      console.warn('Analysis anomaly overlay render failed', e);
    }
  }

  // --- Collapse consecutive segments with same primary issue ---
  function collapseAnalysisSegments(segments) {
    if (!segments || segments.length === 0) return [];
    var collapsed = [];
    var current = null;
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var pIssue = primaryIssue(seg.issues);
      if (!current) {
        current = {
          startTime: seg.startTime,
          endTime: seg.endTime,
          issues: new Set(seg.issues),
          points: seg.points ? seg.points.slice() : [],
          sourceSegments: [seg],
          count: seg.count || 0,
          distance: seg.distance || 0,
          stats: {
            avgSpeed: (seg.stats && seg.stats.avgSpeed) || 0,
            avgVoltage: (seg.stats && seg.stats.avgVoltage) || 0,
            avgSatellites: (seg.stats && seg.stats.avgSatellites) || 0,
            distanceTraveled: (seg.stats && seg.stats.distanceTraveled) || 0
          },
          _weightSpeed: ((seg.stats && seg.stats.avgSpeed) || 0) * (seg.count || 0),
          _weightVoltage: ((seg.stats && seg.stats.avgVoltage) || 0) * (seg.count || 0),
          _weightSats: ((seg.stats && seg.stats.avgSatellites) || 0) * (seg.count || 0),
          _primaryIssue: pIssue
        };
      } else if (current._primaryIssue === pIssue) {
        // Same primary issue: merge
        current.endTime = seg.endTime;
        current.count += (seg.count || 0);
        current.distance += getSegmentDistance(seg);
        current.sourceSegments.push(seg);
        if (seg.points && seg.points.length > 0) {
          current.points = current.points.concat(seg.points);
        }
        // Union of issues
        var it = seg.issues.values();
        var iv = it.next();
        while (!iv.done) {
          current.issues.add(iv.value);
          iv = it.next();
        }
        current._weightSpeed += ((seg.stats && seg.stats.avgSpeed) || 0) * (seg.count || 0);
        current._weightVoltage += ((seg.stats && seg.stats.avgVoltage) || 0) * (seg.count || 0);
        current._weightSats += ((seg.stats && seg.stats.avgSatellites) || 0) * (seg.count || 0);
      } else {
        // Different primary issue: finalize current and start new
        if (current.count > 0) {
          current.stats.avgSpeed = current._weightSpeed / current.count;
          current.stats.avgVoltage = current._weightVoltage / current.count;
          current.stats.avgSatellites = current._weightSats / current.count;
        }
        current.stats.distanceTraveled = current.distance;
        current.duration = current.endTime.getTime() - current.startTime.getTime();
        delete current._weightSpeed;
        delete current._weightVoltage;
        delete current._weightSats;
        delete current._primaryIssue;
        collapsed.push(current);
        current = {
          startTime: seg.startTime,
          endTime: seg.endTime,
          issues: new Set(seg.issues),
          points: seg.points ? seg.points.slice() : [],
          sourceSegments: [seg],
          count: seg.count || 0,
          distance: getSegmentDistance(seg),
          stats: {
            avgSpeed: (seg.stats && seg.stats.avgSpeed) || 0,
            avgVoltage: (seg.stats && seg.stats.avgVoltage) || 0,
            avgSatellites: (seg.stats && seg.stats.avgSatellites) || 0,
            distanceTraveled: (seg.stats && seg.stats.distanceTraveled) || 0
          },
          _weightSpeed: ((seg.stats && seg.stats.avgSpeed) || 0) * (seg.count || 0),
          _weightVoltage: ((seg.stats && seg.stats.avgVoltage) || 0) * (seg.count || 0),
          _weightSats: ((seg.stats && seg.stats.avgSatellites) || 0) * (seg.count || 0),
          _primaryIssue: pIssue
        };
      }
    }
    if (current) {
      if (current.count > 0) {
        current.stats.avgSpeed = current._weightSpeed / current.count;
        current.stats.avgVoltage = current._weightVoltage / current.count;
        current.stats.avgSatellites = current._weightSats / current.count;
      }
      current.stats.distanceTraveled = current.distance;
      current.duration = current.endTime.getTime() - current.startTime.getTime();
      delete current._weightSpeed;
      delete current._weightVoltage;
      delete current._weightSats;
      delete current._primaryIssue;
      collapsed.push(current);
    }
    return collapsed;
  }

  // --- Summary table rendering (group by primary issue) ---
  function renderAnalysisSummaryTable(segments) {
    var container = document.getElementById('analysisContainer');
    var thead = document.getElementById('analysisThead');
    var tbody = document.getElementById('analysisTbody');
    var summary = document.getElementById('analysisSummary');
    if (!container || !thead || !tbody) return;
    if (!segments || segments.length === 0) {
      container.style.display = 'none';
      return;
    }

    // Group by every individual issue so each anomaly type is represented
    var groups = {};
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var issueList = (seg.issues && seg.issues.size > 0) ? Array.from(seg.issues) : ['NONE'];
      for (var ii = 0; ii < issueList.length; ii++) {
        var issue = issueList[ii];
        if (!groups[issue]) {
          groups[issue] = {
            issue: issue,
            count: 0,
            totalPoints: 0,
            totalDistance: 0,
            totalDuration: 0,
            weightSpeed: 0,
            weightVoltage: 0,
            weightSats: 0,
            entries: []
          };
        }
        var g = groups[issue];
        g.count++;
        g.totalPoints += (seg.count || 0);
        g.totalDistance += getSegmentDistance(seg);
        g.totalDuration += (seg.duration || 0);
        g.weightSpeed += ((seg.stats && seg.stats.avgSpeed) || 0) * (seg.count || 0);
        g.weightVoltage += ((seg.stats && seg.stats.avgVoltage) || 0) * (seg.count || 0);
        g.weightSats += ((seg.stats && seg.stats.avgSatellites) || 0) * (seg.count || 0);
        g.entries.push(seg);
      }
    }

    // Convert to array and sort: problems first, then OK
    var rows = [];
    var keys = Object.keys(groups);
    for (var k = 0; k < keys.length; k++) {
      rows.push(groups[keys[k]]);
    }
    rows.sort(function(a, b) {
      if (a.issue === 'NONE' && b.issue !== 'NONE') return 1;
      if (a.issue !== 'NONE' && b.issue === 'NONE') return -1;
      return b.count - a.count;
    });

    if (window.analysisHideOk) {
      rows = rows.filter(function(r) { return r.issue !== 'NONE'; });
    }

    if (summary) {
      var problemRows = 0;
      for (var r = 0; r < rows.length; r++) {
        if (rows[r].issue !== 'NONE') problemRows++;
      }
      summary.innerHTML = '<span style="color:#4CAF50;">✅ ' + (groups['NONE'] ? groups['NONE'].count : 0) + ' норм.</span> &nbsp; <span style="color:#F44336;">⚠️ ' + problemRows + ' типів проблем</span>';
    }

    thead.innerHTML = '';
    var trHead = document.createElement('tr');
    var headers = [
      { key: 'color', label: '' },
      { key: 'issue', label: 'Проблема' },
      { key: 'entries', label: 'Вхождений' },
      { key: 'points', label: 'Точек' },
      { key: 'duration', label: 'Общ. длительность' },
      { key: 'avgSpeed', label: 'Сред. скор.' },
      { key: 'avgVoltage', label: 'Напряжение/Заряд' },
      { key: 'avgSats', label: 'Спутн.' },
      { key: 'distance', label: 'Расстояние, км' }
    ];
    for (var h = 0; h < headers.length; h++) {
      var th = document.createElement('th');
      th.textContent = headers[h].label;
      trHead.appendChild(th);
    }
    thead.appendChild(trHead);

    tbody.innerHTML = '';
    for (var i = 0; i < rows.length; i++) {
      var g = rows[i];
      var meta = TRACK_ISSUE_META[g.issue] || TRACK_ISSUE_META['NONE'];
      var avgSpeed = g.totalPoints > 0 ? g.weightSpeed / g.totalPoints : 0;
      var avgVoltage = g.totalPoints > 0 ? g.weightVoltage / g.totalPoints : 0;
      var avgSats = g.totalPoints > 0 ? g.weightSats / g.totalPoints : 0;

      var tr = document.createElement('tr');

      var tdColor = document.createElement('td');
      tdColor.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + meta.color + ';"></span>';
      tr.appendChild(tdColor);

      var tdIssue = document.createElement('td');
      tdIssue.textContent = meta.displayName;
      tr.appendChild(tdIssue);

      var tdEntries = document.createElement('td');
      tdEntries.textContent = g.count;
      tr.appendChild(tdEntries);

      var tdPoints = document.createElement('td');
      tdPoints.textContent = g.totalPoints;
      tr.appendChild(tdPoints);

      var tdDuration = document.createElement('td');
      tdDuration.textContent = formattedDuration(g.totalDuration);
      tr.appendChild(tdDuration);

      var tdSpeed = document.createElement('td');
      tdSpeed.textContent = avgSpeed.toFixed(1);
      tr.appendChild(tdSpeed);

      var tdVoltage = document.createElement('td');
      tdVoltage.textContent = avgVoltage.toFixed(1);
      tr.appendChild(tdVoltage);

      var tdSats = document.createElement('td');
      tdSats.textContent = avgSats.toFixed(1);
      tr.appendChild(tdSats);

      var tdDist = document.createElement('td');
      tdDist.textContent = (g.totalDistance / 1000).toFixed(2);
      tr.appendChild(tdDist);

      tr.style.cursor = 'pointer';
      (function(group) {
        tr.addEventListener('click', function() {
          var allPoints = [];
          var layers = [];
          var anomalyLayers = [];
          for (var k = 0; k < group.entries.length; k++) {
            var entry = group.entries[k];
            if (entry && entry.points) {
              for (var p = 0; p < entry.points.length; p++) allPoints.push(entry.points[p]);
            }
            if (entry && entry._polyline) layers.push(entry._polyline);
            var entryAnomalies = collectAnomalyLayersForSegment(entry, group.issue);
            for (var a = 0; a < entryAnomalies.length; a++) {
              if (anomalyLayers.indexOf(entryAnomalies[a]) < 0) anomalyLayers.push(entryAnomalies[a]);
            }
          }
          var allLayers = layers.concat(anomalyLayers);
          if (allPoints.length > 0) fitMapToPoints(allPoints, { padding: [50, 50], maxZoom: 15, animate: true });
          blinkAnalysisLayers(allLayers);
        });
      })(g);

      tbody.appendChild(tr);
    }

    container.style.display = 'block';
  }

  // --- Desktop table rendering ---
  function renderAnalysisTable(segments) {
    var container = document.getElementById('analysisContainer');
    var thead = document.getElementById('analysisThead');
    var tbody = document.getElementById('analysisTbody');
    var summary = document.getElementById('analysisSummary');
    if (!container || !thead || !tbody) return;
    if (!segments || segments.length === 0) {
      container.style.display = 'none';
      return;
    }

    // Toggle visibility
    var toggle = document.getElementById('analysisViewToggle');
    if (toggle) toggle.style.display = 'block';

    var mode = window.analysisViewMode || 'chrono';
    window.analysisViewMode = mode;
    var btnChrono = document.getElementById('analysisViewChrono');
    var btnSummary = document.getElementById('analysisViewSummary');
    var btnHideOk = document.getElementById('analysisHideOk');
    if (btnChrono) btnChrono.className = 'btn btn-small' + (mode === 'chrono' ? ' active' : '');
    if (btnSummary) btnSummary.className = 'btn btn-small' + (mode === 'summary' ? ' active' : '');
    if (btnHideOk) {
      var hideOk = window.analysisHideOk !== false;
      window.analysisHideOk = hideOk;
      btnHideOk.className = 'btn btn-small' + (hideOk ? ' active' : '');
      btnHideOk.textContent = hideOk ? 'Скрыть норму' : 'Показать норму';
    }
    if (mode === 'summary') {
      renderAnalysisSummaryTable(segments);
      return;
    }

    // Collapse consecutive segments with same primary issue for cleaner table
    var displaySegments = collapseAnalysisSegments(segments);
    if (window.analysisHideOk) {
      displaySegments = displaySegments.filter(function(seg) { return seg.issues.size > 0; });
    }

    var okCount = 0;
    var problemCount = 0;
    for (var i = 0; i < displaySegments.length; i++) {
      if (displaySegments[i].issues.size === 0) okCount++; else problemCount++;
    }
    if (summary) {
      summary.innerHTML = '<span style="color:#4CAF50;">✅ ' + okCount + ' без ошибок</span> &nbsp; <span style="color:#F44336;">⚠️ ' + problemCount + ' с проблемами</span>';
    }

    // Build header
    thead.innerHTML = '';
    var trHead = document.createElement('tr');
    var headers = [
      { key: 'color', label: '' },
      { key: 'time', label: 'Время' },
      { key: 'issues', label: 'Проблемы' },
      { key: 'duration', label: 'Длительность' },
      { key: 'count', label: 'Точек' },
      { key: 'avgSpeed', label: 'Сред. скор.' },
      { key: 'avgVoltage', label: 'Напряжение/Заряд' },
      { key: 'avgSats', label: 'Спутн.' },
      { key: 'distance', label: 'Расстояние, км' }
    ];
    for (var h = 0; h < headers.length; h++) {
      var th = document.createElement('th');
      th.textContent = headers[h].label;
      trHead.appendChild(th);
    }
    thead.appendChild(trHead);

    // Build rows: one row per individual issue so every anomaly is visible and clickable
    tbody.innerHTML = '';
    for (var i = 0; i < displaySegments.length; i++) {
      var seg = displaySegments[i];
      var issueList = (seg.issues && seg.issues.size > 0) ? Array.from(seg.issues) : ['NONE'];
      var st = seg.stats || {};
      var startStr = padTime(seg.startTime.getHours()) + ':' + padTime(seg.startTime.getMinutes()) + ':' + padTime(seg.startTime.getSeconds());
      var endStr = padTime(seg.endTime.getHours()) + ':' + padTime(seg.endTime.getMinutes()) + ':' + padTime(seg.endTime.getSeconds());
      var distVal = getSegmentDistance(seg);
      var hasMultipleIssues = seg.issues && seg.issues.size > 1;

      for (var ii = 0; ii < issueList.length; ii++) {
        var pIssue = issueList[ii];
        var meta = TRACK_ISSUE_META[pIssue] || TRACK_ISSUE_META['NONE'];
        var color = meta.color;

        var tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        if (hasMultipleIssues) {
          tr.title = 'Все проблемы сегмента: ' + issuesLabel(seg);
        }

        var tdColor = document.createElement('td');
        tdColor.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + color + ';"></span>';
        tr.appendChild(tdColor);

        var tdTime = document.createElement('td');
        tdTime.textContent = startStr + ' - ' + endStr;
        tr.appendChild(tdTime);

        var tdIssues = document.createElement('td');
        tdIssues.textContent = singleIssueLabel(pIssue, seg);
        tr.appendChild(tdIssues);

        var tdDuration = document.createElement('td');
        tdDuration.textContent = formattedDuration(seg.duration);
        tr.appendChild(tdDuration);

        var tdCount = document.createElement('td');
        tdCount.textContent = seg.count;
        tr.appendChild(tdCount);

        var tdSpeed = document.createElement('td');
        tdSpeed.textContent = st.avgSpeed != null ? st.avgSpeed.toFixed(1) : '';
        tr.appendChild(tdSpeed);

        var tdVoltage = document.createElement('td');
        tdVoltage.textContent = st.avgVoltage != null ? st.avgVoltage.toFixed(1) : '';
        tr.appendChild(tdVoltage);

        var tdSats = document.createElement('td');
        tdSats.textContent = st.avgSatellites != null ? st.avgSatellites.toFixed(1) : '';
        tr.appendChild(tdSats);

        var tdDist = document.createElement('td');
        tdDist.textContent = distVal > 0 ? (distVal / 1000).toFixed(2) : (st.distanceTraveled != null ? (st.distanceTraveled / 1000).toFixed(2) : '0.00');
        tr.appendChild(tdDist);

        (function(s, issue) {
          tr.addEventListener('click', function() {
            if (!s.points || s.points.length === 0 || !map) return;
            fitMapToPoints(s.points, { padding: [40, 40], maxZoom: 16, animate: true });
            var layers = [];
            var anomalyLayers = [];
            var sourceSegs = s.sourceSegments && s.sourceSegments.length > 0 ? s.sourceSegments : [s];
            for (var k = 0; k < sourceSegs.length; k++) {
              var src = sourceSegs[k];
              if (src && src._polyline) layers.push(src._polyline);
              var srcAnomalies = collectAnomalyLayersForSegment(src, issue);
              for (var a = 0; a < srcAnomalies.length; a++) {
                if (anomalyLayers.indexOf(srcAnomalies[a]) < 0) anomalyLayers.push(srcAnomalies[a]);
              }
            }
            var allLayers = layers.concat(anomalyLayers);
            blinkAnalysisLayers(allLayers);
          });
        })(seg, pIssue);

        tbody.appendChild(tr);
      }
    }

    container.style.display = 'block';
  }

  // --- Segment details modal ---
  function showSegmentDetails(segment) {
    if (!segment) return;
    var modal = document.getElementById('analysisSegmentModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'analysisSegmentModal';
      modal.className = 'modal';
      modal.innerHTML = '<div class="modal-content" style="max-width:480px;">' +
        '<span id="analysisSegmentModalClose" class="close-button">&times;</span>' +
        '<h2>Информация о сегменте</h2>' +
        '<div id="analysisSegmentModalBody"></div></div>';
      document.body.appendChild(modal);
      document.getElementById('analysisSegmentModalClose').addEventListener('click', function() {
        modal.style.display = 'none';
      });
      modal.addEventListener('click', function(e) {
        if (e.target === modal) modal.style.display = 'none';
      });
    }
    var body = document.getElementById('analysisSegmentModalBody');
    var startH = padTime(segment.startTime.getHours());
    var startM = padTime(segment.startTime.getMinutes());
    var startS = padTime(segment.startTime.getSeconds());
    var endH = padTime(segment.endTime.getHours());
    var endM = padTime(segment.endTime.getMinutes());
    var endS = padTime(segment.endTime.getSeconds());
    var html = '<p><b>Время:</b> ' + startH + ':' + startM + ':' + startS + ' - ' + endH + ':' + endM + ':' + endS + '</p>';
    html += '<p><b>Длительность:</b> ' + formattedDuration(segment.duration) + '</p>';
    html += '<p><b>Точек:</b> ' + segment.count + '</p>';
    html += '<p><b>Проблемы:</b> <strong>' + _analysisEscapeHtml(issuesLabel(segment)) + '</strong></p>';
    if (segment.stats) {
      var st = segment.stats;
      if (st.avgSpeed != null) html += '<p><b>Сред. скорость:</b> ' + st.avgSpeed.toFixed(1) + ' км/ч</p>';
      if (st.maxSpeed != null) html += '<p><b>Макс. скорость:</b> ' + st.maxSpeed.toFixed(1) + ' км/ч</p>';
      if (st.avgVoltage != null) html += '<p><b>Напруга/Заряд:</b> ' + st.avgVoltage.toFixed(1) + '</p>';
      if (st.avgSatellites != null) html += '<p><b>Сред. спутников:</b> ' + st.avgSatellites.toFixed(1) + '</p>';
      var distVal = getSegmentDistance(segment);
      if (distVal > 0) html += '<p><b>Расстояние:</b> ' + (distVal / 1000).toFixed(2) + ' км</p>';
    }
    body.innerHTML = html;
    modal.style.display = 'block';
  }

  // --- Public API ---
  window.clearAnalysis = clearAnalysis;
  window.showSegmentDetails = showSegmentDetails;
  window.renderAnalysisTable = renderAnalysisTable;
  window.renderAnalysisSegments = renderAnalysisSegments;
  window.analyzeTrack = analyzeTrack;
  window.parseAnalysisTrackResponse = parseAnalysisTrackResponse;

  // View mode toggle handlers
  function setAnalysisViewMode(mode) {
    window.analysisViewMode = mode;
    var btnChrono = document.getElementById('analysisViewChrono');
    var btnSummary = document.getElementById('analysisViewSummary');
    if (btnChrono) {
      btnChrono.className = 'btn btn-small' + (mode === 'chrono' ? ' active' : '');
    }
    if (btnSummary) {
      btnSummary.className = 'btn btn-small' + (mode === 'summary' ? ' active' : '');
    }
    if (window.analysisSegments && window.analysisSegments.length > 0) {
      renderAnalysisTable(window.analysisSegments);
    }
  }

  function setAnalysisHideOk(hide) {
    window.analysisHideOk = hide;
    var btn = document.getElementById('analysisHideOk');
    if (btn) {
      btn.className = 'btn btn-small' + (hide ? ' active' : '');
      btn.textContent = hide ? 'Скрыть норму' : 'Показать норму';
    }
    if (window.analysisSegments && window.analysisSegments.length > 0) {
      renderAnalysisTable(window.analysisSegments);
    }
  }

  (function attachToggleHandlers() {
    var btnChrono = document.getElementById('analysisViewChrono');
    var btnSummary = document.getElementById('analysisViewSummary');
    if (btnChrono) {
      btnChrono.addEventListener('click', function() { setAnalysisViewMode('chrono'); });
    }
    if (btnSummary) {
      btnSummary.addEventListener('click', function() { setAnalysisViewMode('summary'); });
    }
    var btnHideOk = document.getElementById('analysisHideOk');
    if (btnHideOk) {
      btnHideOk.addEventListener('click', function() { setAnalysisHideOk(!window.analysisHideOk); });
    }
  })();

  window.loadAnalysisTrack = function() {
    if (!authLoggedIn) {
      showRouteToast('⚠ Сначала выполните вход');
      return;
    }
    var deviceId = deviceIdInput.value;
    if (!deviceId) {
      showRouteToast('⚠ Выберите устройство');
      return;
    }
    window._trackData = [];
    try { if (mileageGapLayers && mileageGapLayers.length) { mileageGapLayers.forEach(function(g) { trackLayerGroup.removeLayer(g); }); mileageGapLayers = []; } } catch (e) {}
    try { if (typeof window.trackDeviceSwitch === 'function') window.trackDeviceSwitch(deviceId); } catch (e) {}

    // Use unified loader: Device Alarm + Device Log + Full Device Track, then run analysis
    if (typeof window.loadDeviceData === 'function') {
      window.loadDeviceData({ analysis: true });
    } else if (typeof window.sendDeviceLogRequests === 'function') {
      window._awaitingAnalysisTrack = true;
      window.sendDeviceLogRequests();
    } else {
      showRouteToast('⚠ Модуль загрузки не доступен');
    }
  };

  function runAnalysisFromRows(rows) {
    try {
      console.log('[Analysis] Raw rows received:', rows.length);
      var points = parseAnalysisTrackResponse(rows);
      console.log('[Analysis] Parsed points:', points.length);
      if (points.length === 0) {
        updateStatus('Analyze: нет данных', '#dc3545', 6000);
        clearAnalysis();
        return;
      }
      var segments = analyzeTrack(points);
      computeBoundaryDistances(segments);
      console.log('[Analysis] Segments:', segments.length);
      var issueCounts = {};
      for (var s = 0; s < segments.length; s++) {
        var arr = Array.from(segments[s].issues);
        for (var k = 0; k < arr.length; k++) {
          issueCounts[arr[k]] = (issueCounts[arr[k]] || 0) + 1;
        }
      }
      console.log('[Analysis] Issue counts:', issueCounts);
      window.analysisSegments = segments;
      window.analysisModeActive = true;
      window._analysisRawPoints = points;
      renderAnalysisSegments(segments);
      renderAnalysisAnomalies(points);
      renderAnalysisTable(segments);
      updateStatus('Analyze: ' + segments.length + ' сегментов', 'green', 6000);
    } catch (e) {
      console.warn('Analysis track handler error', e);
      updateStatus('Analyze: ошибка обработки', '#dc3545', 6000);
    }
  }

  // --- WebSocket handler hook ---
  window.__handleAnalysisTrackResponse = function(data) {
    if (!data || data.name !== 'Device Track') return false;
    if (!window._awaitingAnalysisTrack) return false;
    // Если этот же ответ обрабатывается загрузчиком Full Device Track,
    // не перехватываем его: пусть __handleFullTrackSetup сделает финализацию
    // (таблица, снятие спиннера), а затем сам запустит анализ.
    if (window._awaitingFullTrackSetup) return false;
    window._awaitingAnalysisTrack = false;
    try {
      if (data.res && data.res[0] && Array.isArray(data.res[0].f)) {
        runAnalysisFromRows(data.res[0].f);
      } else {
        updateStatus('Analyze: пустой ответ', '#dc3545', 6000);
        clearAnalysis();
      }
    } catch (e) {
      console.warn('Analysis track handler error', e);
      updateStatus('Analyze: ошибка обработки', '#dc3545', 6000);
    }
    return true;
  };

  window.runAnalysisFromRows = runAnalysisFromRows;
})();
