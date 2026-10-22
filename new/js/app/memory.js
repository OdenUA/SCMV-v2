// Управление памятью: очистка при смене ТС, мониторинг, ручная очистка.

import { MEMORY_LIMITS } from '../core/config.js';
import { getTrackLayer, getParkingLayer, getAnomalyLayer, unregisterSmartArrows } from '../core/map-core.js';
import { state, on } from './state.js';

let lastDeviceId = null;
let monitorTimer = null;

export function initMemory() {
  on('vehicle-selected', (payload) => {
    const id = state.deviceId;
    if (lastDeviceId && lastDeviceId !== id) {
      cleanupOnDeviceSwitch();
    }
    lastDeviceId = id;
  });

  const cleanupBtn = document.getElementById('memoryCleanupBtn');
  if (cleanupBtn) {
    cleanupBtn.addEventListener('click', () => {
      if (!confirm('Очистить маркеры и данные треков/таблиц?')) return;
      const stats = fullCleanup();
      alert(`Очистка выполнена.\nТочек трека: ${stats.trackPoints}\nСтоянок: ${stats.stops}\nСтрок таблиц очищено.`);
    });
  }

  startMonitoring();
}

function cleanupOnDeviceSwitch() {
  // глубокая очистка данных предыдущего устройства (без UI-таблиц — они перезапишутся)
  state.trackPoints = [];
  state.anomalies = [];
  state.mileageSegments = [];
  state.stops = [];
  state.mileageTotalKm = 0;
  state.moveDurationMs = 0;
  state.stopDurationMs = 0;
  const tl = getTrackLayer();
  const pl = getParkingLayer();
  const al = getAnomalyLayer();
  if (tl) tl.clearLayers();
  if (pl) pl.clearLayers();
  if (al) al.clearLayers();
  // стрелки направлений предыдущего ТС: очистить реестр и пересобрать декораторы
  // (иначе стрелки остаются на карте после скрытия трека)
  unregisterSmartArrows();
  try { if (window.gc) window.gc(); } catch (e) { /* ignore */ }
}

function fullCleanup() {
  const stats = {
    trackPoints: state.trackPoints.length,
    stops: state.stops.length,
  };
  cleanupOnDeviceSwitch();
  // очистка больших таблиц
  ['stopsTbody', 'anomaliesTbody', 'deviceLogTbody', 'devlogReportTbody'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.__virtualTable) {
      try { el.__virtualTable.destroy(); } catch (e) { /* ignore */ }
    }
    if (el) el.innerHTML = '<tr><td colspan="100%">Очищено для экономии памяти.</td></tr>';
  });
  try { if (window.gc) window.gc(); } catch (e) { /* ignore */ }
  return stats;
}

function startMonitoring() {
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = setInterval(() => {
    try {
      const mem = performance.memory
        ? `used=${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)}MB total=${(performance.memory.totalJSHeapSize / 1048576).toFixed(1)}MB`
        : 'n/a';
      console.log(
        `[memory] track=${state.trackPoints.length}/${MEMORY_LIMITS.trackPoints} ` +
        `stops=${state.stops.length} anomalies=${state.anomalies.length} heap=${mem}`
      );
    } catch (e) { /* ignore */ }
  }, 30000);
}
