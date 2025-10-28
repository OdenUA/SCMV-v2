// memory.js - Memory management system for SCMV v2
// Centralized memory management to prevent leaks

(function() {
  'use strict';

  // Limits for automatic cleanup (number of records)
  var LIMITS = {
    trackPoints: 15000,      // max points in window._trackData
    fullTrackCache: 15000,   // max entries in _fullTrackCache
    tableRows: 5000,         // max rows in DOM tables
    markers: 2000            // max markers on map
  };

  // Counters for monitoring
  var memoryStats = {
    trackDataSize: 0,
    fullCacheSize: 0,
    tableRowCount: 0,
    markerCount: 0,
    lastCleanup: null
  };

  // Device history for tracking switches
  var deviceHistory = [];
  var MAX_DEVICE_HISTORY = 2;

  /**
   * Deep cleanup of track data and related structures (without clearing markers)
   */
  window.deepCleanTrackData = function() {
    console.log('[Memory] Начало глубокой очистки...');
    var freed = 0;

    try {
      // 1. Clear global data arrays
      if (window._trackData && window._trackData.length > 0) {
        freed += window._trackData.length;
        window._trackData.length = 0;
        window._trackData = [];
      }

      if (window._mileageData && window._mileageData.length > 0) {
        freed += window._mileageData.length;
        window._mileageData.length = 0;
        window._mileageData = [];
      }

      // 2. Clear full track cache
      if (typeof window._fullTrackCache !== 'undefined') {
        if (window._fullTrackCache && window._fullTrackCache.length > 0) {
          freed += window._fullTrackCache.length;
        }
        window._fullTrackCache = null;
      }

      // 3. Clear intervals cache
      if (typeof window._fullIntervals !== 'undefined') {
        window._fullIntervals = [];
      }
      if (typeof window._focusedIntervalIndex !== 'undefined') {
        window._focusedIntervalIndex = null;
      }

      // 4. Reset state flags
      if (typeof window._devLogRequestedFull !== 'undefined') {
        window._devLogRequestedFull = false;
      }
      if (typeof window._awaitingFullTrackSetupSegments !== 'undefined') {
        window._awaitingFullTrackSetupSegments = null;
      }

      memoryStats.lastCleanup = new Date();
      console.log('[Memory] Очистка завершена. Освобождено объектов:', freed);
      
      // Force garbage collection (if available)
      if (window.gc) {
        try {
          window.gc();
          console.log('[Memory] Сборка мусора выполнена');
        } catch(e) {}
      }

      return freed;
    } catch(e) {
      console.error('[Memory] Ошибка при глубокой очистке:', e);
      return 0;
    }
  };

  /**
   * Clear all markers and layers (called only on device/date switch)
   */
  window.clearTrackMarkers = function() {
    console.log('[Memory] Очистка маркеров и слоев...');
    var freed = 0;

    try {
      // 1. Clear Track Raw indexes and markers
      if (window._trackMarkersByTs) {
        var markerCount = Object.keys(window._trackMarkersByTs).length;
        freed += markerCount;
        // Remove all markers from map
        for (var ts in window._trackMarkersByTs) {
          try {
            var m = window._trackMarkersByTs[ts];
            if (m && trackLayerGroup) {
              trackLayerGroup.removeLayer(m);
            }
          } catch(e) {}
        }
        window._trackMarkersByTs = {};
      }

      if (window._fullTrackIndexByTs) {
        window._fullTrackIndexByTs = {};
      }

      // 2. Clear spike layers (speed anomalies)
      if (window._rawTrackSpikeLayers && Array.isArray(window._rawTrackSpikeLayers)) {
        window._rawTrackSpikeLayers.forEach(function(layer) {
          try {
            if (trackLayerGroup) trackLayerGroup.removeLayer(layer);
          } catch(e) {}
        });
        window._rawTrackSpikeLayers = [];
      }

      // 3. Clear nearest marker
      if (window._trackNearestMarker && trackLayerGroup) {
        try {
          trackLayerGroup.removeLayer(window._trackNearestMarker);
          window._trackNearestMarker = null;
        } catch(e) {}
      }

      if (window._rawTrackNearestMarker && trackLayerGroup) {
        try {
          trackLayerGroup.removeLayer(window._rawTrackNearestMarker);
          window._rawTrackNearestMarker = null;
        } catch(e) {}
      }

      // 4. Full clear of Leaflet layer groups
      if (trackLayerGroup) {
        try {
          trackLayerGroup.clearLayers();
        } catch(e) {
          console.warn('[Memory] Ошибка очистки trackLayerGroup', e);
        }
      }

      if (parkingLayerGroup) {
        try {
          parkingLayerGroup.clearLayers();
        } catch(e) {}
      }

      console.log('[Memory] Очищено маркеров:', freed);
      return freed;
    } catch(e) {
      console.error('[Memory] Ошибка очистки маркеров:', e);
      return 0;
    }
  };

  /**
   * Partial cleanup of DOM tables (keeps headers)
   */
  window.cleanupTableMemory = function() {
    console.log('[Memory] Очистка таблиц...');
    var cleaned = 0;

    try {
      // Device Alarm & Device Log tables
      var tables = [
        { head: 'deviceAlarmThead', body: 'deviceAlarmTbody', name: 'Device Alarm' },
        { head: 'deviceLogThead', body: 'deviceLogTbody', name: 'Device Log' },
        { head: 'fullHead', body: 'fullBody', name: 'Full Track' }
      ];

      tables.forEach(function(tbl) {
        try {
          var tbody = window[tbl.body] || document.getElementById(tbl.body);
          if (tbody && tbody.children && tbody.children.length > LIMITS.tableRows) {
            console.log('[Memory] Table ' + tbl.name + ' exceeded limit: ' + tbody.children.length);
            cleaned += tbody.children.length;
            tbody.innerHTML = '<tr><td>Очищено для экономии памяти (было ' + tbody.children.length + ' строк)</td></tr>';
          }
        } catch(e) {}
      });

      if (cleaned > 0) {
        console.log('[Memory] Очищено строк в таблицах:', cleaned);
      }
    } catch(e) {
      console.error('[Memory] Ошибка очистки таблиц:', e);
    }

    return cleaned;
  };

  /**
   * Smart cleanup: only when limits are exceeded
   */
  window.smartMemoryCleanup = function() {
    console.log('[Memory] Checking memory limits...');
    
    var needsCleanup = false;
    var reasons = [];

    // Check _trackData size
    if (window._trackData && window._trackData.length > LIMITS.trackPoints) {
      needsCleanup = true;
      reasons.push('_trackData: ' + window._trackData.length + ' > ' + LIMITS.trackPoints);
    }

    // Check _fullTrackCache
    if (window._fullTrackCache && window._fullTrackCache.length > LIMITS.fullTrackCache) {
      needsCleanup = true;
      reasons.push('_fullTrackCache: ' + window._fullTrackCache.length + ' > ' + LIMITS.fullTrackCache);
    }

    // Check markers
    if (window._trackMarkersByTs) {
      var count = Object.keys(window._trackMarkersByTs).length;
      if (count > LIMITS.markers) {
        needsCleanup = true;
        reasons.push('markers: ' + count + ' > ' + LIMITS.markers);
      }
    }

    if (needsCleanup) {
      console.warn('[Memory] Limits exceeded:', reasons.join(', '));
      showRouteToast('⚠️ Очистка памяти...', 2000);
      window.deepCleanTrackData();
      window.cleanupTableMemory();
      return true;
    }

    console.log('[Memory] Limits not exceeded');
    return false;
  };

  /**
   * Track device switching
   */
  window.trackDeviceSwitch = function(deviceId) {
    if (!deviceId) return;

    var lastDevice = deviceHistory.length > 0 ? deviceHistory[deviceHistory.length - 1] : null;
    
    if (lastDevice !== deviceId) {
      console.log('[Memory] Переключение устройства: ' + lastDevice + ' → ' + deviceId);
      deviceHistory.push(deviceId);
      
      // Limit history size
      if (deviceHistory.length > MAX_DEVICE_HISTORY) {
        deviceHistory.shift();
      }

      // Automatic cleanup after switching
      setTimeout(function() {
        console.log('[Memory] Автоочистка после переключения устройства');
        window.clearTrackMarkers();
        window.deepCleanTrackData();
      }, 100);
    }
  };

  /**
   * Get memory statistics
   */
  window.getMemoryStats = function() {
    var stats = {
      trackData: window._trackData ? window._trackData.length : 0,
      fullCache: window._fullTrackCache ? window._fullTrackCache.length : 0,
      markers: window._trackMarkersByTs ? Object.keys(window._trackMarkersByTs).length : 0,
      deviceHistory: deviceHistory.slice(),
      lastCleanup: memoryStats.lastCleanup,
      performance: {}
    };

    // Try to get memory info (Chrome only)
    if (performance && performance.memory) {
      stats.performance = {
        usedJSHeapSize: (performance.memory.usedJSHeapSize / 1048576).toFixed(2) + ' MB',
        totalJSHeapSize: (performance.memory.totalJSHeapSize / 1048576).toFixed(2) + ' MB',
        jsHeapSizeLimit: (performance.memory.jsHeapSizeLimit / 1048576).toFixed(2) + ' MB'
      };
    }

    return stats;
  };

  /**
   * "Clear memory" button in UI
   */
  window.addMemoryCleanupButton = function() {
    try {
      var container = document.querySelector('.controls');
      if (!container) return;

      // Check if already added
      if (document.getElementById('memoryCleanupBtn')) return;

      var btn = document.createElement('button');
      btn.id = 'memoryCleanupBtn';
      btn.textContent = '🧹 Очистить память';
      btn.title = 'Принудительная очистка данных треков и таблиц для освобождения памяти';
      btn.style.marginLeft = '10px';
      btn.style.backgroundColor = '#6c757d';
      
      btn.addEventListener('click', function() {
        if (confirm('Очистить все данные треков и таблиц?\n\nЭто освободит память, но потребует повторной загрузки данных.')) {
          var freed = window.clearTrackMarkers();
          freed += window.deepCleanTrackData();
          window.cleanupTableMemory();
          
          // Show statistics
          var stats = window.getMemoryStats();
          var msg = '✅ Память очищена\n\nОсвобождено объектов: ' + freed;
          if (stats.performance.usedJSHeapSize) {
            msg += '\n\nИспользуется: ' + stats.performance.usedJSHeapSize;
          }
          alert(msg);
        }
      });

      container.appendChild(btn);
      console.log('[Memory] Кнопка очистки памяти добавлена');
    } catch(e) {
      console.error('[Memory] Ошибка добавления кнопки:', e);
    }
  };

  /**
   * Automatic memory monitoring (every 30 seconds)
   */
  var monitoringInterval = null;
  window.startMemoryMonitoring = function() {
    if (monitoringInterval) return; // already running

    console.log('[Memory] Запуск мониторинга памяти');
    
    monitoringInterval = setInterval(function() {
      var stats = window.getMemoryStats();
      
      // Log only if there is data
      if (stats.trackData > 0 || stats.fullCache > 0) {
        console.log('[Memory] Статистика:', 
          'TrackData=' + stats.trackData,
          'FullCache=' + stats.fullCache,
          'Markers=' + stats.markers,
          stats.performance.usedJSHeapSize ? ('Heap=' + stats.performance.usedJSHeapSize) : ''
        );
      }

      // Smart auto-cleanup if limits exceeded
      window.smartMemoryCleanup();
    }, 30000); // every 30 seconds
  };

  window.stopMemoryMonitoring = function() {
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
      monitoringInterval = null;
      console.log('[Memory] Мониторинг остановлен');
    }
  };

  // Auto-start on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() {
        window.addMemoryCleanupButton();
        window.startMemoryMonitoring();
      }, 1000);
    });
  } else {
    setTimeout(function() {
      window.addMemoryCleanupButton();
      window.startMemoryMonitoring();
    }, 1000);
  }

  console.log('[Memory] Модуль управления памятью загружен');
})();
