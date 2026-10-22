// Проигрыватель трека: play/pause/reset, скорости 1/2/5/10x, слайдер, маркер с азимутом.

import { getMap, getTrackLayer } from '../core/map-core.js';
import { bearingDeg } from '../core/utils.js';
import { setPlaybackIndex } from './speed-chart.js';

let points = [];
let index = 0;
let playing = false;
let speed = 2;
let marker = null;
let suppressSliderEvent = false;

export function initPlayback() {
  const playBtn = document.getElementById('btnPlayPause');
  if (!playBtn) return; // проигрыватель отключён в шаблоне (telemetry: false)
  playBtn.addEventListener('click', togglePlay);
  document.getElementById('btnResetTrack').addEventListener('click', () => {
    pause();
    setPosition(0);
  });
  document.getElementById('trackProgress').addEventListener('input', (e) => {
    if (suppressSliderEvent) return;
    pause();
    if (!points.length) return;
    const pct = parseFloat(e.target.value);
    const target = Math.round((pct / 100) * (points.length - 1));
    setPosition(target);
  });
  document.querySelectorAll('.btn-speed').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-speed').forEach((b) => {
        b.classList.toggle('text-brand-400', b === btn);
        b.classList.toggle('font-bold', b === btn);
        b.classList.toggle('text-gray-300', b !== btn);
      });
      speed = parseFloat(btn.dataset.speed) || 1;
      if (playing) { pause(); play(); }
    });
  });
}

export function setPoints(newPoints) {
  points = newPoints || [];
  pause();
  index = 0;
  if (marker) {
    try { getMap().removeLayer(marker); } catch (e) { /* ignore */ }
    marker = null;
  }
  const totalEl = document.getElementById('playerTotalTime');
  const timeEl = document.getElementById('playerCurrentTime');
  const speedEl = document.getElementById('playerCurrentSpeed');
  if (!points.length) {
    if (totalEl) totalEl.textContent = '--:--:--';
    if (timeEl) timeEl.textContent = '--:--:--';
    if (speedEl) speedEl.textContent = 'Скорость: —';
    setSlider(0);
    updateTimeMarks();
    setPlaybackIndex(null);
    return;
  }
  if (totalEl) totalEl.textContent = (points[points.length - 1].wdate || '').slice(11, 19);
  setPosition(0);
  updateTimeMarks();
}

// Метки времени под шкалой: старт, ¼, ½, ¾, конец
function updateTimeMarks() {
  const wrap = document.getElementById('playerTimeMarks');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (points.length < 2) return;
  const n = 5;
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (points.length - 1)) / (n - 1));
    const t = (points[idx].wdate || '').slice(11, 16);
    const pos = (i / (n - 1)) * 100;
    const span = document.createElement('span');
    span.className = 'absolute top-0 text-center';
    span.style.left = pos + '%';
    span.style.transform = i === 0 ? 'none' : (i === n - 1 ? 'translateX(-100%)' : 'translateX(-50%)');
    span.innerHTML = `<span class="block w-px h-1 bg-gray-600 mb-0.5" style="margin-left:auto;margin-right:auto"></span>${t}`;
    wrap.appendChild(span);
  }
}

// Полный сброс плеера (смена ТС или дат): точки, маркер, слайдер, время
export function reset() {
  setPoints([]);
}

function ensureMarker() {
  if (marker || !points.length) return;
  marker = L.marker([points[0].lat, points[0].lng], {
    icon: L.divIcon({
      className: '',
      html: '<div id="movingVehicleIcon" class="vehicle-marker-icon" style="width:30px;height:30px;border-radius:50%;background:#2563eb;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.6);color:#fff"><i class="fa-solid fa-location-arrow" style="font-size:13px"></i></div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    }),
    zIndexOffset: 2000,
  }).addTo(getMap());
}

export function setPosition(i, opts = {}) {
  if (!points.length) return;
  index = Math.max(0, Math.min(points.length - 1, i));
  const p = points[index];
  ensureMarker();
  if (marker) {
    marker.setLatLng([p.lat, p.lng]);
    // поворот по азимуту к следующей точке (глиф fa-location-arrow смотрит на NE = 45°,
    // поэтому компенсируем: rotate(azimuth − 45°))
    if (index < points.length - 1) {
      const next = points[index + 1];
      const az = bearingDeg(p.lat, p.lng, next.lat, next.lng);
      const iconEl = marker.getElement && marker.getElement();
      const inner = iconEl && iconEl.querySelector('.vehicle-marker-icon');
      if (inner) inner.style.transform = `rotate(${az - 45}deg)`;
    }
  }
  const timeEl = document.getElementById('playerCurrentTime');
  const speedEl = document.getElementById('playerCurrentSpeed');
  if (timeEl) timeEl.textContent = (p.wdate || '').slice(11, 19);
  if (speedEl) speedEl.textContent = `Скорость: ${p.speed != null ? p.speed : '-'} км/ч`;
  setSlider((index / (points.length - 1)) * 100);
  // линия текущей позиции на графике телеметрии (hover её не двигает — там сам tooltip)
  if (!opts.fromChart) setPlaybackIndex(index);
}

function setSlider(v) {
  const slider = document.getElementById('trackProgress');
  suppressSliderEvent = true;
  slider.value = String(v);
  suppressSliderEvent = false;
}

function togglePlay() {
  if (playing) pause();
  else play();
}

// rAF + накопитель: скорость линейна на всех режимах (1x = 1 точка за 80 мс).
// setInterval упирался в потолок 16 мс — 5x и 10x визуально не отличались.
let rafId = null;
let lastTs = null;
let acc = 0;

function play() {
  if (!points.length) return;
  if (index >= points.length - 1) setPosition(0);
  playing = true;
  updatePlayButton();
  lastTs = null;
  acc = 0;
  const step = (ts) => {
    if (!playing) return;
    if (lastTs == null) lastTs = ts;
    const dt = Math.min(200, ts - lastTs); // защита от «прыжка» после паузы/фона
    lastTs = ts;
    acc += (dt * speed) / 80;
    const advance = Math.floor(acc);
    if (advance > 0) {
      acc -= advance;
      const next = index + advance;
      if (next >= points.length - 1) {
        setPosition(points.length - 1);
        pause();
        return;
      }
      setPosition(next);
    }
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
}

function pause() {
  playing = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  lastTs = null;
  acc = 0;
  updatePlayButton();
}

function updatePlayButton() {
  const btn = document.getElementById('btnPlayPause');
  btn.innerHTML = playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
  btn.title = playing ? 'Пауза' : 'Воспроизвести';
}
