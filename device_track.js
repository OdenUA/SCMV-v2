// Device Track & anomaly processing
// Functions parseTrackDate, isOutOfBounds, attachRouteAwareClick, addOutOfBoundsAnomaly, 
// formatAnomalyTime, detectRawTrackAnomalies, linkAnomalyIndices - moved to anomalies.js

// --- Adaptive full-track chunking: server caps responses at 14000 rows ---
var FULL_TRACK_ROW_LIMIT = 14000;

function pad2(n){ return n < 10 ? '0' + n : '' + n; }
function formatDateTimeLocal(d){
  if(!d || isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function getRowTimestamp(r){
  if(!r) return null;
  var tsStr = r.wdate || r.WDATE || r.date || r.Date || r.ts || '';
  if(!tsStr) return null;
  try { return parseTrackDate(tsStr); } catch(e){ return null; }
}

function findOldestTimestamp(rows){
  var minTs = null;
  for(var i=0; i<rows.length; i++){
    var ts = getRowTimestamp(rows[i]);
    if(ts && !isNaN(ts.getTime())){
      if(minTs === null || ts.getTime() < minTs.getTime()) minTs = ts;
    }
  }
  return minTs;
}

function processDeviceTrack(points) {
  // Use global _trackData if available
  if (Array.isArray(window._trackData) && window._trackData.length > 0) {
    points = window._trackData;
  }

  // Ensure any external assignments to #fullDeviceTrackCount update the inline style correctly.
  function ensureFullCountObserver(){
    try{
      var el = document.getElementById('fullDeviceTrackCount');
      if(!el) return;
  if(el.__ftObserver) return; // already observing
      var applyStyleBasedOnText = function(){
        try{
          var txt = (el.textContent||'').trim();
          // extract number from text like '14000 records' or '14000 (..)'
          var m = txt.match(/(\d+[\d\s]*)/);
          var num = null;
          if(m && m[1]){
            num = parseInt(m[1].replace(/\s+/g,''), 10);
          }
          var wasChunked = /\(частями\)/.test(txt);
          if(num === 14000 && !wasChunked) el.style.backgroundColor = 'red'; else el.style.backgroundColor = '';
        }catch(_){ try{ el.style.backgroundColor = ''; }catch(_2){} }
      };
      // run once to sync state
      applyStyleBasedOnText();
      var obs = new MutationObserver(function(muts){ applyStyleBasedOnText(); });
      obs.observe(el, { childList: true, characterData: true, subtree: true });
      el.__ftObserver = obs;
    }catch(e){ /* ignore */ }
  }
  try{ if(document && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureFullCountObserver); else ensureFullCountObserver(); }catch(_){ }
  var anomalies = [];
  outOfBoundsGroups = [];
  window._outOfBoundsLayers = [];
  if(boundsDebugContainer) boundsDebugContainer.style.display = 'none';
  if(boundsDebugOutput) boundsDebugOutput.textContent = '';
  // generateSqlBtn removed; SQL button for anomalies is created in report when needed
  if (points.length < 2) {
    if (points.length === 1) {
      L.marker([points[0].latitude, points[0].longitude], {
        icon: startIcon,
      }).addTo(trackLayerGroup);
    }
    return anomalies;
  }
  var parseDate = parseTrackDate;
  var sortedPoints = points.sort(function (a, b) {
    return parseDate(a.wdate) - parseDate(b.wdate);
  });
  if (directionDecorator) {
    directionDecorator.clearLayers();
  } else {
    directionDecorator = L.layerGroup();
  }
  var isValidCoord = function (lat, lon) {
    return (
      isFinite(lat) &&
      isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180
    );
  };
  var sequences = [],
    sequencesMeta = [],
    currentSeq = [],
    currentSeqMeta = [];
  sortedPoints.forEach(function (pt) {
    var lat = Number(pt.latitude),
      lon = Number(pt.longitude);
    if (isValidCoord(lat, lon)) {
      currentSeq.push([lat, lon]);
      currentSeqMeta.push({ lat: lat, lng: lon, wdate: pt.wdate });
    } else {
      if (currentSeq.length > 1) {
        sequences.push(currentSeq);
        sequencesMeta.push(currentSeqMeta);
      }
      currentSeq = [];
      currentSeqMeta = [];
    }
  });
  if (currentSeq.length > 1) {
    sequences.push(currentSeq);
    sequencesMeta.push(currentSeqMeta);
  }
  sequences.forEach(function (seq, idx) {
    var pl = L.polyline(seq, {
      color: "black",
      weight: 3,
      opacity: 0.85,
    }).addTo(trackLayerGroup);
    pl._dtPoints = sequencesMeta[idx];
    attachRouteAwareClick(pl);
    var deco = L.polylineDecorator(pl, {
      patterns: [
        {
          offset: 25,
          repeat: 50,
          symbol: L.Symbol.arrowHead({
            pixelSize: 6,
            pathOptions: { fillOpacity: 1, weight: 0, color: "black" },
          }),
        },
      ],
    });
    directionDecorator.addLayer(deco);
  });
  // Use global constants from globals.js
  var currentSegmentLatLngs = [
    [sortedPoints[0].latitude, sortedPoints[0].longitude],
  ];
  var currentOutOfBoundsGroup = null;
  for (var i = 1; i < sortedPoints.length; i++) {
    var prevPoint = sortedPoints[i - 1],
      currentPoint = sortedPoints[i];
  var prevLL = L.latLng(prevPoint.latitude, prevPoint.longitude);
  var currLL = L.latLng(currentPoint.latitude, currentPoint.longitude);
  var timeDiffMs = parseDate(currentPoint.wdate) - parseDate(prevPoint.wdate);
    var distanceM = prevLL.distanceTo(currLL);
    var isGap = false;
    var speedKph = 0;
    var anomalyType = "";
    if (isOutOfBounds(currentPoint.latitude, currentPoint.longitude)) {
      // Log visually disabled
      isGap = true;
      anomalyType = "Out of Bounds";
      if (!currentOutOfBoundsGroup) {
        currentOutOfBoundsGroup = {
          startTime: parseDate(currentPoint.wdate),
          endTime: parseDate(currentPoint.wdate),
        };
      } else {
        currentOutOfBoundsGroup.endTime = parseDate(currentPoint.wdate);
      }
    } else {
      if (currentOutOfBoundsGroup) {
        currentOutOfBoundsGroup.endTime = parseDate(prevPoint.wdate);
        outOfBoundsGroups.push(currentOutOfBoundsGroup);
        addOutOfBoundsAnomaly(currentOutOfBoundsGroup, sortedPoints, anomalies);
        currentOutOfBoundsGroup = null;
      }
      if (timeDiffMs > ANOMALY_GAP_THRESHOLD_MS) {
        isGap = true;
        anomalyType = "Time Gap";
      } else if (timeDiffMs > 0) {
        speedKph = distanceM / 1000 / (timeDiffMs / 3600000);
        if (speedKph > ANOMALY_SPEED_THRESHOLD_KPH) {
          isGap = true;
          anomalyType = "Speed Spike";
        } else if (speedKph > ANOMALY_JUMP_SPEED_THRESHOLD_KPH && currentPoint.speed < ANOMALY_REAL_SPEED_THRESHOLD_KPH) {
          isGap = true;
          anomalyType = "Position Jump";
        }
      }
      // Distance-based Position Jump (distance > 1km regardless of speed/time)
      if (!isGap && distanceM >= ANOMALY_POSITION_JUMP_DISTANCE_M) {
        isGap = true;
        anomalyType = "Position Jump";
        if (timeDiffMs > 0) {
          speedKph = distanceM / 1000 / (timeDiffMs / 3600000);
        }
      }
      if (isGap) {
        if (currentSegmentLatLngs.length > 1) {
          var segPolyline = L.polyline(currentSegmentLatLngs, { color: "black" }).addTo(trackLayerGroup);
          attachRouteAwareClick(segPolyline);
          var segDeco = L.polylineDecorator(segPolyline, {
            patterns: [
              {
                offset: 25,
                repeat: 50,
                symbol: L.Symbol.arrowHead({ pixelSize: 6, pathOptions: { fillOpacity: 1, weight: 0, color: "black" } }),
              },
            ],
          });
          directionDecorator.addLayer(segDeco);
        }
        if (anomalyType !== "Out of Bounds") {
          var popupContent = "<b>Аномалия: " + anomalyType + "</b><br>С: " + prevPoint.wdate + "<br>По: " + currentPoint.wdate;
          if (anomalyType === "Position Jump") {
            popupContent += "<br>Расстояние: " + (distanceM / 1000).toFixed(2) + " км";
          } else {
            popupContent += "<br>Скорость: " + speedKph.toFixed(2) + " км/ч";
          }
          var lineStyle = anomalyType === "Position Jump" ? { color: "red", weight: 3, dashArray: "10,5" } : { color: "red", weight: 3 };
          var gapPolyline = L.polyline([prevLL, currLL], lineStyle).addTo(trackLayerGroup).bindPopup(popupContent);
          attachRouteAwareClick(gapPolyline);
          var gapDeco = L.polylineDecorator(gapPolyline, {
            patterns: [
              { offset: 25, repeat: 50, symbol: L.Symbol.arrowHead({ pixelSize: 6, pathOptions: { fillOpacity: 1, weight: 0, color: "red" } }) },
            ],
          });
          directionDecorator.addLayer(gapDeco);
          var includeInTable = distanceM >= ANOMALY_TABLE_MIN_DISTANCE_M;
          if (includeInTable) {
            var durSec = timeDiffMs / 1000;
            var durDisplay = durSec >= 3600 ? (durSec / 3600).toFixed(2) + " h" : durSec >= 60 ? (durSec / 60).toFixed(1) + " m" : Math.round(durSec) + " s";
            anomalies.push({
              "Start Time": formatAnomalyTime(prevPoint.wdate),
              "End Time": formatAnomalyTime(currentPoint.wdate),
              "Anomaly Type": anomalyType,
              "Calculated Speed (km/h)": speedKph.toFixed(2),
              "Reported Speed (km/h)": currentPoint.speed,
              "Duration": durDisplay,
              "Distance (km)": (distanceM / 1000).toFixed(2),
              layer: gapPolyline,
            });
          }
        }
        currentSegmentLatLngs = [];
      }
      currentSegmentLatLngs = [];
    }
    currentSegmentLatLngs.push(currLL);
  }
  if (currentOutOfBoundsGroup) {
    var lastPoint = sortedPoints[sortedPoints.length - 1];
    currentOutOfBoundsGroup.endTime = parseDate(lastPoint.wdate);
    outOfBoundsGroups.push(currentOutOfBoundsGroup);
    addOutOfBoundsAnomaly(currentOutOfBoundsGroup, sortedPoints, anomalies);
  }
  if (outOfBoundsGroups.length > 0) {
    // Previously we showed a global generateSqlBtn in Device Track Details; that button has been removed.
    // SQL generation is now handled from the Intervals report when Type4 anomalies are present.
  }
  if (currentSegmentLatLngs.length > 1) {
    var lastSeg = L.polyline(currentSegmentLatLngs, { color: "black" }).addTo(
      trackLayerGroup
    );
    attachRouteAwareClick(lastSeg);
    var decoLast = L.polylineDecorator(lastSeg, {
      patterns: [
        {
          offset: 25,
          repeat: 50,
          symbol: L.Symbol.arrowHead({
            pixelSize: 6,
            pathOptions: { fillOpacity: 1, weight: 0, color: "black" },
          }),
        },
      ],
    });
    directionDecorator.addLayer(decoLast);
  }
  if (directionsVisible) {
    directionDecorator.addTo(trackLayerGroup);
  }
  var allLatLngs = [];
  sequences.forEach(function (seq) {
    seq.forEach(function (ll) {
      allLatLngs.push(ll);
    });
  });
  if (allLatLngs.length > 0) {
    map.fitBounds(L.polyline(allLatLngs).getBounds());
    L.marker(allLatLngs[0], { icon: startIcon })
      .addTo(trackLayerGroup)
      .bindPopup("<b>Старт</b><br>" + sortedPoints[0].wdate);
    L.marker(allLatLngs[allLatLngs.length - 1], { icon: endIcon })
      .addTo(trackLayerGroup)
      .bindPopup(
        "<b>Финиш</b><br>" + sortedPoints[sortedPoints.length - 1].wdate
      );
  }
  // Link anomaly indices for highlighting (function from anomalies.js)
  linkAnomalyIndices(anomalies);
  return anomalies;
}

// --- Simplified raw track rendering (refactored requirement) ---
// Draws continuous polyline from raw points; clicking the polyline shows time of nearest recorded point.
// Does NOT display stops, anomalies, or extra decorations beyond start/end markers and fit bounds.
// Usage: drawRawDeviceTrack(rawResponseArray)
var _rawTrackNearestMarker = null;
function drawRawDeviceTrack(points){
    if(!Array.isArray(points) || !points.length){ updateStatus('Device Track: нет данных', '#dc3545', 6000); return; }
    // Clear layer group (ws.js already does but be defensive)
    if(trackLayerGroup){ trackLayerGroup.clearLayers(); }
    // Restore Out of Bounds polylines drawn by processDeviceTrack
    if(window._outOfBoundsLayers && window._outOfBoundsLayers.length){
      window._outOfBoundsLayers.forEach(function(l){ try{ trackLayerGroup.addLayer(l); }catch(e){} });
    }
    window._trackMarkersByTs = {};
    var parsed=[]; var latlngs=[];
    for(var i=0;i<points.length;i++){
      var p=points[i];
      var lat=Number(p.latitude!=null?p.latitude:p.LATITUDE||p.lat||p.Latitude);
      var lon=Number(p.longitude!=null?p.longitude:p.LONGITUDE||p.lon||p.Longitude||p.lng);
      if(!isFinite(lat)||!isFinite(lon)) continue;
      if(Math.abs(lat)>90||Math.abs(lon)>180) continue;
      var wdate=p.wdate||p.WDATE||p.date||p.Date||p.ts||'';
  // Normalize wdate to string for popup and keep original index
  parsed.push({lat:lat,lng:lon,wdate:wdate, idx: i});
      latlngs.push([lat,lon]);
    }
    if(latlngs.length<2){
      if(latlngs.length===1){
        var m0 = L.marker(latlngs[0],{icon:startIcon}).addTo(trackLayerGroup);
        try {
          var popupStart = document.createElement('div');
          popupStart.innerHTML = '<b>Старт</b><br>' + (parsed[0].wdate||'');
          if (typeof createTrackCutButton === 'function') {
            var cutBtnStart = createTrackCutButton(parsed[0].lat, parsed[0].lng, parsed[0].wdate);
            if (cutBtnStart) {
              cutBtnStart.classList.add('track-cut-popup-btn');
              popupStart.appendChild(cutBtnStart);
            }
          }
          m0.bindPopup(popupStart);
        } catch(_){ m0.bindPopup(parsed[0].wdate||''); }
        m0.on('click', function(ev){ if (routeModeActive){ var ll = ev && ev.latlng?ev.latlng:m0.getLatLng(); if(ll && typeof onRouteMapClick === 'function') onRouteMapClick({ latlng: ll }); if(ev && ev.originalEvent && ev.originalEvent.stopPropagation) ev.originalEvent.stopPropagation(); } else { try{ m0.openPopup(); }catch(_){} } });
      }
      updateStatus('Device Track: недостаточно точек ('+latlngs.length+')', '#dc3545', 6000); return;
    }
    // Decide rendering mode: 'polyline' (default) or 'points'
    var renderMode = window.rawTrackRenderMode || 'polyline';
    var poly = null;
    if(renderMode === 'polyline'){
      // Draw main polyline (blue)
      poly = L.polyline(latlngs,{color:'#0074D9', weight:4, opacity:.9}).addTo(trackLayerGroup);
      poly._rawPoints = parsed; // attach for click logic
    } else {
      // Points-only: draw small circle markers for each raw point
      poly = { _rawPoints: parsed, _isPointMode: true };
      for(var pi=0; pi<parsed.length; pi++){
        (function(pt, idx){
          var m = L.circleMarker([pt.lat, pt.lng], {radius:3, color:'#0074D9', weight:1, fillColor:'#0074D9', fillOpacity:0.9}).addTo(trackLayerGroup);
          // compute speed for this point
          var speed = null;
          try{ speed = (function(){ if(parsed.length<2) return null; var t = parseTrackDate(pt.wdate); var prev = idx>0?parsed[idx-1]:null; var next = idx<parsed.length-1?parsed[idx+1]:null; if(prev){ var dt = t - parseTrackDate(prev.wdate); if(dt>0){ var dist = L.latLng(prev.lat, prev.lng).distanceTo(L.latLng(pt.lat, pt.lng)); return dist/1000/(dt/3600000); } } if(next){ var dt2 = parseTrackDate(next.wdate) - t; if(dt2>0){ var dist2 = L.latLng(pt.lat, pt.lng).distanceTo(L.latLng(next.lat, next.lng)); return dist2/1000/(dt2/3600000); } } return null; })(); }catch(e){}
          var speedHtml = speed==null ? '' : '<br>Скорость: '+speed.toFixed(1)+' км/ч';
          // Build popup DOM to avoid quotation/attribute issues
          try {
            var container = document.createElement('div');
            container.innerHTML = '<b>' + (pt.wdate||'') + '</b>' + speedHtml;
            var _fullTbody = document.getElementById('fullDeviceTrackTbody');
            if (_fullTbody && _fullTbody.children && _fullTbody.children.length > 0) {
              var btn = document.createElement('button');
              // use a dedicated class so popup injector can detect existing button and avoid duplicates
              btn.className = 'btn btn-link ft-show-btn';
              btn.setAttribute('title', 'Показать в Full');
              // small magnifier SVG icon
              btn.innerHTML = '<svg class="ft-icon" viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zM10 14a4 4 0 110-8 4 4 0 010 8z"/></svg>';
              (function(ts){ btn.addEventListener('click', function(e){ try{ e.preventDefault(); e.stopPropagation(); if(window.focusFullDeviceTrackAtTimestamp) window.focusFullDeviceTrackAtTimestamp(ts); }catch(err){console.warn(err);} }); })(timeMatch ? timeMatch[1] : (pt.wdate||''));
              container.appendChild(btn);
            }
            if (typeof createTrackCutButton === 'function') {
              var cutBtn = createTrackCutButton(pt.lat, pt.lng, pt.wdate);
              if (cutBtn) {
                cutBtn.classList.add('track-cut-popup-btn');
                container.appendChild(cutBtn);
              }
            }
            m.bindPopup(container);
            // Store marker by time part for cross-linking
            var timeMatch = String(pt.wdate).match(/(\d{2}:\d{2}:\d{2})/);
            if(timeMatch) window._trackMarkersByTs[timeMatch[1]] = m;
          } catch (e) {
            // fallback to safe string if DOM creation fails
            var popupHtml = '<b>' + (pt.wdate||'') + '</b>' + speedHtml;
            m.bindPopup(popupHtml);
            // Store marker by time part for cross-linking
            var timeMatch = String(pt.wdate).match(/(\d{2}:\d{2}:\d{2})/);
            if(timeMatch) window._trackMarkersByTs[timeMatch[1]] = m;
          }
        })(parsed[pi], pi);
      }
    }
    // Detect raw track anomalies (function from anomalies.js)
    detectRawTrackAnomalies(parsed);
    // Start/End markers
  var mStart = L.marker(latlngs[0],{icon:startIcon}).addTo(trackLayerGroup);
  try {
    var startPopup = document.createElement('div');
    startPopup.innerHTML = '<b>Старт</b><br>'+ (parsed[0].wdate||'');
    if (typeof createTrackCutButton === 'function') {
      var startCutBtn = createTrackCutButton(parsed[0].lat, parsed[0].lng, parsed[0].wdate);
      if (startCutBtn) {
        startCutBtn.classList.add('track-cut-popup-btn');
        startPopup.appendChild(startCutBtn);
      }
    }
    mStart.bindPopup(startPopup);
  } catch(_){ mStart.bindPopup('<b>Старт</b><br>'+ (parsed[0].wdate||'')); }
  mStart.on('click', function(ev){ if (routeModeActive){ var ll = ev && ev.latlng?ev.latlng:mStart.getLatLng(); if(ll && typeof onRouteMapClick === 'function') onRouteMapClick({ latlng: ll }); if(ev && ev.originalEvent && ev.originalEvent.stopPropagation) ev.originalEvent.stopPropagation(); } else { try{ mStart.openPopup(); }catch(_){} } });
  var mEnd = L.marker(latlngs[latlngs.length-1],{icon:endIcon}).addTo(trackLayerGroup);
  try {
    var endPopup = document.createElement('div');
    endPopup.innerHTML = '<b>Финиш</b><br>'+ (parsed[parsed.length-1].wdate||'');
    if (typeof createTrackCutButton === 'function') {
      var endCutBtn = createTrackCutButton(parsed[parsed.length-1].lat, parsed[parsed.length-1].lng, parsed[parsed.length-1].wdate);
      if (endCutBtn) {
        endCutBtn.classList.add('track-cut-popup-btn');
        endPopup.appendChild(endCutBtn);
      }
    }
    mEnd.bindPopup(endPopup);
  } catch(_){ mEnd.bindPopup('<b>Финиш</b><br>'+ (parsed[parsed.length-1].wdate||'')); }
  mEnd.on('click', function(ev){ if (routeModeActive){ var ll = ev && ev.latlng?ev.latlng:mEnd.getLatLng(); if(ll && typeof onRouteMapClick === 'function') onRouteMapClick({ latlng: ll }); if(ev && ev.originalEvent && ev.originalEvent.stopPropagation) ev.originalEvent.stopPropagation(); } else { try{ mEnd.openPopup(); }catch(_){} } });
    // Fit bounds
      if (poly && typeof poly.getBounds === 'function') {
        map.fitBounds(poly.getBounds(), { padding: [20, 20] });
      } else {
        // points-only mode: use latlngs array to compute bounds
        map.fitBounds(L.latLngBounds(latlngs), { padding: [20, 20] });
      }
    // Click handler: find nearest point and show its timestamp (only for polyline)
    if (poly && typeof poly.on === 'function') {
      poly.on('click', function(ev){
        // If route mode active, delegate to route click handler and prevent popups
        if (routeModeActive) {
          var ll = ev && ev.latlng ? ev.latlng : null;
          if (!ll && ev && ev.layer && ev.layer.getLatLng) ll = ev.layer.getLatLng();
          if (ll && typeof onRouteMapClick === 'function') {
            try { onRouteMapClick({ latlng: ll }); } catch(_) {}
          }
          if (ev && ev.originalEvent && ev.originalEvent.stopPropagation) ev.originalEvent.stopPropagation();
          return;
        }
        var ll = ev.latlng; if(!ll) return;
        var pts = poly._rawPoints||[]; if(!pts.length) return;
        var minD=Infinity, nearest=null;
        for(var j=0;j<pts.length;j++){
          var d = map.distance(ll, L.latLng(pts[j].lat, pts[j].lng));
          if(d<minD){ minD=d; nearest=pts[j]; if(d<3) break; }
        }
        if(!nearest) return;
        if(_rawTrackNearestMarker){ try{ trackLayerGroup.removeLayer(_rawTrackNearestMarker);}catch(_){}};
        // compute approximate speed around this point (km/h)
        function computeSpeedAtIndex(points, idx){
          if(!points || points.length<2 || idx==null) return null;
          var curr = points[idx];
          // prefer previous->current interval
          var prev = idx>0 ? points[idx-1] : null;
          var next = idx < points.length-1 ? points[idx+1] : null;
          var tCurr = parseTrackDate(curr.wdate);
          if(prev){
            var tPrev = parseTrackDate(prev.wdate);
            var dt = tCurr - tPrev; // ms
            if(dt>0){
              var dist = L.latLng(prev.lat, prev.lng).distanceTo(L.latLng(curr.lat, curr.lng));
              return dist/1000/(dt/3600000);
            }
          }
          if(next){
            var tNext = parseTrackDate(next.wdate);
            var dt2 = tNext - tCurr;
            if(dt2>0){
              var dist2 = L.latLng(curr.lat, curr.lng).distanceTo(L.latLng(next.lat, next.lng));
              return dist2/1000/(dt2/3600000);
            }
          }
          return null;
        }

        var speedKph = computeSpeedAtIndex(pts, nearest.idx);
        var speedHtml = speedKph==null ? '' : '<br>Скорость: ' + (speedKph>=0 ? speedKph.toFixed(1) : '0.0') + ' км/ч';
        try {
          var container2 = document.createElement('div');
          container2.innerHTML = '<b>'+ (nearest.wdate||'') +'</b>' + speedHtml;
    var _fullTbody2 = document.getElementById('fullDeviceTrackTbody');
    if (_fullTbody2 && _fullTbody2.children && _fullTbody2.children.length > 0) {
            var btn2 = document.createElement('button');
            btn2.className = 'btn btn-link ft-show-btn';
            btn2.setAttribute('title', 'Показать в Full');
            btn2.innerHTML = '<svg class="ft-icon" viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zM10 14a4 4 0 110-8 4 4 0 010 8z"/></svg>';
            var timeMatch2 = String(nearest.wdate).match(/(\d{2}:\d{2}:\d{2})/);
            (function(ts){ btn2.addEventListener('click', function(e){ try{ e.preventDefault(); e.stopPropagation(); if(window.focusFullDeviceTrackAtTimestamp) window.focusFullDeviceTrackAtTimestamp(ts); }catch(err){console.warn(err);} }); })(timeMatch2 ? timeMatch2[1] : (nearest.wdate||''));
            container2.appendChild(btn2);
          }
          if (typeof createTrackCutButton === 'function') {
            var cutBtn2 = createTrackCutButton(nearest.lat, nearest.lng, nearest.wdate);
            if (cutBtn2) {
              cutBtn2.classList.add('track-cut-popup-btn');
              container2.appendChild(cutBtn2);
            }
          }
          _rawTrackNearestMarker = L.circleMarker([nearest.lat, nearest.lng], {radius:7, color:'#ff4136', weight:2, fillColor:'#ff4136', fillOpacity:0.9}).addTo(trackLayerGroup).bindPopup(container2);
        } catch (e) {
          _rawTrackNearestMarker = L.circleMarker([nearest.lat, nearest.lng], {radius:7, color:'#ff4136', weight:2, fillColor:'#ff4136', fillOpacity:0.9}).addTo(trackLayerGroup).bindPopup('<b>'+ (nearest.wdate||'') +'</b>' + speedHtml);
        }
        _rawTrackNearestMarker.openPopup();
      });
    }
    updateStatus('Device Track: точек '+latlngs.length, 'green', 6000);
    // Bind a global popupopen handler once so that if the Full table is loaded later
  // we can inject the "Show in Full" button into existing popups.
      if (!window._rawPopupOpenBound && typeof map !== 'undefined' && map && map.on) {
        map.on('popupopen', function(e){
          try {
            var popup = e.popup || (e.layer && e.layer.getPopup && e.layer.getPopup());
            if(!popup) return;
            var node = popup._contentNode || null;
            // if Leaflet created content as string, getContent may return string
            if(!node && typeof popup.getContent === 'function') {
              var c = popup.getContent();
              if(c && typeof c === 'object' && c.nodeType) node = c;
            }
            if(!node) return;
            // avoid adding button twice
            if(node.querySelector && node.querySelector('.ft-show-btn')) return;
            var tbody = document.getElementById('fullDeviceTrackTbody');
            if(!tbody || !tbody.children || tbody.children.length===0) return;
            var txt = (node.textContent || (typeof popup.getContent === 'function' ? popup.getContent() : '') || '').toString();
            var m = txt.match(/(\d{2}:\d{2}:\d{2})/);
            var timePart = m ? m[1] : null;
            if(!timePart) return;
            var btn = document.createElement('button');
            btn.className = 'btn btn-link ft-show-btn';
            btn.setAttribute('title', 'Показать в Full');
            btn.innerHTML = '<svg class="ft-icon" viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zM10 14a4 4 0 110-8 4 4 0 010 8z"/></svg>';
            btn.addEventListener('click', function(ev){
              try{ ev.preventDefault(); ev.stopPropagation(); if(window.focusFullDeviceTrackAtTimestamp) window.focusFullDeviceTrackAtTimestamp(txt); }catch(e){console.warn(e);} 
            });
            node.appendChild(btn);
          } catch(err) { console.warn('popupopen inject failed', err); }
        });
        window._rawPopupOpenBound = true;
      }
}
// Functions addOutOfBoundsAnomaly, formatAnomalyTime moved to anomalies.js

// original generateSql removed; SQL generation is handled from report-specific actions now

// Full raw Device Track (setup) table population
(function(){
  if(!window) return;
  var fullHead = document.getElementById('fullDeviceTrackThead');
  var fullBody = document.getElementById('fullDeviceTrackTbody');
  var reloadBtn = document.getElementById('reloadFullTrackBtn');
  var reportHead = document.getElementById('fullDeviceTrackReportThead');
  var reportBody = document.getElementById('fullDeviceTrackReportTbody');
  var reportContainer = document.getElementById('fullDeviceTrackReportContainer');
  var minDurationInput = document.getElementById('fullTrackMinDuration');
  var satThresholdInput = document.getElementById('fullTrackSatThreshold');
  var mergeGapInput = document.getElementById('fullTrackMergeGap');
  var applyFilterBtn = document.getElementById('fullTrackApplyFilterBtn');
  var clearFocusBtn = document.getElementById('fullTrackClearFocusBtn');
  // ---- Local persistence of report settings ----
  var FT_SETTINGS_KEY = 'fullTrackReportSettings';
  function loadFullTrackSettings(){
    try {
      var raw = localStorage.getItem(FT_SETTINGS_KEY); if(!raw) return;
      var obj = JSON.parse(raw);
      if(obj && typeof obj === 'object'){
        if(minDurationInput && obj.minDuration != null){ minDurationInput.value = obj.minDuration; }
        if(satThresholdInput && obj.satThreshold != null){ satThresholdInput.value = obj.satThreshold; }
        if(mergeGapInput && obj.mergeGap != null){ mergeGapInput.value = obj.mergeGap; }
      }
    } catch(e){ console.warn('Не удалось загрузить настройки отчёта', e); }
  }
  function saveFullTrackSettings(){
    try {
      var data = {
        minDuration: minDurationInput ? minDurationInput.value : null,
        satThreshold: satThresholdInput ? satThresholdInput.value : null,
        mergeGap: mergeGapInput ? mergeGapInput.value : null
      };
      localStorage.setItem(FT_SETTINGS_KEY, JSON.stringify(data));
    } catch(e){ console.warn('Не удалось сохранить настройки отчёта', e); }
  }
  function bindSettingPersistence(el){ if(!el) return; if(el.dataset.ftPersistBound) return; el.addEventListener('change', saveFullTrackSettings); el.addEventListener('blur', saveFullTrackSettings); el.dataset.ftPersistBound='1'; }
  loadFullTrackSettings();
  bindSettingPersistence(minDurationInput); bindSettingPersistence(satThresholdInput); bindSettingPersistence(mergeGapInput);
  var _fullTrackCache = null; // store last full selection
  var _fullIntervals = []; // cache intervals after filtering
  var _focusedIntervalIndex = null;

  function clearFull(){ if(fullHead) fullHead.innerHTML=''; if(fullBody) fullBody.innerHTML=''; }
  function updateFullCount(n){
    try{
      var el = document.getElementById('fullDeviceTrackCount');
      if(!el) return;
      var base = (typeof n === 'number' ? (n + ' записей') : '0 записей');
      // If data was loaded in chunks, mark it so the user knows the full range is covered
      try{
        if(window._fullTrackWasChunked){
          el.textContent = base + ' (частями)';
          el.style.backgroundColor = '';
          return;
        }
      }catch(_){}
      // highlight exact server limit (legacy warning, should not appear when chunking succeeded)
      try{
        var isHuge = (typeof n === 'number' && n === 14000);
        if(isHuge) el.style.backgroundColor = 'red'; else el.style.backgroundColor = '';
      }catch(_){}
      // If we have per-segment metadata from the last merged split, show breakdown
      try{
        if(window._fullTrackSegmentsFinalized && window._lastFullTrackSegments && Array.isArray(window._lastFullTrackSegments)){
          var parts = window._lastFullTrackSegments.map(function(s){ return s.count || 0; });
          el.textContent = base + ' (' + parts.join('/') + ')';
          return;
        }
      }catch(e){}
      el.textContent = base;
    }catch(_){}
  }

  // Human friendly ms formatting
  function formatMs(ms){
    try{
      if(ms == null || isNaN(ms)) return '';
      if(ms < 1000) return String(ms) + ' ms';
      var s = (ms/1000);
      return s.toFixed(1) + ' s';
    }catch(e){ return String(ms)+' ms'; }
  }
  // Public clear function for external triggers (device change)
  window.clearFullDeviceTrackTable = function(){
    try { clearFull(); if(fullBody) fullBody.innerHTML = '<tr><td>Очищено из-за смены устройства</td></tr>'; updateFullCount(0); } catch(_){ }
    _fullTrackCache = null; _fullIntervals = []; _focusedIntervalIndex = null;
    try { window._fullTrackIndexByTs = {}; } catch(_){ }
    try { window._devLogRequestedFull = false; } catch(_){ }
    try { window._awaitingFullTrackSetupSegments = null; } catch(_){}
    // Preserve an active full-track load state; otherwise reset it
    try {
      if(!(window._fullTrackLoadState && window._fullTrackLoadState.active)){
        window._fullTrackLoadState = null;
      }
    } catch(_){}
    try { window._fullTrackWasChunked = false; } catch(_){}
    // remove badge if present
    try { var b = document.getElementById('fullDeviceTrackSegBadge'); if(b && b.parentNode) b.parentNode.removeChild(b); } catch(_){}
    try { window._lastFullTrackSegments = null; } catch(_){ }
    try { window._fullTrackSegmentsFinalized = false; } catch(_){ }
    if(reportContainer) reportContainer.style.display='none';
    try{ window.__dt_hideSpinner('fullDeviceTrackSpinner'); }catch(_){}
    try{ window.__dt_setTableLoading('fullDeviceTrackTable', false); }catch(_){}
  };
  // Spinner helpers used across modules
  window.__dt_showSpinner = function(id, opts){
    try{
      if(!id) return;
      var el = document.getElementById(id);
      if(el) return; // already exists
      var span = document.createElement('span'); span.id = id;
      span.className = 'dt-spinner';
      // allow optional inline styles
      if(opts && opts.marginLeft) span.style.marginLeft = opts.marginLeft;
      if(opts && opts.width) span.style.width = opts.width;
      if(opts && opts.height) span.style.height = opts.height;
      // attach near target if provided
      if(opts && opts.insertAfterId){ var tgt = document.getElementById(opts.insertAfterId); if(tgt && tgt.parentNode) tgt.parentNode.insertBefore(span, tgt.nextSibling); else (document.body||document.documentElement).appendChild(span); }
      else (document.body||document.documentElement).appendChild(span);
      return span;
    }catch(e){ console.warn('showSpinner failed', e); }
  };
  window.__dt_hideSpinner = function(id){
    try{ var sp = document.getElementById(id); if(sp && sp.parentNode) sp.parentNode.removeChild(sp); }catch(e){ }
  };
  window.__dt_setTableLoading = function(tableId, on){
    try{ var t = document.getElementById(tableId); if(!t) return; if(on) t.classList.add('loading'); else t.classList.remove('loading'); }catch(e){}
  };
  // Clear and hide the Device Track Details table (previously named "Device Track Details").
  // The table is used to show anomalies; hide it when dates or device change or when no anomalies.
  window.clearDeviceTrackDetails = function(){
    try{
      var head = document.querySelector('#resultTable thead');
      var body = document.querySelector('#resultTable tbody');
      var container = document.querySelector('#resultTable')?.closest('.table-container');
      if(head) head.innerHTML = '';
      if(body) body.innerHTML = '';
      if(container) container.style.display = 'none';
    }catch(e){ console.warn('clearDeviceTrackDetails failed', e); }
  };
  // Centralized handler for any device/date change. Other modules should call this
  // instead of directly clearing individual tables so behavior is consistent.
  window.handleDeviceOrDateChange = function(opts){
    opts = opts || {};
    // When Full Device Track request triggers this, Device Alarm/Device Log may still be chunking.
    // Preserve their chunk states so ongoing responses can still be merged.
    var triggeredByFullTrackRequest = (opts.source === 'sendRequest' && opts.name === 'Device Track');
    var triggeredByLogRequest = (opts.source === 'sendRequest' && (opts.name === 'Device Alarm' || opts.name === 'Device Log'));
    var triggeredByDataRequest = triggeredByFullTrackRequest || triggeredByLogRequest;
    try{
      // Decide whether this is a device change or date change
      var curFrom = (typeof dateFromInput !== 'undefined' && dateFromInput) ? dateFromInput.value : null;
      var curTo = (typeof dateToInput !== 'undefined' && dateToInput) ? dateToInput.value : null;
      var curDev = (typeof deviceIdInput !== 'undefined' && deviceIdInput) ? deviceIdInput.value : null;
      var deviceChanged = false;
      if(opts && typeof opts.deviceChanged !== 'undefined'){
        deviceChanged = !!opts.deviceChanged;
      } else {
        deviceChanged = (opts && opts.source === 'device.change') || (typeof window._lastSeenDeviceId !== 'undefined' && window._lastSeenDeviceId !== curDev);
      }
      // Normalize date strings to timestamps for robust comparison
      function toTs(s){ try{ if(!s) return null; if(typeof s !== 'string') s = String(s); if(s.length===16) s = s + ':00'; var d = new Date(s); if(!isNaN(d.getTime())) return d.getTime(); // try parsing ISO-like without timezone
        var p = Date.parse(s); return isNaN(p)?null:p; }catch(e){ return null; } }
  var lastFromTs = (typeof window._lastSeenDateFrom !== 'undefined' && window._lastSeenDateFrom) ? toTs(window._lastSeenDateFrom) : null;
  var lastToTs = (typeof window._lastSeenDateTo !== 'undefined' && window._lastSeenDateTo) ? toTs(window._lastSeenDateTo) : null;
  var curFromTs = curFrom ? toTs(curFrom) : null;
  var curToTs = curTo ? toTs(curTo) : null;
  // Compare at minute resolution to avoid spurious differences caused by seconds (e.g., 23:59 vs 23:59:59)
  function toMin(ts){ try{ if(ts==null) return null; return Math.floor(Number(ts)/60000); }catch(e){return null;} }
  var lastFromMin = lastFromTs !== null ? toMin(lastFromTs) : null;
  var lastToMin = lastToTs !== null ? toMin(lastToTs) : null;
  var curFromMin = curFromTs !== null ? toMin(curFromTs) : null;
  var curToMin = curToTs !== null ? toMin(curToTs) : null;
      // debug logging removed
      var datesChanged = false;
      if(opts && typeof opts.datesChanged !== 'undefined'){
        datesChanged = !!opts.datesChanged;
      } else {
        datesChanged = (lastFromTs !== null && curFromTs !== null && lastFromTs !== curFromTs) || (lastToTs !== null && curToTs !== null && lastToTs !== curToTs);
      }

      // If device changed -> clear everything (safe), but preserve loading states
      // for active data requests (Dev Log / Analyze manage their own tables).
      if(deviceChanged){
        if(!triggeredByDataRequest){ try{ if(typeof window.clearFullDeviceTrackTable === 'function') window.clearFullDeviceTrackTable(); }catch(_){} }
        try{ if(typeof window.clearDeviceTrackDetails === 'function') window.clearDeviceTrackDetails(); }catch(_){}
        if(!triggeredByDataRequest){ try{ if(typeof window.hardClearDeviceLogTables === 'function') window.hardClearDeviceLogTables(); }catch(_){} }
        // also clear Start/Stop tables
        try{ if(startstopAccumulationThead) startstopAccumulationThead.innerHTML=''; if(startstopAccumulationTbody) startstopAccumulationTbody.innerHTML=''; }catch(_){ }
        try{ if(startstopSumResultThead) startstopSumResultThead.innerHTML=''; if(startstopSumResultTbody) startstopSumResultTbody.innerHTML=''; }catch(_){ }
        try{ if(startstopSumThead) startstopSumThead.innerHTML=''; if(startstopSumTbody) startstopSumTbody.innerHTML=''; }catch(_){ }
        // also clear Route Analysis table and map layers
        try{ if(typeof window.clearAnalysis === 'function') window.clearAnalysis(); }catch(_){}
        return;
      }

      // If dates changed, clear the usual tables. If dates did NOT change, do not clear
      // Anomalies (`#resultTable`) and Start/Stop tables if they already contain data.
      if(datesChanged){
        if(!triggeredByDataRequest){ try{ if(typeof window.clearFullDeviceTrackTable === 'function') window.clearFullDeviceTrackTable(); }catch(_){} }
        try{ if(typeof window.clearDeviceTrackDetails === 'function') window.clearDeviceTrackDetails(); }catch(_){}
        if(!triggeredByDataRequest){ try{ if(typeof window.hardClearDeviceLogTables === 'function') window.hardClearDeviceLogTables(); }catch(_){} }
        // clear Start/Stop tables on date change as well
        try{ if(startstopAccumulationThead) startstopAccumulationThead.innerHTML=''; if(startstopAccumulationTbody) startstopAccumulationTbody.innerHTML=''; }catch(_){ }
        try{ if(startstopSumResultThead) startstopSumResultThead.innerHTML=''; if(startstopSumResultTbody) startstopSumResultTbody.innerHTML=''; }catch(_){ }
        try{ if(startstopSumThead) startstopSumThead.innerHTML=''; if(startstopSumTbody) startstopSumTbody.innerHTML=''; }catch(_){ }
        // also clear Route Analysis on date change
        try{ if(typeof window.clearAnalysis === 'function') window.clearAnalysis(); }catch(_){}
        return;
      }

  // dates did NOT change and device did not change -> do not clear Anomalies or Start/Stop tables
  // but still clear Full Device Track and device logs to avoid stale full-track state
      if(!triggeredByDataRequest){ try{ if(typeof window.clearFullDeviceTrackTable === 'function') window.clearFullDeviceTrackTable(); }catch(_){} }
      if(!triggeredByDataRequest){ try{ if(typeof window.hardClearDeviceLogTables === 'function') window.hardClearDeviceLogTables(); }catch(_){} }
    }catch(e){ console.warn('handleDeviceOrDateChange failed', e); }
  };
  // Hide details when dates or device selection actually change (guard against focus/blur without value change)
  try{
    // initialize last seen values
    window._lastSeenDateFrom = (typeof dateFromInput !== 'undefined' && dateFromInput) ? dateFromInput.value : null;
    window._lastSeenDateTo = (typeof dateToInput !== 'undefined' && dateToInput) ? dateToInput.value : null;
    window._lastSeenDeviceId = (typeof deviceIdInput !== 'undefined' && deviceIdInput) ? deviceIdInput.value : null;

    function makeGuardedListener(inputEl, key){
      if(!inputEl) return;
  // Do not update last-seen snapshots here. We want sendRequest to be
  // the single source of truth for updating window._lastSeen* so that
  // an actual request send detects changes and triggers clearing.
  // Keep listeners only to avoid accidental clears on focus/blur elsewhere.
  inputEl.addEventListener('input', function(){ /* no-op */ });
  inputEl.addEventListener('change', function(){ /* no-op */ });
    }

    makeGuardedListener(dateFromInput, '_lastSeenDateFrom');
    makeGuardedListener(dateToInput, '_lastSeenDateTo');
    makeGuardedListener(deviceIdInput, '_lastSeenDeviceId');
  }catch(e){ }
  function populateFull(rows){
    if(!fullHead || !fullBody){ return; }
    console.log('[populateFull] вызов, строк: ' + (rows && rows.length ? rows.length : 0));
    clearFull();
    if(!rows || !rows.length){ fullBody.innerHTML='<tr><td>Нет данных</td></tr>'; try{ updateFullCount(0); }catch(_){}; return; }
    try{ updateFullCount(rows.length); } catch(_){}
    _fullTrackCache = rows.slice();
    // Build index by normalized timestamp strings for quick lookup
    try { window._fullTrackIndexByTs = {}; } catch(_){}
    var headers = Object.keys(rows[0]);
    var trHead=document.createElement('tr');
    headers.forEach(function(h){ var th=document.createElement('th'); th.textContent=h; trHead.appendChild(th); });
    fullHead.appendChild(trHead);
    var frag=document.createDocumentFragment();
    rows.forEach(function(r, ridx){ var tr=document.createElement('tr'); headers.forEach(function(h){ var td=document.createElement('td'); var v=r[h]; if(v==null) v=''; td.textContent=v; tr.appendChild(td); });
  // If row contains a timestamp-like column, store mapping to this TR for focusing
      try {
        var ts = (r.wdate || r.WDATE || r.date || r.Date || r.ts || null);
        if(ts) {
          var timeMatch = String(ts).match(/(\d{2}:\d{2}:\d{2})/);
          if(timeMatch) {
            var timePart = timeMatch[1];
            var norm = String(ts);
            window._fullTrackIndexByTs[norm] = window._fullTrackIndexByTs[norm] || [];
            window._fullTrackIndexByTs[norm].push({ tr: tr, idx: ridx });
            tr.dataset.ts = timePart;
          }
        }
      } catch(_){}
      frag.appendChild(tr);
  // Add click listener to focus map
      tr.addEventListener('click', function(){
        if(window.focusMapAtTimestamp) window.focusMapAtTimestamp(tr.dataset.ts);
      });
    });
    fullBody.appendChild(frag);
  }

  // Focus map at the given timestamp (string). Opens popup on the corresponding marker.
  window.focusMapAtTimestamp = function(tsString){
      if(!tsString) return;
  // tsString is expected to be HH:MM:SS
  var timePart = tsString;
  // Scroll to map
      var mapEl = document.getElementById('map');
      if(mapEl) mapEl.scrollIntoView({behavior:'smooth', block:'center'});
  // Check if Track Raw is loaded
      if(!window._trackMarkersByTs || Object.keys(window._trackMarkersByTs).length === 0){
        try { showRouteToast('Track Raw не загружен', 2000); } catch(_){}
        return;
      }
      // Find marker by time part
      var m = window._trackMarkersByTs[timePart];
      if(m){
        m.openPopup();
        // Center map on the marker
        try{ if(window.map) map.setView(m.getLatLng(), window.map.getZoom()); }catch(_){}
      } else {
        showRouteToast('Точка на карте не найдена для времени ' + timePart, 2000);
      }
  };
  // Focus full device track table at the given timestamp (string). Highlights matching row(s).
  window.focusFullDeviceTrackAtTimestamp = function(tsString){
    try {
      if(!tsString) return;
      // Do NOT trigger loading of Full Device Track here — only act if already loaded
      var tbody = document.getElementById('fullDeviceTrackTbody');
      if(!tbody || !tbody.children || tbody.children.length === 0){
        try { showRouteToast('Full Device Track (setup) не загружен', 2000); } catch(_){}
        return;
      }
      // Extract time HH:MM:SS from incoming timestamp like '2025-10-08T16:55:17' or '2025-10-08 16:55:17'
      var m = String(tsString).match(/(\d{2}:\d{2}:\d{2})/);
      var timePart = m ? m[1] : null;
      if(!timePart){ try { showRouteToast('Не удалось извлечь время из метки', 1800); } catch(_){}; return; }
      // Search table rows for the time substring
      var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
      var matches = rows.filter(function(r){ try { return r.dataset.ts === timePart; } catch(_) { return false; } });
      if(!matches || matches.length === 0){ try { showRouteToast('Не найдено строк с временем '+timePart, 2000); } catch(_){}; return; }
      // Clear previous highlights
      try { var prev = document.querySelectorAll('#fullDeviceTrackTbody tr.highlighted'); Array.prototype.slice.call(prev).forEach(function(p){ p.classList.remove('highlighted'); }); } catch(_){}
      var first = matches[0];
      first.classList.add('highlighted');
      // Scroll container to show the row centered
      try {
        var scroll = document.getElementById('fullDeviceTrackScroll');
        if(scroll){
          // compute top offset inside the scroll container
          var top = first.offsetTop;
          scroll.scrollTop = Math.max(0, top - Math.floor(scroll.clientHeight/2));
        } else {
          first.scrollIntoView({behavior:'smooth', block:'center'});
        }
      } catch(_){}
      // bring the full device track area into view
      try { var container = document.getElementById('fullDeviceTrackReportContainer') || document.getElementById('fullDeviceTrackScroll'); if(container) container.scrollIntoView({behavior:'smooth', block:'center'}); } catch(_){}
      // temporary visual flash removal
      setTimeout(function(){ try{ first.classList.remove('highlighted'); }catch(_){} }, 8000);
    } catch(e){ console.warn('focusFullDeviceTrackAtTimestamp failed', e); }
  };

  function buildFullSetupRequest(){
    if(!dateFromInput || !dateToInput || !deviceIdInput) return null;
    var dateTo = buildLocalDateParam(dateToInput.value, true);
    var dateFrom = buildLocalDateParam(dateFromInput.value, false);
    var deviceId = deviceIdInput.value;
    if(!deviceId) return null;
    return { name:'Device Track', type:'etbl', mid:6, act:'setup',
      filter:[ {selectedpgdateto:[dateTo]}, {selectedpgdatefrom:[dateFrom]}, {selecteddeviceid:[deviceId]} ],
      nowait:false, waitfor:['selectedpgdateto'], usr:authUser, pwd:authPwd, uid:authUid, lang:'en'};
  }

  function requestFull(){
    if(!authLoggedIn){ showRouteToast('⚠ Сначала вход'); return; }
    var req=buildFullSetupRequest(); if(!req){ showRouteToast('⚠ Нет параметров для полного трека'); return; }
    try {
      // Clear previous Full Device Track UI and caches before starting a new load.
      // Do not call clearFullDeviceTrackTable here because it would reset _fullTrackLoadState
      // and hide the spinner; handleDeviceOrDateChange is also configured to skip this table
      // when the Device Track request itself triggers the change check.
      try { clearFull(); if(fullBody) fullBody.innerHTML = '<tr><td colspan="100" style="text-align:center; padding:16px;"><span class="dt-spinner" style="width:18px; height:18px; display:inline-block; vertical-align:middle; margin-right:8px;"></span>Загрузка Full Device Track...</td></tr>'; var fdtc = document.getElementById('fullDeviceTrackCount'); if(fdtc) fdtc.textContent = '0 записей (загрузка...)'; } catch(_){}
      try { _fullTrackCache = null; _fullIntervals = []; _focusedIntervalIndex = null; } catch(_){}
      try { window._fullTrackIndexByTs = {}; } catch(_){}
      try { window._devLogRequestedFull = false; } catch(_){}
      try { window._awaitingFullTrackSetupSegments = null; } catch(_){}
      try { window._lastFullTrackSegments = null; } catch(_){}
      try { window._fullTrackSegmentsFinalized = false; } catch(_){}
      try { var b = document.getElementById('fullDeviceTrackSegBadge'); if(b && b.parentNode) b.parentNode.removeChild(b); }catch(_){}
      try { if(reportContainer) reportContainer.style.display='none'; }catch(_){}
      // Extract original date range from the request filter
      var originalFrom = '', originalTo = '', deviceId = '';
      try{
        (req.filter || []).forEach(function(f){
          var keys = Object.keys(f || {});
          keys.forEach(function(k){
            var lk = k.toLowerCase();
            var v = Array.isArray(f[k]) ? f[k][0] : f[k];
            if(!v) return;
            if(lk.indexOf('pgdatefrom') !== -1) originalFrom = String(v);
            else if(lk.indexOf('pgdateto') !== -1) originalTo = String(v);
            else if(lk.indexOf('deviceid') !== -1) deviceId = String(v);
          });
        });
      } catch(e){ console.warn('requestFull: не удалось извлечь параметры фильтра', e); }

      // Initialize adaptive chunking state
      window._fullTrackLoadState = {
        active: true,
        accumulatedRows: [],
        originalFrom: originalFrom,
        originalTo: originalTo,
        deviceId: deviceId,
        analysisAfter: window._awaitingAnalysisTrack,
        chunkIndex: 0,
        hitLimit: false,
        lastOldestTs: null
      };
      // Keep legacy split-related flags clean
      try{ window._lastFullTrackSegments = null; }catch(_){}
      try{ window._fullTrackSegmentsFinalized = false; }catch(_){}
      try{ window._awaitingFullTrackSetupSegments = null; }catch(_){}
      try{ window._fullTrackWasChunked = false; }catch(_){}
      try{ var b = document.getElementById('fullDeviceTrackSegBadge'); if(b && b.parentNode) b.parentNode.removeChild(b); }catch(_){}

      // start timing for Device Track request
      try { setReqStart && setReqStart('Device Track'); } catch(_){}
      window._awaitingFullTrackSetup = true;
      updateStatus('Загрузка Full Device Track (часть 1)...','blue');
      try { if(fullHead && fullBody){ window.__dt_setTableLoading('fullDeviceTrackTable', true); } } catch(e){}
      try{ window.__dt_hideSpinner('fullDeviceTrackSpinner'); window.__dt_showSpinner('fullDeviceTrackSpinner', { insertAfterId: 'fullDeviceTrackCount', marginLeft: '8px', width: '14px', height: '14px' }); }catch(_){ }
      // Полноэкранный оверлей убран — индикация загрузки только на уровне таблицы
      try { sendRequest(req); } catch(e) { console.warn('Failed to send full track request', e); }
    }
    catch(e){ console.error(e); }
  }
  // Export function for external calls (for example, when Dev Log is pressed)
  window.requestFullDeviceTrackSetup = requestFull;

  function sendFullTrackChunk(dateFromStr, dateToStr){
    try{
      var state = window._fullTrackLoadState;
      if(!state || !state.active) return;
      state.chunkIndex++;
      var chunkReq = {
        name:'Device Track', type:'etbl', mid:6, act:'setup',
        filter:[
          {selectedpgdateto:[dateToStr]},
          {selectedpgdatefrom:[dateFromStr]},
          {selecteddeviceid:[state.deviceId]}
        ],
        nowait:false, waitfor:['selectedpgdateto'],
        usr:authUser, pwd:authPwd, uid:authUid, lang:'en',
        _splitBatch:true // reuse ws.js flag so it doesn't reset tables between chunks
      };
      updateStatus('Загрузка Full Device Track (часть '+(state.chunkIndex+1)+', до '+dateToStr+')...','blue');
      sendRequest(chunkReq);
    }catch(e){ console.warn('sendFullTrackChunk failed', e); }
  }

  function finalizeFullTrackLoad(){
    try{
      var state = window._fullTrackLoadState;
      if(!state) return;
      var combined = state.accumulatedRows || [];
      // Deduplicate: use wdate + latitude + longitude if available; fallback to JSON
      var seen = {};
      var uniq = [];
      for(var i=0;i<combined.length;i++){
        var r = combined[i];
        var key = '';
        try{
          var ts = r.wdate || r.WDATE || r.date || r.Date || r.ts || '';
          var lat = (r.latitude!=null?String(r.latitude): (r.LATITUDE!=null?String(r.LATITUDE): (r.lat!=null?String(r.lat): '')));
          var lon = (r.longitude!=null?String(r.longitude): (r.LONGITUDE!=null?String(r.LONGITUDE): (r.lon!=null?String(r.lon): (r.Longitude!=null?String(r.Longitude): ''))));
          key = ts + '|' + lat + '|' + lon;
        }catch(e){ key = JSON.stringify(r); }
        if(!seen[key]){ seen[key]=true; uniq.push(r); }
      }
      // Sort by parsed timestamp ascending
      try{
        uniq.sort(function(a,b){ var pa = parseTrackDate(a.wdate||a.WDATE||a.date||a.Date||a.ts||''); var pb = parseTrackDate(b.wdate||b.WDATE||b.date||b.Date||b.ts||''); return pa - pb; });
      }catch(e){}

      window._awaitingFullTrackSetup = false;
      try{ window._fullTrackWasChunked = state.hitLimit; }catch(_){}
      window._fullTrackLoadState = null;
      try{ window.__dt_hideSpinner('fullDeviceTrackSpinner'); }catch(_){ }
      updateStatus('Full Device Track: '+uniq.length+' строк, отрисовка таблицы...','blue');
      try{ updateFullCount(uniq.length); }catch(_){ }
      populateFull(uniq);
      // compute elapsed for Device Track request and show
      try{
        if(typeof __reqStartTimes !== 'undefined' && __reqStartTimes['Device Track']){
          var ms = Date.now() - __reqStartTimes['Device Track'];
          var el = document.getElementById('responseTime'); if(el) el.textContent = 'Device Track: ' + formatMs(ms);
          try{ clearReqStart && clearReqStart('Device Track'); } catch(_){ }
        }
      }catch(_){ }
      updateStatus('Full Device Track: '+uniq.length+' строк','green',6000);
      // Automatic run of the report for the full selection
      try { saveFullTrackSettings(); runReport(); } catch(e) { console.warn('Авто отчёт не выполнен', e); }
      try { window.__dt_setTableLoading('fullDeviceTrackTable', false); } catch(e){}

      if(window._awaitingAnalysisTrack && typeof window.runAnalysisFromRows === 'function'){
        try{ window.runAnalysisFromRows(uniq); }catch(e){ console.warn('Analysis from full track failed', e); }
        window._awaitingAnalysisTrack = false;
      }
    }catch(e){ console.warn('finalizeFullTrackLoad failed', e); }
  }

  if(reloadBtn && !reloadBtn.dataset.bound){ reloadBtn.addEventListener('click', requestFull); reloadBtn.dataset.bound='1'; }

  // Hook into global message processing: augment existing handler chain
  var prevHook = window.__handleDeviceLogResponse; // keep reference though not needed
  var origHandler = window.__handleFullTrackSetup;
  window.__handleFullTrackSetup = function(data){
    if(!data || data.name !== 'Device Track') return false;
    if(!window._awaitingFullTrackSetup) return false; // not our response

    if(data.res && data.res[0] && Array.isArray(data.res[0].f)){
      var rows = data.res[0].f;
      var state = window._fullTrackLoadState;

      if(state && state.active){
        state.accumulatedRows = state.accumulatedRows.concat(rows);
        updateStatus('Загрузка Full Device Track (часть '+(state.chunkIndex+1)+', получено '+state.accumulatedRows.length+' строк)...','blue');
        console.log('[FullTrack] Часть #'+(state.chunkIndex+1)+' получена: '+rows.length+' строк, всего накоплено: '+state.accumulatedRows.length);
        try{ var fdtc = document.getElementById('fullDeviceTrackCount'); if(fdtc) fdtc.textContent = state.accumulatedRows.length + ' записей (загрузка...)'; } catch(_){}

        if(rows.length >= FULL_TRACK_ROW_LIMIT){
          state.hitLimit = true;
          var oldestTs = findOldestTimestamp(rows);
          var originalFromTs = parseTrackDate(state.originalFrom);
          if(oldestTs && !isNaN(oldestTs.getTime()) && originalFromTs && !isNaN(originalFromTs.getTime())){
            // Protect against infinite loop if the boundary didn't move
            if(state.lastOldestTs !== null && oldestTs.getTime() === state.lastOldestTs){
              console.warn('[FullTrack] Граница старейшей записи не сдвинулась, останавливаем подгрузку');
              finalizeFullTrackLoad();
              return true;
            }
            state.lastOldestTs = oldestTs.getTime();

            // If oldest returned record is at or before requested start, we already have everything
            if(oldestTs.getTime() <= originalFromTs.getTime()){
              finalizeFullTrackLoad();
              return true;
            }

            // Request the remaining earlier interval [originalFrom, oldestTs]
            var newToStr = formatDateTimeLocal(oldestTs);
            if(newToStr && newToStr > state.originalFrom){
              sendFullTrackChunk(state.originalFrom, newToStr);
              return true;
            }
          }
        }

        finalizeFullTrackLoad();
        return true;
      }

      // Fallback when no chunk state is active: treat response as complete
      window._awaitingFullTrackSetup = false;
      try{
        rows.sort(function(a,b){ var pa = parseTrackDate(a.wdate||a.WDATE||a.date||a.Date||a.ts||''); var pb = parseTrackDate(b.wdate||b.WDATE||b.date||b.Date||b.ts||''); return pa - pb; });
      } catch(e){}
      try{ window.__dt_hideSpinner('fullDeviceTrackSpinner'); }catch(_){ }
      updateStatus('Full Device Track: '+rows.length+' строк, отрисовка таблицы...','blue');
      try{ updateFullCount(rows.length); }catch(_){ }
      populateFull(rows);
      try{
        if(typeof __reqStartTimes !== 'undefined' && __reqStartTimes['Device Track']){
          var ms = Date.now() - __reqStartTimes['Device Track'];
          var el = document.getElementById('responseTime'); if(el) el.textContent = 'Device Track: ' + formatMs(ms);
          try{ clearReqStart && clearReqStart('Device Track'); } catch(_){ }
        }
      }catch(_){ }
      updateStatus('Full Device Track: '+rows.length+' строк','green',6000);
      try { saveFullTrackSettings(); runReport(); } catch(e) { console.warn('Авто отчёт не выполнен', e); }
      try { window.__dt_setTableLoading('fullDeviceTrackTable', false); } catch(e){}
      if(window._awaitingAnalysisTrack && typeof window.runAnalysisFromRows === 'function'){
        try{ window.runAnalysisFromRows(rows); }catch(e){ console.warn('Analysis from full track failed', e); }
        window._awaitingAnalysisTrack = false;
      }
      return true;
    }
    return false;
  };

  // ---- Report generation ----
  function buildIntervals(data){
    var res = [];
    if(!data || !data.length) return res;
    function formatLocalTs(ts){
      var d=new Date(ts); if(isNaN(d)) return '';
      var dd=String(d.getDate()).padStart(2,'0');
      var mm=String(d.getMonth()+1).padStart(2,'0');
      var yy=String(d.getFullYear()).slice(-2);
      var hh=String(d.getHours()).padStart(2,'0');
      var mi=String(d.getMinutes()).padStart(2,'0');
      var ss=String(d.getSeconds()).padStart(2,'0');
      return dd+'.'+mm+'.'+yy+' '+hh+':'+mi+':'+ss;
    }
    var norm = data.map(function(r, idx){
      return {
  idx: idx, // index of the row for highlighting
        wdate: r.wdate || r.WDATE || r.date || r.Date || null,
        ignition: (r.ignition!==undefined ? r.ignition : r.IGNITION),
        ismoves: (r.ismoves!==undefined ? r.ismoves : r.ISMOVES),
        satelites: (r.satelites!==undefined ? r.satelites : r.SATELITES),
        raw: r
      };
    }).filter(function(r){ return r.wdate; });
    var parse = function(w){ var d = parseTrackDate(w); return isNaN(d.getTime())?null:d; };
    norm.forEach(function(n){ var d=parse(n.wdate); n._ts = d?d.getTime():NaN; });
  norm = norm.filter(function(n){ return !isNaN(n._ts); }).sort(function(a,b){ return a._ts - b._ts; });
  // Build a mapping from original index (n.idx) -> position in the sorted `norm` array.
  // Intervals store original data indices (so highlighting in the full table works),
  // but when we need to recompute timestamps we must translate those original indices
  // into positions inside the sorted `norm` array to access _.ts correctly.
  var posByOrig = {};
  norm.forEach(function(n, pos){ posByOrig[n.idx] = pos; });
    if(!norm.length) return res;
    var current = null;
  var satThreshold = 10;
  if(typeof satThresholdInput !== 'undefined' && satThresholdInput){ var stv = parseInt(satThresholdInput.value,10); if(!isNaN(stv) && stv>0) satThreshold = stv; }
    function classify(n){
      var ign = (n.ignition === false || n.ignition === 'false' || n.ignition === 0 || n.ignition === '0');
      var move = (n.ismoves === true || n.ismoves === 'true' || n.ismoves === 1 || n.ismoves === '1');
      var sats = parseInt(n.satelites,10); if(isNaN(sats)) sats = null;
  var type1 = ign && move;          // condition 1
  var type2 = (sats!=null && sats < satThreshold); // condition 2 (dynamic threshold)
      var type = 0;
      if(type1 && type2) type = 3; else if(type1) type = 1; else if(type2) type = 2; else type = 0;
      return { type:type, type1:type1, type2:type2, sats:sats };
    }
    for(var i=0;i<norm.length;i++){
      var n = norm[i];
      var cls = classify(n);
      if(cls.type){
        if(!current){
          current = { start:n._ts, end:n._ts, startStr:formatLocalTs(n._ts), endStr:formatLocalTs(n._ts), count:1, typeFlags:{1:cls.type===1||cls.type===3,2:cls.type===2||cls.type===3,3:cls.type===3}, rows:[n.idx] };
        } else {
          current.end = n._ts; current.endStr = formatLocalTs(n._ts); current.count++; current.typeFlags[1] = current.typeFlags[1] || cls.type===1||cls.type===3; current.typeFlags[2] = current.typeFlags[2] || cls.type===2||cls.type===3; current.typeFlags[3] = current.typeFlags[3] || cls.type===3; current.rows.push(n.idx);
        }
      } else {
        if(current){ res.push(current); current=null; }
      }
    }
    if(current) res.push(current);
    res.forEach(function(r){ r.durationSec = ((r.end - r.start)/1000).toFixed(1); r.finalType = r.typeFlags[3]?3: (r.typeFlags[1] && r.typeFlags[2]?3: (r.typeFlags[1]?1:2)); });
    // --- Detect GPS anomalies (Out of bounds / distance jumps) in the same way as gpsAnomalies.js
    // and include them as additional intervals of type 4
    try {
      var anomalyGroups = [];
      var prevLat = null, prevLon = null, lastAnomalyType = null, currentAnom = null;
      function getLatLonFromRaw(raw){
        if(!raw) return {lat:null, lon:null};
        var lat = Number(raw.latitude!=null?raw.latitude: (raw.LATITUDE!=null?raw.LATITUDE: raw.lat!=null?raw.lat: raw.Latitude));
        var lon = Number(raw.longitude!=null?raw.longitude: (raw.LONGITUDE!=null?raw.LONGITUDE: raw.lon!=null?raw.lon: raw.Longitude));
        if(isNaN(lat)) lat = null; if(isNaN(lon)) lon = null;
        return {lat:lat, lon:lon};
      }
      function haversineKm(aLat,aLon,bLat,bLon){
        if(aLat==null||aLon==null||bLat==null||bLon==null) return 0;
        var R=6371; var dLat=(bLat-aLat)*Math.PI/180; var dLon=(bLon-aLon)*Math.PI/180;
        var aa = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(aLat*Math.PI/180)*Math.cos(bLat*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
        return 2*R*Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa));
      }
      for(var i=0;i<norm.length;i++){
        var n = norm[i];
        var raw = n.raw;
        var ll = getLatLonFromRaw(raw);
        var lat = ll.lat, lon = ll.lon;
        var isMajor = false, isMinor = false;
        // Major if coords missing or out of BOUNDS
        if(lat==null || lon==null || isOutOfBounds(lat, lon)) isMajor = true;
        if(prevLat!==null && prevLon!==null && lat!==null && lon!==null){
          var dkm = haversineKm(prevLat, prevLon, lat, lon);
          if(dkm > 10) isMinor = true; // threshold same as gpsAnomalies
        }
  // Only treat major anomalies (missing coords or out-of-bounds)
  // as Type4. Distance jumps (isMinor) are not promoted to Type4
  // to match expectation that Type4 means coords outside Ukraine.
  var thisType = isMajor ? 'major' : null;
        if(thisType){
          if(!currentAnom || currentAnom.type !== thisType){
            if(currentAnom) anomalyGroups.push(currentAnom);
            currentAnom = { type:thisType, start: n._ts, end: n._ts, startStr: formatLocalTs(n._ts), endStr: formatLocalTs(n._ts), count:1, rows:[n.idx] };
          } else {
            currentAnom.end = n._ts; currentAnom.endStr = formatLocalTs(n._ts); currentAnom.count++; currentAnom.rows.push(n.idx);
          }
          lastAnomalyType = thisType;
        } else if(currentAnom){
          anomalyGroups.push(currentAnom); currentAnom = null; lastAnomalyType = null;
        }
        prevLat = lat; prevLon = lon;
      }
      if(currentAnom) anomalyGroups.push(currentAnom);
      // Merge adjacent or very-close anomaly groups (rows consecutive or gap <=1s)
      if(anomalyGroups.length > 1){
        anomalyGroups.sort(function(a,b){ return a.start - b.start; });
        var mergedAnoms = []; var prev = anomalyGroups[0];
        for(var ai=1; ai<anomalyGroups.length; ai++){
          var cur = anomalyGroups[ai];
          var prevLastRow = prev.rows[prev.rows.length-1];
          var curFirstRow = cur.rows[0];
          var gapMs = cur.start - prev.end;
          if((typeof prevLastRow === 'number' && typeof curFirstRow === 'number' && curFirstRow === prevLastRow + 1) || gapMs <= 1000){
            // merge
            prev.end = cur.end; prev.endStr = cur.endStr; prev.count += cur.count; prev.rows = prev.rows.concat(cur.rows);
          } else {
            mergedAnoms.push(prev); prev = cur;
          }
        }
        mergedAnoms.push(prev);
        anomalyGroups = mergedAnoms;
      }
      // Convert anomaly groups to intervals with finalType 4 and push to res
      // First, build a set of all row indices that are part of anomaly groups
      var anomalyRowSet = {};
      anomalyGroups.forEach(function(ag){ ag.rows.forEach(function(ridx){ anomalyRowSet[ridx]=true; }); });
      // Remove anomaly rows from existing intervals (prioritize Type4 display)
      var filtered = [];
      res.forEach(function(interval){
        if(interval.isAnomaly){ filtered.push(interval); return; }
        if(!interval.rows || !interval.rows.length){ return; }
        var newRows = interval.rows.filter(function(ridx){ return !anomalyRowSet[ridx]; });
        if(!newRows.length) return; // drop empty interval
        // Recompute interval bounds based on remaining rows
  var firstIdx = newRows[0]; var lastIdx = newRows[newRows.length-1];
  // newRows contains original indices (n.idx). Translate them to positions in the
  // sorted `norm` array via posByOrig to get correct timestamps.
  var firstPos = (posByOrig[firstIdx] !== undefined) ? posByOrig[firstIdx] : null;
  var lastPos = (posByOrig[lastIdx] !== undefined) ? posByOrig[lastIdx] : null;
  var startTs = (firstPos !== null && norm[firstPos]) ? norm[firstPos]._ts : NaN;
  var endTs = (lastPos !== null && norm[lastPos]) ? norm[lastPos]._ts : NaN;
        interval.rows = newRows;
        interval.count = newRows.length;
        interval.start = startTs; interval.end = endTs;
        interval.startStr = formatLocalTs(startTs); interval.endStr = formatLocalTs(endTs);
        interval.durationSec = ((interval.end - interval.start)/1000).toFixed(1);
        // Recompute typeFlags and finalType based on remaining rows
        try {
          var newFlags = {1:false,2:false,3:false};
          for(var ri=0; ri<newRows.length; ri++){
            var ridx = newRows[ri];
            // ridx is an original index; translate to position in the sorted `norm` array
            var pos = (typeof posByOrig !== 'undefined' && posByOrig[ridx] !== undefined) ? posByOrig[ridx] : null;
            if(pos === null || !norm[pos]) continue;
            var nn = norm[pos];
            var c = classify(nn);
            newFlags[1] = newFlags[1] || c.type===1 || c.type===3;
            newFlags[2] = newFlags[2] || c.type===2 || c.type===3;
            newFlags[3] = newFlags[3] || c.type===3;
          }
          interval.typeFlags = newFlags;
          interval.finalType = newFlags[3]?3:(newFlags[1] && newFlags[2]?3:(newFlags[1]?1:2));
        } catch(e){}
        filtered.push(interval);
      });
      res = filtered;
      // Now add anomaly intervals (type 4)
      anomalyGroups.forEach(function(ag){
        var iv = { start: ag.start, end: ag.end, startStr: ag.startStr, endStr: ag.endStr, count: ag.count, rows: ag.rows.slice(), durationSec: ((ag.end - ag.start)/1000).toFixed(1), isAnomaly:true };
        iv.finalType = 4;
        // Ensure typeFlags exist so later merging logic can safely reference them
        iv.typeFlags = {1:false,2:false,3:false};
        res.push(iv);
      });
      // Resort intervals after adding anomalies
      res.sort(function(a,b){ return a.start - b.start; });
    } catch(e){ console.warn('anomaly integration failed', e); }
    // Merge gaps shorter than threshold
  var mergeGapSec = 0;
  if(typeof mergeGapInput !== 'undefined' && mergeGapInput){ var mgv = parseFloat(mergeGapInput.value); if(!isNaN(mgv) && mgv>0) mergeGapSec = mgv; }
    if(mergeGapSec > 0 && res.length > 1){
      var merged = []; var prev = res[0];
      for(var j=1;j<res.length;j++){
        var cur = res[j];
        // Do not merge if either interval is an anomaly (Type4) - anomalies are preserved
        if (prev.isAnomaly || cur.isAnomaly) {
          merged.push(prev); prev = cur; continue;
        }
        var gapSec = (cur.start - prev.end)/1000;
        if(gapSec <= mergeGapSec){
          prev.end = cur.end; prev.endStr = cur.endStr; prev.count += cur.count; prev.rows = prev.rows.concat(cur.rows);
          prev.typeFlags[1] = prev.typeFlags[1] || cur.typeFlags[1];
          prev.typeFlags[2] = prev.typeFlags[2] || cur.typeFlags[2];
          prev.typeFlags[3] = prev.typeFlags[3] || cur.typeFlags[3];
          prev.durationSec = ((prev.end - prev.start)/1000).toFixed(1);
          prev.finalType = prev.typeFlags[3]?3:(prev.typeFlags[1] && prev.typeFlags[2]?3:(prev.typeFlags[1]?1:2));
        } else {
          merged.push(prev); prev = cur;
        }
      }
      merged.push(prev);
      res = merged;
    }
    return res;
  }
  function renderReport(intervals){
    if(!reportHead || !reportBody) return;
    reportHead.innerHTML=''; reportBody.innerHTML='';
    // If there are anomaly intervals, show SQL button above report
    try {
      reportCurrentIntervals = intervals;
      var hasAnoms = intervals.some(function(iv){ return iv.isAnomaly; });
      var existingBtn = document.getElementById('reportGenerateSqlBtn');
      if(hasAnoms){
        if(!existingBtn){
          var btn = document.createElement('button'); btn.id='reportGenerateSqlBtn'; btn.className='btn btn-warning'; btn.textContent='Сформировать SQL для удаления';
          btn.style.marginBottom='8px';
          reportBody.parentElement.parentElement.insertBefore(btn, reportBody.parentElement);
          btn.addEventListener('click', function(){
            if(sqlModal) sqlModal.style.display='block';
            generateSqlFromIntervals(reportCurrentIntervals || intervals);
          });
        }
      } else {
        if(existingBtn) existingBtn.remove();
        reportCurrentIntervals = null;
      }
    } catch(e){}
    if(!intervals.length){
      reportBody.innerHTML = '<tr><td>Нет интервалов по заданным условиям</td></tr>';
      return;
    }
  var headers = ['#','Type','Period','Duration','Distance (km)','Rows'];
    var trH=document.createElement('tr');
    headers.forEach(function(h){ var th=document.createElement('th'); th.textContent=h; trH.appendChild(th); });
    reportHead.appendChild(trH);
  var fullTableBody = fullBody; // for highlighting rows
  // Remove previous highlights and focus
    if(fullTableBody){
      Array.prototype.forEach.call(fullTableBody.querySelectorAll('tr'), function(r){
        r.classList.remove('fdt-interval-type1','fdt-interval-type2','fdt-interval-type3','fdt-focused-row');
      });
    }
    var frag=document.createDocumentFragment();
    intervals.forEach(function(iv,idx){
      var tr=document.createElement('tr');
      tr.dataset.intervalIndex = idx;
      // Duration formatting: custom format
      var durSec = parseFloat(iv.durationSec);
      var durDisplay;
      if (durSec >= 3600) {
        var hours = Math.floor(durSec / 3600);
        var rem = durSec % 3600;
        var mins = Math.floor(rem / 60);
        var secs = Math.floor(rem % 60);
        durDisplay = hours + 'ч' + mins + 'м' + secs + 'сек';
      } else if (durSec >= 60) {
        var mins = Math.floor(durSec / 60);
        var secs = Math.floor(durSec % 60);
        durDisplay = mins + 'м' + secs + 'сек';
      } else {
        durDisplay = Math.floor(durSec) + 'сек';
      }
      var periodStr = iv.startStr + ' → ' + iv.endStr;
  var typeLabel = (iv.finalType===4)? 'За пределами' : (iv.finalType===3? 'Мало спутников + Нет питания' : (iv.finalType===2? 'Мало спутников' : (iv.finalType===1? 'Движение без питания' : String(iv.finalType))));
      // Calculate distance for the interval
      var dist = 0;
      if (_fullTrackCache && iv.rows && iv.rows.length > 1) {
        for (var k = 1; k < iv.rows.length; k++) {
          var prevPt = _fullTrackCache[iv.rows[k - 1]];
          var currPt = _fullTrackCache[iv.rows[k]];
          if (prevPt && currPt && prevPt.latitude != null && prevPt.longitude != null && currPt.latitude != null && currPt.longitude != null) {
            dist += L.latLng(prevPt.latitude, prevPt.longitude).distanceTo(L.latLng(currPt.latitude, currPt.longitude));
          }
        }
      }
      var distDisplay = (dist / 1000).toFixed(2) + ' km';
  var cols=[idx+1, typeLabel, periodStr, durDisplay, distDisplay, iv.count];
  cols.forEach(function(c,i){ var td=document.createElement('td'); td.textContent=c; if(i===2 || i===4) td.style.whiteSpace='nowrap'; tr.appendChild(td); });
  // Apply same visual class to report row as used for full table rows
  tr.classList.add('fdt-interval-type'+iv.finalType);
      if(fullTableBody){
        iv.rows.forEach(function(rowIdx){
          var rowEl = fullTableBody.children[rowIdx];
          if(rowEl){ rowEl.classList.add('fdt-interval-type'+iv.finalType); }
        });
      }
      tr.addEventListener('click', function(){ focusInterval(idx); });
      frag.appendChild(tr);
    });
    reportBody.appendChild(frag);
  }

  // Generate SQL for anomaly intervals (Type4) similar to generateSql()
  function generateSqlFromIntervals(intervals){
    var anoms = intervals.filter(function(iv){ return iv.isAnomaly; });
    if(!anoms.length){ sqlOutput.textContent = 'Нет аномалий для генерации SQL.'; return; }
    var deviceId = deviceIdInput.value || '';
    var pad = function(n){ return n.toString().padStart(2,'0'); };
    var formatForSqlLocal = function(d, isEnd){
      var raw = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
      return raw;
    };
    var sqlCommands = '';
    var affectedDates = {}; // Объект для хранения уникальных дат (ключ - строка даты)
    anoms.forEach(function(iv){
      var startDate = new Date(iv.start);
      var endDate = new Date(iv.end);
      // expand +/- 1 second as requested
      startDate.setSeconds(startDate.getSeconds() - 1);
      endDate.setSeconds(endDate.getSeconds() + 1);
      var current = new Date(startDate);
      while(current < endDate){
        var dayEnd = new Date(current); dayEnd.setHours(23,59,59,999);
        var segmentStart = current;
        var segmentEnd = new Date(Math.min(dayEnd.getTime(), endDate.getTime()));
        sqlCommands += "delete from snsrmain where deviceid='"+deviceId+"' and wdate >= '"+formatForSqlLocal(segmentStart,false)+"' and wdate <= '"+formatForSqlLocal(segmentEnd,true)+"';\n";
        // Сохраняем дату для recalcstartstop
        var dateStr = current.getFullYear() + '-' + pad(current.getMonth() + 1) + '-' + pad(current.getDate());
        affectedDates[dateStr] = true;
        current = new Date(dayEnd.getTime() + 1);
      }
    });
    // Добавляем вызовы recalcstartstop для каждой затронутой даты (сортируем для порядка)
    var sortedDates = Object.keys(affectedDates).sort();
    sortedDates.forEach(function(dateStr) {
      sqlCommands += "SELECT recalcstartstop(" + deviceId + ", '" + dateStr + "'::date, true);\n";
    });
    sqlOutput.textContent = sqlCommands;
  }
  function focusInterval(idx){
    _focusedIntervalIndex = idx;
    if(fullBody){ Array.prototype.forEach.call(fullBody.querySelectorAll('tr.fdt-focused-row'), function(r){ r.classList.remove('fdt-focused-row'); }); }
    var iv = _fullIntervals[idx]; if(!iv || !fullBody) return;
    var firstRow = null;
    iv.rows.forEach(function(rowIdx){ var rowEl = fullBody.children[rowIdx]; if(rowEl){ rowEl.classList.add('fdt-focused-row'); if(!firstRow) firstRow=rowEl; } });
    if(firstRow){ firstRow.scrollIntoView({behavior:'smooth', block:'center'}); }
  }
  function clearFocus(){
    _focusedIntervalIndex = null;
    if(fullBody){ Array.prototype.forEach.call(fullBody.querySelectorAll('tr.fdt-focused-row'), function(r){ r.classList.remove('fdt-focused-row'); }); }
  }
  function runReport(){
    if(!_fullTrackCache || !_fullTrackCache.length){ showRouteToast('Нет данных полного трека'); return; }
    var intervals = buildIntervals(_fullTrackCache);
    var minSec = 0;
    if(minDurationInput){ var v = parseFloat(minDurationInput.value); if(!isNaN(v) && v>0) minSec = v; }
    if(minSec>0){
      // Keep anomaly intervals (isAnomaly) regardless of min duration; apply filter only to others
      intervals = intervals.filter(function(iv){ return iv.isAnomaly ? true : (parseFloat(iv.durationSec) >= minSec); });
    }
    // Prioritize anomalies: move intervals with isAnomaly to the top, preserving relative order
    intervals.sort(function(a,b){ if(a.isAnomaly && !b.isAnomaly) return -1; if(!a.isAnomaly && b.isAnomaly) return 1; return a.start - b.start; });
    _fullIntervals = intervals.slice();
    renderReport(_fullIntervals);
    if(reportContainer) reportContainer.style.display='block';
    updateStatus('Report: найдено интервалов '+intervals.length, 'green', 6000);
  }
  if(applyFilterBtn && !applyFilterBtn.dataset.bound){ applyFilterBtn.addEventListener('click', runReport); applyFilterBtn.dataset.bound='1'; }
  if(clearFocusBtn && !clearFocusBtn.dataset.bound){ clearFocusBtn.addEventListener('click', clearFocus); clearFocusBtn.dataset.bound='1'; }
  // Patch ws onmessage dispatch if not already patched in ws.js
  if(window._socketMessageDispatchers){
    window._socketMessageDispatchers.push(window.__handleFullTrackSetup);
  }
})();
