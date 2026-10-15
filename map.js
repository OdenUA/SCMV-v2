// Map initialization & line width
var startIcon = L.divIcon({className:'custom-div-icon', html:"<div style='background-color:#198754;' class='marker-pin'></div><span style='font-size: 24px;'>🟢</span>", iconSize:[30,42], iconAnchor:[15,42]});
var endIcon = L.divIcon({className:'custom-div-icon', html:"<div style='background-color:#dc3545;' class='marker-pin'></div><span style='font-size: 24px;'>🏁</span>", iconSize:[30,42], iconAnchor:[15,42]});
// Заменяет подписи на карте на украинские: вместо "name:latin name:nonlatin" ("Київ Kyiv") берётся name:uk
function applyUkrainianLabels(glMap){
  try{
    var layers = glMap.getStyle().layers;
    for (var i = 0; i < layers.length; i++){
      var tf = layers[i].layout && layers[i].layout['text-field'];
      if (tf !== undefined && JSON.stringify(tf).indexOf('name:latin') !== -1){
        glMap.setLayoutProperty(layers[i].id, 'text-field', ['coalesce', ['get','name:uk'], ['get','name']]);
      }
    }
  }catch(e){ console.warn('Не удалось установить украинские подписи:', e); }
}
function initMap(){
  if (map) return;
  map = L.map('map').setView([49.33,28.35],7);
  
  var osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19, attribution:'© OpenStreetMap'});
  var maplibreLayer = L.maplibreGL({
    style: 'https://tiles.openfreemap.org/styles/liberty',
    attribution: '© OpenStreetMap contributors &copy; <a href="https://openfreemap.org">OpenFreeMap</a>'
  });
  // При каждом добавлении слоя на карту (MapLibre создаёт/пересоздаёт GL-экземпляр) ставим украинские подписи
  maplibreLayer.on('add', function(){
    var glMap = maplibreLayer.getMaplibreMap();
    if (!glMap) return;
    if (glMap.loaded && glMap.loaded()) applyUkrainianLabels(glMap);
    else glMap.once('load', function(){ applyUkrainianLabels(glMap); });
  });

  osmLayer.addTo(map); // default

  var baseMaps = {
      "OSM (растровая)": osmLayer,
      "MapLibre (векторная)": maplibreLayer
  };
  L.control.layers(baseMaps, null, { position: 'topleft' }).addTo(map);

  trackLayerGroup = L.layerGroup().addTo(map);
  parkingLayerGroup = L.layerGroup().addTo(map); // Initialize and add to map

  // Custom route control
  var RouteControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function () {
      var container = L.DomUtil.create('div', 'leaflet-bar rt-control');

  var toggle = L.DomUtil.create('a', 'rt-toggle', container);
  toggle.href = '#';
  toggle.title = 'Режим построения маршрута';
  toggle.innerHTML = '📍';

  var reset = L.DomUtil.create('a', 'rt-reset', container);
      reset.href = '#';
      reset.title = 'Сбросить маршрут';
      reset.innerHTML = '⟳';

      L.DomEvent.disableClickPropagation(container);

      L.DomEvent.on(toggle, 'click', function (e) {
        e.preventDefault();
        if (!routeModeActive) {
          startRouteMode();
        } else {
          if (routeClickCount >= 2) {
            buildGoogleMapsRouteManual();
            stopRouteMode();
          } else {
            stopRouteMode();
          }
        }
        updateRouteButton();
      });

      L.DomEvent.on(reset, 'click', function (e) {
        e.preventDefault();
        resetManualRoute();
      });

      routeControlRef = container;
      updateRouteButton();
      return container;
    }
  });
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
            try { rebuildDirections(); } catch (e) { console.warn('rebuildDirections после включения не удался', e); }
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
    // При зуме пересоздаём стрелки, чтобы их плотность на экране была постоянной;
    // при панорамировании дорисовываем стрелки на ранее скрытых участках
    map.on('zoomend', onDirectionZoomEnd);
    map.on('moveend', onDirectionMoveEnd);

    initMapContextMenu();
}

// --- Кастомное контекстное меню карты (правый клик) ---
// Заменяет стандартное меню браузера: Leaflet подавляет его, когда на карте
// есть слушатель события 'contextmenu'.
function initMapContextMenu(){
  if(!map) return;
  var menu = document.getElementById('mapContextMenu');
  if(!menu){
    menu = document.createElement('div');
    menu.id = 'mapContextMenu';
    menu.className = 'map-context-menu';
    menu.style.display = 'none';
    document.body.appendChild(menu);
  }
  var clickLatLng = null;

  function hideMenu(){ menu.style.display = 'none'; }

  function fallbackCopy(text, onDone){
    var ok = false;
    try{
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    }catch(e){ ok = false; }
    onDone(ok);
  }
  function copyText(text, onDone){
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(function(){ onDone(true); }, function(){ fallbackCopy(text, onDone); });
      } else {
        fallbackCopy(text, onDone);
      }
    }catch(e){ fallbackCopy(text, onDone); }
  }

  function showMenu(clientX, clientY, latlng){
    clickLatLng = latlng;
    menu.innerHTML = '';
    var item = document.createElement('div');
    item.className = 'map-context-menu-item';
    item.textContent = latlng.lat.toFixed(6) + ', ' + latlng.lng.toFixed(6);
    L.DomEvent.on(item, 'click', function(ev){
      L.DomEvent.stop(ev);
      hideMenu();
      if(!clickLatLng) return;
      var text = clickLatLng.lat.toFixed(6) + ', ' + clickLatLng.lng.toFixed(6);
      copyText(text, function(ok){
        try{
          if(typeof showRouteToast === 'function'){
            showRouteToast(ok ? ('Скопировано: ' + text) : 'Не удалось скопировать координаты', 2000);
          }
        }catch(_){ }
      });
    });
    menu.appendChild(item);

    // Построение маршрута: дублирует существующий функционал route.js
    var routeItem = document.createElement('div');
    routeItem.className = 'map-context-menu-item';
    var routeActive = !!window.routeModeActive;
    routeItem.textContent = routeActive ? 'Маршрут: добавить точку' : 'Маршрут: начать отсюда';
    L.DomEvent.on(routeItem, 'click', function(ev){
      L.DomEvent.stop(ev);
      hideMenu();
      if(!clickLatLng) return;
      try{
        if(!window.routeModeActive && typeof startRouteMode === 'function') startRouteMode();
        if(typeof onRouteMapClick === 'function') onRouteMapClick({ latlng: clickLatLng });
      }catch(err){ console.warn('route menu item failed', err); }
    });
    menu.appendChild(routeItem);

    // Если точек уже достаточно — пункт завершения (как повторный клик по кнопке 📍)
    if (routeActive && (window.routeClickCount || 0) >= 2) {
      var buildItem = document.createElement('div');
      buildItem.className = 'map-context-menu-item';
      buildItem.textContent = 'Маршрут: завершить и построить (' + window.routeClickCount + ' точек)';
      L.DomEvent.on(buildItem, 'click', function(ev){
        L.DomEvent.stop(ev);
        hideMenu();
        try{
          if(typeof buildGoogleMapsRouteManual === 'function') buildGoogleMapsRouteManual();
          if(typeof stopRouteMode === 'function') stopRouteMode();
        }catch(err){ console.warn('build route menu item failed', err); }
      });
      menu.appendChild(buildItem);
    }

    menu.style.display = 'block';
    // не выпускаем меню за край окна
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var x = clientX, y = clientY;
    if(x + mw > window.innerWidth) x = Math.max(0, window.innerWidth - mw - 4);
    if(y + mh > window.innerHeight) y = Math.max(0, window.innerHeight - mh - 4);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  }

  // клики по самому меню не должны доходить до карты
  L.DomEvent.disableClickPropagation(menu);
  L.DomEvent.on(menu, 'contextmenu', function(ev){ L.DomEvent.stop(ev); });

  map.on('contextmenu', function(e){
    if(!e || !e.latlng) return;
    var oe = e.originalEvent || {};
    showMenu(oe.clientX || 0, oe.clientY || 0, e.latlng);
  });
  map.on('click movestart zoomstart dragstart', hideMenu);
  document.addEventListener('click', hideMenu);
  document.addEventListener('keydown', function(ev){ if(ev.key === 'Escape') hideMenu(); });
  window.addEventListener('blur', hideMenu);
}

// --- Map resize handle logic (migrated from legacy script.js) ---
(function attachResize(){
  if(typeof document==='undefined') return;
  var handle= document.getElementById('resizeHandle');
  var container = document.getElementById('mapContainer');
  var mapDivEl = document.getElementById('map');
  if(!handle||!container||!mapDivEl) return;
  var resizing=false;
  function startResize(y){
    resizing=true; document.body.style.cursor='ns-resize'; document.body.style.userSelect='none';
  }
  function doResize(y){
    if(!resizing) return;
    var top = container.getBoundingClientRect().top;
    var newH = y - top; if(newH<150) newH=150; if(newH> window.innerHeight-100) newH = window.innerHeight-100;
    container.style.height=newH+'px'; mapDivEl.style.height=newH+'px'; if(map){ map.invalidateSize(); }
  }
  function endResize(){
    if(!resizing) return; resizing=false; document.body.style.cursor=''; document.body.style.userSelect=''; if(map) map.invalidateSize();
  }
  handle.addEventListener('mousedown', function(e){ e.preventDefault(); startResize(e.clientY); });
  document.addEventListener('mousemove', function(e){ doResize(e.clientY); });
  document.addEventListener('mouseup', endResize);
  handle.addEventListener('touchstart', function(e){ e.preventDefault(); startResize(e.touches[0].clientY); }, {passive:false});
  document.addEventListener('touchmove', function(e){ doResize(e.touches[0].clientY); }, {passive:false});
  document.addEventListener('touchend', endResize);
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
function updateAllLineWidths(){
  var w=currentLineWidth();
  if(lineWidthValue) lineWidthValue.textContent=String(w);
  if(routeRoadPolyline){ routeRoadPolyline.setStyle({weight:w+1}); }
  function updateLayer(layer){
    if(layer instanceof L.LayerGroup || layer instanceof L.FeatureGroup){
      layer.eachLayer(updateLayer);
    } else if(layer instanceof L.Polyline){
      if(layer===routeRoadPolyline) return;
      var newWeight = w;
      if(layer._isAnalysisAnomaly){
        newWeight = Math.max(w * 3 + 2, 3);
      } else if(layer._isAnalysisPolyline){
        newWeight = w * 3;
      }
      layer.setStyle({weight:newWeight});
    }
  }
  if(trackLayerGroup){ trackLayerGroup.eachLayer(updateLayer); }
  if(previouslySelectedLayer){ previouslySelectedLayer.setStyle({weight:w+3}); }
  // стрелки пересобираем целиком: их размер зависит от толщины линий,
  // refreshZoomArrows обновит и трековые, и зарегистрированные (mileage)
  if(directionsVisible){ refreshZoomArrows(); }
}
if(lineWidthSlider){ lineWidthSlider.addEventListener('input', updateAllLineWidths); }
// === Умные стрелки направления ===
// Раньше стрелки ставились с фиксированным repeat (48px) на каждую полилинию,
// включая короткие "зигзаги" GPS-шума и аномальные сегменты — в местах поворотов
// и сбоев получалось "месиво". Теперь:
//  - интервал задан в метрах (через масштаб текущего зума) и конвертируется
//    в пиксельные offset'ы; при зуме декораторы пересоздаются (debounce),
//    плотность стрелок на экране держится постоянной;
//  - стрелки ставятся только на значимые сегменты (длиннее DIR_ARROW_MIN_SEG_M),
//    поэтому шумовые микро-сегменты и кластеры стоянок остаются чистыми;
//  - самоперерисовка плагина на moveend отключена: с устаревшими offset'ами
//    он экстраполирует стрелки за конец линии;
//  - линии значимой длины (>= DIR_ARROW_MIN_LINE_M) всегда получают хотя бы
//    одну стрелку — включая линии разрывов на мелком зуме;
//  - суммарное число стрелок ограничено бюджетом DIR_ARROW_TOTAL_BUDGET,
//    который распределяется между линиями пропорционально длине: без него
//    на близком зуме рисуется десятки тысяч SVG-символов и карта тормозит;
//  - для Analyze действует отдельный облегчённый режим (режим анализа рисует
//    много толстых линий, плотные стрелки там не нужны): интервал шире,
//    потолок на линию и бюджет ниже — см. DIR_ARROW_ANALYZE_*;
//  - если стрелок по длине линии выходит больше DIR_ARROW_VIEWPORT_MIN,
//    они ставятся только в видимой области экрана (с запасом): плотность
//    держится на любом зуме, а число символов не растёт с длиной линии.
//    При панорамировании стрелки пересобираются (onDirectionMoveEnd).
var DIR_ARROW_MIN_SEG_M = 10;      // сегменты короче — GPS-шум, стрелки не ставим
var DIR_ARROW_SPACING_PX = 55;     // целевой экранный интервал между стрелками
var DIR_ARROW_MIN_SPACING_M = 25;  // минимальный интервал в метрах (крупные зумы)
var DIR_ARROW_MAX_PER_LINE = 1200; // потолок стрелок на одну линию
var DIR_ARROW_MIN_LINE_M = 300;    // линии короче стрелками не помечаются
var DIR_ARROW_TOTAL_BUDGET = 3000; // потолок стрелок на карту (производительность)
var DIR_ARROW_ANALYZE_SPACING_PX = 150; // интервал стрелок в Analyze (реже, чем у трека)
var DIR_ARROW_ANALYZE_MAX_PER_LINE = 60; // потолок стрелок на линию в Analyze
var DIR_ARROW_ANALYZE_BUDGET = 800;     // бюджет стрелок Analyze на карту
var DIR_ARROW_VIEWPORT_MIN = 100;  // больше стрелок на линию — только видимая область
var DIR_ARROW_VIEWPORT_PAD_PX = 80; // запас за края экрана при размещении стрелок
var _smartArrowRegistry = [];      // {owner, layer, color, opts, deco}
var _dirArrowZoomTimer = null;

function dirArrowMetersPerPixel(){
  try{
    var lat = map.getCenter().lat;
    return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, map.getZoom());
  }catch(e){ return 1; }
}

// Базовый размер стрелок привязан к толщине линий (слайдер «Толщина линий»):
// толщина 2 (по умолчанию) -> стрелки 6px. В Analyze стрелки втрое крупнее.
function dirArrowBaseSize(){
  try{
    var w = (typeof currentLineWidth === 'function') ? currentLineWidth() : 2;
    if(!(w > 0)) w = 2;
    return Math.max(3, Math.round(w * 3));
  }catch(e){ return 6; }
}
function dirArrowAnalyzeSize(){
  return dirArrowBaseSize() * 3;
}

function flattenLatLngs(input, out){
  if(!input) return;
  for(var i = 0; i < input.length; i++){
    var item = input[i];
    if(Array.isArray(item)){ flattenLatLngs(item, out); }
    else if(item && typeof item.lat === 'number'){ out.push(item); }
  }
}

// Слои, на которых стрелки направления не нужны. Аномальные сегменты, линии
// анализа и линии разрывов стрелками помечаются (короткие всё равно
// отфильтруются по длине) — исключаем только слои со собственными стрелками.
function shouldSkipDirectionArrows(layer){
  if(!layer) return true;
  if(layer === directionDecorator) return true;
  if(layer._ownDirectionArrows) return true;
  return false;
}

// Создаёт декоратор со стрелками для полилинии с учётом текущего зума.
// Возвращает null, если стрелки не нужны (короткая линия / один шум).
function createSmartArrowDecorator(layer, color, opts){
  try{
    var latlngs = [];
    flattenLatLngs(layer.getLatLngs(), latlngs);
    if(latlngs.length < 2) return null;
    var mpp = dirArrowMetersPerPixel();
    if(!(mpp > 0) || !isFinite(mpp)) return null;
    var spacingPx = (opts && opts.spacingPx) || DIR_ARROW_SPACING_PX;
    var spacingM = Math.max(spacingPx * mpp, DIR_ARROW_MIN_SPACING_M);
    var cum = new Array(latlngs.length);
    cum[0] = 0;
    for(var i = 1; i < latlngs.length; i++){
      cum[i] = cum[i - 1] + latlngs[i - 1].distanceTo(latlngs[i]);
    }
    var totalM = cum[latlngs.length - 1];
    if(!(totalM > 0) || !isFinite(totalM)) return null;
    if(totalM < DIR_ARROW_MIN_LINE_M) return null; // неразличимо / неинформативно
    var maxArrows = (opts && opts.maxArrows) || DIR_ARROW_MAX_PER_LINE;
    if(totalM / spacingM > maxArrows) spacingM = totalM / maxArrows;
    // Если стрелок по длине линии выходит больше порога — ставим только внутри
    // видимой области экрана (с запасом). Так плотность на видимом участке
    // держится при любом зуме, а число SVG-символов не растёт с длиной линии
    // (иначе на близком зуме стрелки размазаны по всей линии и на экране их
    // почти нет). Панорамирование дорисовывает onDirectionMoveEnd (пересборка).
    var viewBounds = null;
    if(Math.floor(totalM / spacingM) > DIR_ARROW_VIEWPORT_MIN){
      try {
        var size = map.getSize();
        var padF = DIR_ARROW_VIEWPORT_PAD_PX / Math.max(200, Math.min(size.x, size.y));
        viewBounds = map.getBounds().pad(padF);
      } catch(_) { viewBounds = null; }
    }
    // Позиции стрелок вдоль пути (в метрах). Стрелки ставятся только на
    // значимые сегменты; шумовые сегменты пропускаются без сдвига интервала.
    var positionsM = [];
    var nextM = spacingM * 0.5;
    for(var j = 1; j < latlngs.length && nextM <= totalM; j++){
      var segStartM = cum[j - 1], segEndM = cum[j];
      var segLenM = segEndM - segStartM;
      if(segLenM < DIR_ARROW_MIN_SEG_M) continue;  // шумовой сегмент
      // после пропущенной шумовой зоны продолжаем со значимого сегмента
      if(nextM < segStartM) nextM = segStartM;
      while(nextM <= segEndM){
        var inView = true;
        if(viewBounds){
          var t = (nextM - segStartM) / segLenM;
          var la = latlngs[j - 1], lb = latlngs[j];
          inView = viewBounds.contains([la.lat + (lb.lat - la.lat) * t, la.lng + (lb.lng - la.lng) * t]);
        }
        if(inView) positionsM.push(nextM);
        nextM += spacingM;
      }
    }
    // На мелком зуме интервал больше длины линии — ставим одну стрелку
    // посередине (если середина — не шумовой сегмент), чтобы линии разрывов
    // и короткие сегменты не оставались без индикации направления.
    // При размещении по видимой области (viewBounds) не применяем: линия
    // целиком за экраном не должна получать бесполезную стрелку посередине.
    if(!positionsM.length && !viewBounds){
      var midM = totalM * 0.5;
      for(var m = 1; m < latlngs.length; m++){
        if(cum[m] >= midM){
          if(cum[m] - cum[m - 1] >= DIR_ARROW_MIN_SEG_M) positionsM.push(midM);
          break;
        }
      }
    }
    if(!positionsM.length) return null;
    var arrowSize = (opts && opts.pixelSize) || dirArrowBaseSize();
    var patterns = [];
    for(var k = 0; k < positionsM.length; k++){
      patterns.push({
        offset: Math.max(1, Math.round(positionsM[k] / mpp)),
        symbol: L.Symbol.arrowHead({ pixelSize: arrowSize, pathOptions: { fillOpacity: 1, weight: 0, color: color } })
      });
    }
    var deco = L.polylineDecorator(layer, { patterns: patterns });
    // Отключаем самоперерисовку плагина на moveend: со старыми пиксельными
    // offset'ами (после зума) он экстраполирует стрелки за конец линии.
    // Обновлением стрелок управляем сами: refreshZoomArrows (зум) и
    // onDirectionMoveEnd (панорамирование) пересоздают декораторы.
    try { deco.redraw = function(){ }; } catch(_) {}
    return deco;
  }catch(e){ console.warn('createSmartArrowDecorator failed', e); return null; }
}

// Регистрация "внешних" стрелок (mileage-сегменты, пропуски), чтобы сниматься
// вместе с отчётом. При зуме пересчитываются вместе со стрелками трека.
function registerSmartArrows(owner, layer, color, opts){
  try{
    if(!directionDecorator) directionDecorator = L.layerGroup();
    var deco = createSmartArrowDecorator(layer, color, opts);
    if(!deco) return null;
    directionDecorator.addLayer(deco);
    _smartArrowRegistry.push({ owner: owner, layer: layer, color: color, opts: opts || null, deco: deco });
    return deco;
  }catch(e){ console.warn('registerSmartArrows failed', e); return null; }
}

function unregisterSmartArrows(owner){
  try{
    _smartArrowRegistry = _smartArrowRegistry.filter(function(entry){
      if(owner && entry.owner !== owner) return true;
      if(directionDecorator){ try{ directionDecorator.removeLayer(entry.deco); }catch(_){}}
      return false;
    });
  }catch(e){ console.warn('unregisterSmartArrows failed', e); }
}

// Длина полилинии в метрах (плоская геодезия Leaflet). -1 — декорировать нечего.
function measurePolylineLengthM(layer){
  try{
    var latlngs = [];
    flattenLatLngs(layer.getLatLngs(), latlngs);
    if(latlngs.length < 2) return -1;
    var total = 0;
    for(var i = 1; i < latlngs.length; i++){
      total += latlngs[i - 1].distanceTo(latlngs[i]);
    }
    return (total > 0 && isFinite(total)) ? total : -1;
  }catch(e){ return -1; }
}

// Распределяет квоты стрелок между кандидатами пропорционально длине.
// Линии с ненулевой квотой сохраняют хотя бы одну стрелку.
function computeArrowQuotas(candidates, spacingPx, perLineCap, budget){
  var spacingM = Math.max(spacingPx * dirArrowMetersPerPixel(), DIR_ARROW_MIN_SPACING_M);
  var natural = candidates.map(function(c){
    var n = Math.floor(c.totalM / spacingM);
    if(n > perLineCap) n = perLineCap;
    return n;
  });
  var sum = natural.reduce(function(a, b){ return a + b; }, 0);
  if(sum <= budget) return natural;
  var factor = budget / sum;
  return natural.map(function(n){
    return (n >= 1 && Math.floor(n * factor) < 1) ? 1 : Math.floor(n * factor);
  });
}

function rebuildDirections(){
  try{
    unregisterSmartArrows('track');
    if(!directionsVisible) return;
    if(!directionDecorator) directionDecorator = L.layerGroup();
    // Проход 1: собираем кандидатов и измеряем длину. Analyze выделяем
    // отдельно — у режима свой облегчённый профиль стрелок.
    var trackC = [];
    var analyzeC = [];
    function processLayer(layer){
      // декораторы стрелок не сканируем — иначе рекурсия попадает на символы-стрелки
      if(typeof L.PolylineDecorator !== 'undefined' && layer instanceof L.PolylineDecorator) return;
      if(layer instanceof L.LayerGroup || layer instanceof L.FeatureGroup){
        layer.eachLayer(processLayer);
        return;
      }
      if(!(layer instanceof L.Polyline)) return;
      if(shouldSkipDirectionArrows(layer)) return;
      var totalM = measurePolylineLengthM(layer);
      if(totalM < DIR_ARROW_MIN_LINE_M) return;
      // в Track Raw (режим точек) стрелки трека — чёрные, независимо от
      // цвета самой линии/точек (флаг ставится при отрисовке носителей)
      var color = layer._trackRawArrows ? '#000000' : ((layer.options && layer.options.color) || '#000');
      var item = { layer: layer, color: color, totalM: totalM };
      if(layer._isAnalysisPolyline || layer._isAnalysisAnomaly){
        analyzeC.push(item);
      } else {
        trackC.push(item);
      }
    }
    if(trackLayerGroup) trackLayerGroup.eachLayer(processLayer);
    // Квоты: обычный трек и Analyze — независимые бюджеты
    var quotasT = computeArrowQuotas(trackC, DIR_ARROW_SPACING_PX, DIR_ARROW_MAX_PER_LINE, DIR_ARROW_TOTAL_BUDGET);
    var quotasA = computeArrowQuotas(analyzeC, DIR_ARROW_ANALYZE_SPACING_PX, DIR_ARROW_ANALYZE_MAX_PER_LINE, DIR_ARROW_ANALYZE_BUDGET);
    // Проход 2: создаём декораторы с выданной квотой
    function createFor(list, quotas, analyze){
      for(var i = 0; i < list.length; i++){
        if(quotas[i] < 1) continue;
        var c = list[i];
        var o = analyze
          ? { pixelSize: dirArrowAnalyzeSize(), spacingPx: DIR_ARROW_ANALYZE_SPACING_PX, maxArrows: quotas[i] }
          : { maxArrows: quotas[i] };
        var deco = createSmartArrowDecorator(c.layer, c.color, o);
        if(deco){
          directionDecorator.addLayer(deco);
          _smartArrowRegistry.push({ owner: 'track', layer: c.layer, color: c.color, opts: o, deco: deco });
        }
      }
    }
    createFor(trackC, quotasT, false);
    createFor(analyzeC, quotasA, true);
    if(directionsVisible && !trackLayerGroup.hasLayer(directionDecorator)){
      trackLayerGroup.addLayer(directionDecorator);
    }
  } catch(err){ console.warn('Failed to rebuild directions', err); }
}

// Пересчёт стрелок после зума: интервал держится постоянным в пикселях экрана.
function refreshZoomArrows(){
  try{
    if(!directionsVisible || !map) return;
    rebuildDirections(); // пересоздаёт записи owner === 'track'
    if(!directionDecorator) return;
    for(var i = _smartArrowRegistry.length - 1; i >= 0; i--){
      var entry = _smartArrowRegistry[i];
      if(entry.owner === 'track') continue;
      // слой уже снят с карты (старый отчёт) — выкидываем запись вместе со стрелками
      if(trackLayerGroup && entry.layer && !trackLayerGroup.hasLayer(entry.layer)){
        try{ directionDecorator.removeLayer(entry.deco); }catch(_){}
        _smartArrowRegistry.splice(i, 1);
        continue;
      }
      try{ directionDecorator.removeLayer(entry.deco); }catch(_){}
      var deco = createSmartArrowDecorator(entry.layer, entry.color, entry.opts);
      entry.deco = deco;
      if(deco) directionDecorator.addLayer(deco);
    }
  }catch(e){ console.warn('refreshZoomArrows failed', e); }
}
function onDirectionZoomEnd(){
  if(_dirArrowZoomTimer) clearTimeout(_dirArrowZoomTimer);
  _dirArrowZoomTimer = setTimeout(function(){
    _dirArrowZoomTimer = null;
    refreshZoomArrows();
  }, 150);
}
// Панорамирование (без смены зума): стрелки размещаются только в видимой
// области экрана, поэтому после панорамирования нужна полная пересборка —
// на вновь открывшемся участке стрелок ещё нет.
var _dirArrowMoveTimer = null;
function onDirectionMoveEnd(){
  try{
    if(!directionsVisible || !map || _dirArrowZoomTimer) return; // зум обрабатывает refreshZoomArrows
    if(_dirArrowMoveTimer) clearTimeout(_dirArrowMoveTimer);
    _dirArrowMoveTimer = setTimeout(function(){
      _dirArrowMoveTimer = null;
      refreshZoomArrows();
    }, 120);
  }catch(e){ console.warn('onDirectionMoveEnd failed', e); }
}


// Ensure map resizes correctly when browser window changes (e.g. orientation change on mobile)
try{
  window.addEventListener('resize', function(){
    if(map){ map.invalidateSize(); }
  });
}catch(e){ console.warn('Map resize listener failed', e); }
