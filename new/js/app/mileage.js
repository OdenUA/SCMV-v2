// Mileage Report: сегменты пробега (чёрные/серые), пропуски (красный пунктир), старт/финиш.

import { onPacket, sendRequest } from '../core/ws.js';
import { getTrackLayer, getMap, makeStartIcon, makeFinishIcon, registerSmartArrows, unregisterSmartArrows } from '../core/map-core.js';
import { normalizeDateKey, parseRelativeDurationToMs, showToast } from '../core/utils.js';
import { state, emit } from './state.js';
import { refreshStopMarkers } from './stops.js';

let gapLayers = [];
let segmentLayers = [];
export const mileageStopCoords = {}; // normalizeDateKey(fdate) -> {coord, period}

export function initMileage() {
  onPacket('Mileage Report', (data) => {
    const rows = data.res && data.res[0] && data.res[0].f;
    if (!Array.isArray(rows)) return false;
    processMileageReport(rows);
    return true; // поглощаем
  });
}

export function requestMileageReport() {
  const { dateFrom, dateTo } = getDatesSafe();
  sendRequest({
    name: 'Mileage Report', type: 'map', mid: 2, act: 'filter',
    filter: [
      { selectedvihicleid: [state.deviceId] },
      { selectedpgdateto: [dateTo] },
      { selectedpgdatefrom: [dateFrom] },
    ],
    lang: 'en',
  });
}

function getDatesSafe() {
  const fromEl = document.getElementById('startDate');
  const toEl = document.getElementById('endDate');
  const build = (raw, isEnd) => {
    if (!raw) return '';
    if (raw.length === 16) raw += isEnd ? ':59' : ':00';
    return raw;
  };
  return {
    dateFrom: build(fromEl ? fromEl.value : '', false),
    dateTo: build(toEl ? toEl.value : '', true),
  };
}

export function clearMileage() {
  const layer = getTrackLayer();
  if (!layer) return;
  [...gapLayers, ...segmentLayers].forEach((g) => { try { layer.removeLayer(g); } catch (e) {} });
  gapLayers = [];
  segmentLayers = [];
  unregisterSmartArrows('mileage');
  unregisterSmartArrows('mileage-gap');
  Object.keys(mileageStopCoords).forEach((k) => delete mileageStopCoords[k]);
}

// Полный сброс состояния пробега (смена дат/устройства): слои + данные
export function resetMileageState() {
  clearMileage();
  state.mileageSegments = [];
  state.mileageTotalKm = 0;
  state.startstopTotalKm = 0;
  state.moveDurationMs = 0;
  state.stopDurationMs = 0;
  emit('mileage');
}

export function processMileageReport(segments) {
  const layer = getTrackLayer();
  if (!layer || !getMap()) return;

  clearMileage();
  state.mileageSegments = segments || [];
  state.mileageTotalKm = 0;
  state.moveDurationMs = 0;
  state.stopDurationMs = 0;

  const allCoords = [];

  (segments || []).forEach((seg, idx) => {
    const coords = seg.coordinates;
    if (!Array.isArray(coords) || !coords.length) return;

    // dest сегмента приходит в метрах
    const destValue = parseFloat(String(seg.dest != null ? seg.dest : '').replace(',', '.'));
    if (isFinite(destValue)) state.mileageTotalKm += destValue / 1000;

    const periodMs = parseRelativeDurationToMs(seg.period || '');
    if (isFinite(periodMs)) {
      if (seg.ismoved === false) state.stopDurationMs += periodMs;
      else state.moveDurationMs += periodMs;
    }

    const latlngs = coords
      .filter((c) => Array.isArray(c) && isFinite(c[0]) && isFinite(c[1]))
      .map((c) => {
        allCoords.push(c);
        return [c[0], c[1]];
      });
    if (!latlngs.length) return;

    const isStop = seg.ismoved === false;
    const color = isStop ? '#6b7280' : '#000000';
    const line = L.polyline(latlngs, { color, weight: 3, opacity: 0.85 }).addTo(layer);
    segmentLayers.push(line);
    line._ownDirectionArrows = !isStop;
    if (!isStop) registerSmartArrows('mileage', line, '#000000');

    const popupHtml =
      `<div class="popup-title">Сегмент ${idx + 1}${isStop ? ' (стоянка)' : ''}</div>` +
      `Начало: ${seg.fdate || '-'}<br>Конец: ${seg.tdate || '-'}<br>` +
      `Длительность: ${seg.period || '-'}<br>Пробег: ${seg.dest != null ? (destValue / 1000).toFixed(3) : '-'} км`;
    line.bindPopup(popupHtml);

    if (isStop) {
      mileageStopCoords[normalizeDateKey(seg.fdate)] = { coord: latlngs[0], period: seg.period || '' };
    }
  });

  // Старт/финиш (принадлежат пробегу; трек при отрисовке «перехватывает» их)
  const firstSeg = (segments || []).find((s) => Array.isArray(s.coordinates) && s.coordinates.length);
  const lastSeg = [...(segments || [])].reverse().find((s) => Array.isArray(s.coordinates) && s.coordinates.length);
  if (firstSeg) {
    const m = L.marker(firstSeg.coordinates[0], { icon: makeStartIcon(), zIndexOffset: 1000 })
      .bindPopup(`<b>Старт</b><br>${firstSeg.fdate || ''}`)
      .addTo(layer);
    m._mileageEndpoint = true;
    segmentLayers.push(m);
  }
  if (lastSeg) {
    const endCoord = lastSeg.coordinates[lastSeg.coordinates.length - 1];
    const m = L.marker(endCoord, { icon: makeFinishIcon(), zIndexOffset: 1000 })
      .bindPopup(`<b>Финиш</b><br>${lastSeg.tdate || lastSeg.fdate || ''}`)
      .addTo(layer);
    m._mileageEndpoint = true;
    segmentLayers.push(m);
  }

  drawMileageGaps(segments || []);

  if (allCoords.length) {
    const bounds = L.latLngBounds(allCoords.map((c) => [c[0], c[1]]));
    if (bounds.isValid()) {
      getMap().fitBounds(bounds, { padding: [50, 50] });
      state.lastFitAt = Date.now(); // трек не перефитит карту сразу после пробега
    }
  }

  refreshStopMarkers();
  emit('mileage');
}

function drawMileageGaps(segments) {
  const layer = getTrackLayer();
  const moved = segments
    .filter((s) => s.ismoved !== false && Array.isArray(s.coordinates) && s.coordinates.length)
    .slice()
    .sort((a, b) => String(a.fdate).localeCompare(String(b.fdate)));

  for (let i = 1; i < moved.length; i++) {
    const prev = moved[i - 1];
    const curr = moved[i];
    const a = prev.coordinates[prev.coordinates.length - 1];
    const b = curr.coordinates[0];
    if (!a || !b) continue;
    const dist = getMap().distance ? getMap().distance([a[0], a[1]], [b[0], b[1]]) : 0;
    if (dist < 1) continue;
    const line = L.polyline([[a[0], a[1]], [b[0], b[1]]], {
      color: '#ff0000', dashArray: '4,6', weight: 3, opacity: 0.95,
    }).addTo(layer);
    line.bindPopup(
      `<div class="popup-title">Пропуск</div>От: ${prev.tdate || '-'}<br>До: ${curr.fdate || '-'}<br>Дистанция: ${(dist / 1000).toFixed(2)} км`
    );
    registerSmartArrows('mileage-gap', line, '#ff0000');
    gapLayers.push(line);
  }
}
