// Map initialization & line width
var startIcon = L.divIcon({className:'custom-div-icon', html:"<div style='background-color:#198754;' class='marker-pin'></div><span style='font-size: 24px;'>🟢</span>", iconSize:[30,42], iconAnchor:[15,42]});
var endIcon = L.divIcon({className:'custom-div-icon', html:"<div style='background-color:#dc3545;' class='marker-pin'></div><span style='font-size: 24px;'>🏁</span>", iconSize:[30,42], iconAnchor:[15,42]});
function initMap(){
  if (map) return;
  map = L.map('map').setView([49.33,28.35],7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19, attribution:'© OpenStreetMap'}).addTo(map);
  trackLayerGroup = L.layerGroup().addTo(map);
  parkingLayerGroup = L.layerGroup().addTo(map); // Initialize and add to map

  // Custom route control
  var RouteControl = L.Control.extend({options:{position:'topleft'}, onAdd:function(){ var c=L.DomUtil.create('div','leaflet-bar rt-control'); c.innerHTML='<a href="#" class="rt-toggle" title="Режим построения маршрута">📍</a><a href="#" class="rt-reset" title="Сбросить маршрут">⟳</a>'; var t=c.querySelector('.rt-toggle'); var r=c.querySelector('.rt-reset'); L.DomEvent.disableClickPropagation(c); L.DomEvent.on(t,'click',function(e){ e.preventDefault(); if(!routeModeActive){ startRouteMode(); } else { if(routeClickCount>=2){ buildGoogleMapsRouteManual(); stopRouteMode(); } else { stopRouteMode(); } } updateRouteButton(); }); L.DomEvent.on(r,'click',function(e){ e.preventDefault(); resetManualRoute(); }); routeControlRef=c; updateRouteButton(); return c; }});
  map.addControl(new RouteControl());

  // NOTE: original Leaflet layers control removed — we provide an
  // independent Tracks/Parking control below so it remains visible
  // even when the default layers UI is not needed.
  // Add a small independent Leaflet control with buttons to toggle
  // Tracks and Parking so they remain visible even when the layers
  // control is hidden.
    var TracksParkingControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function () {
        var container = L.DomUtil.create('div', 'leaflet-bar layers-toggle-wrap');

        function createBtn(id, title, svgHtml, layerGroup) {
          var a = L.DomUtil.create('a', 'layers-toggle-btn', container);
          a.href = '#';
          a.title = title;
          a.dataset.layerId = id;
          // insert inline SVG (svgHtml should be a safe fragment string)
          a.innerHTML = svgHtml;
          L.DomEvent.disableClickPropagation(a);

          function setState(on) {
            if (on) {
              L.DomUtil.addClass(a, 'active');
              if (!map.hasLayer(layerGroup)) map.addLayer(layerGroup);
            } else {
              L.DomUtil.removeClass(a, 'active');
              if (map.hasLayer(layerGroup)) map.removeLayer(layerGroup);
            }
          }

          L.DomEvent.on(a, 'click', function (ev) { ev.preventDefault(); setState(!map.hasLayer(layerGroup)); });

          // reflect external changes
          map.on('overlayadd overlayremove', function () { setState(map.hasLayer(layerGroup)); });

          // initial
          setState(map.hasLayer(layerGroup));
          return a;
        }

        // SVG icons: a simple curving-track/path icon, and a parking 'P' badge
        var trackSvg = '<img src="icons/track.png" width="18" height="18" alt="Tracks">';
        var parkingSvg = '<img src="icons/parking.png" width="18" height="18" alt="Parking">';
        var directionSvg = '<img src="icons/direction.png" width="18" height="18" alt="Direction">';
        createBtn('tracks', 'Показать/скрыть треки', trackSvg, trackLayerGroup);
        createBtn('parking', 'Показать/скрыть стоянки', parkingSvg, parkingLayerGroup);
        
        // Direction toggle button
        var directionBtn = L.DomUtil.create('a', 'layers-toggle-btn', container);
        directionBtn.href = '#';
        directionBtn.title = directionsVisible ? 'Скрыть направление' : 'Показать направление';
        directionBtn.innerHTML = directionSvg;
        L.DomEvent.disableClickPropagation(directionBtn);
        L.DomEvent.on(directionBtn, 'click', function(ev) {
          ev.preventDefault();
          directionsVisible = !directionsVisible;
          if (directionsVisible) {
            if (!directionDecorator) directionDecorator = L.layerGroup();
            trackLayerGroup.addLayer(directionDecorator);
            directionBtn.title = 'Скрыть направление';
            L.DomUtil.addClass(directionBtn, 'active');
          } else if (directionDecorator) {
            trackLayerGroup.removeLayer(directionDecorator);
            directionBtn.title = 'Показать направление';
            L.DomUtil.removeClass(directionBtn, 'active');
          }
        });
        // Initial state
        if (directionsVisible) {
          L.DomUtil.addClass(directionBtn, 'active');
        }
        return container;
      }
    });
    map.addControl(new TracksParkingControl());
}

// --- Map resize handle logic (migrated from legacy script.js) ---
(function attachResize(){
  if(typeof document==='undefined') return;
  var handle= document.getElementById('resizeHandle');
  var container = document.getElementById('mapContainer');
  var mapDivEl = document.getElementById('map');
  if(!handle||!container||!mapDivEl) return;
  var resizing=false;
  handle.addEventListener('mousedown', function(e){ e.preventDefault(); resizing=true; document.body.style.cursor='ns-resize'; document.body.style.userSelect='none'; });
  document.addEventListener('mousemove', function(e){
    if(!resizing) return;
    var top = container.getBoundingClientRect().top;
    var newH = e.clientY - top; if(newH<150) newH=150; if(newH> window.innerHeight-100) newH = window.innerHeight-100;
    container.style.height=newH+'px'; mapDivEl.style.height=newH+'px'; if(map){ map.invalidateSize(); }
  });
  document.addEventListener('mouseup', function(){ if(!resizing) return; resizing=false; document.body.style.cursor=''; document.body.style.userSelect=''; if(map) map.invalidateSize(); });
})();

// --- Filter panel collapse toggle (migrated) ---
(function attachFilterPanelToggle(){
  var panel = document.getElementById('filterPanel');
  var btn = document.getElementById('filterPanelToggle');
  if(!panel||!btn) return;
  if(btn.dataset.bound) return; // avoid double
  btn.addEventListener('click', function(){
    var collapsed = panel.classList.toggle('collapsed');
    btn.textContent = collapsed ? '▶' : '◀';
    setTimeout(function(){ if(map) map.invalidateSize(); }, 300);
  });
  btn.dataset.bound='1';
})();
function currentLineWidth(){ var v=parseInt(lineWidthSlider?lineWidthSlider.value:'2',10); return isNaN(v)?2:v; }
function updateAllLineWidths(){ var w=currentLineWidth(); if(lineWidthValue) lineWidthValue.textContent=String(w); if(routeRoadPolyline){ routeRoadPolyline.setStyle({weight:w+1}); } if(trackLayerGroup){ trackLayerGroup.eachLayer(function(layer){ if(layer instanceof L.Polyline){ if(layer===routeRoadPolyline) return; layer.setStyle({weight:w}); }});} if(previouslySelectedLayer){ previouslySelectedLayer.setStyle({weight:w+3}); } if(directionsVisible){ rebuildDirections(); } }
if(lineWidthSlider){ lineWidthSlider.addEventListener('input', updateAllLineWidths); }
function rebuildDirections(){
  try{
    // Fixed arrow size: slider value 1 corresponds to small arrows; use pixelSize=6
    var arrowSize = 6;
    var offset = arrowSize * 2; // distance from segment start
    var repeat = arrowSize * 8; // spacing between arrows
    if(directionDecorator){ try{ trackLayerGroup.removeLayer(directionDecorator);}catch(_){}}
    directionDecorator = L.layerGroup();
    if(trackLayerGroup){
      trackLayerGroup.eachLayer(function(layer){
        if(layer instanceof L.Polyline){
          var latlngs = layer.getLatLngs();
          var lengthOk = false;
          if(Array.isArray(latlngs)){
            if(latlngs.length>1) lengthOk=true;
            else if(latlngs.length===1 && Array.isArray(latlngs[0]) && latlngs[0].length>1) lengthOk=true;
          }
          if(!lengthOk) return;
          var color = (layer.options && layer.options.color) || '#000';
          var deco = L.polylineDecorator(layer,{
            patterns:[{ offset: offset, repeat: repeat, symbol: L.Symbol.arrowHead({ pixelSize: arrowSize, pathOptions: { fillOpacity:1, weight:0, color: color } }) }]
          });
          directionDecorator.addLayer(deco);
        }
      });
    }
    if(directionsVisible){ trackLayerGroup.addLayer(directionDecorator); }
  } catch(err){ console.warn('Failed to rebuild directions', err); }
}
