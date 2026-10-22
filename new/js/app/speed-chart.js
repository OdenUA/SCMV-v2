// График скорости (Chart.js). Hover синхронизирует маркер на карте через playback.

import { on as onState } from './state.js';

let chart = null;
let suppressHover = false;
let lastTrackTs = []; // таймстемпы точек трека — для интерполяции топлива
let lastFuelPoints = null; // последние точки топлива (переприменяются при загрузке трека)

// Вертикальная линия текущей позиции плеера на графике
const playbackLinePlugin = {
  id: 'playbackLine',
  afterDatasetsDraw(c) {
    const idx = c.$playbackIndex;
    if (idx == null || !c.data.labels || !c.data.labels.length) return;
    const meta = c.getDatasetMeta(0);
    const point = meta.data[idx];
    if (!point) return;
    const { ctx, chartArea } = c;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(point.x, chartArea.top);
    ctx.lineTo(point.x, chartArea.bottom);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.restore();
  },
};

// Вертикальная линия выбранного события топлива (клик по таблице/маркеру)
const eventLinePlugin = {
  id: 'eventLine',
  afterDatasetsDraw(c) {
    const idx = c.$eventIndex;
    if (idx == null || !c.data.labels || !c.data.labels.length) return;
    const meta = c.getDatasetMeta(0);
    const point = meta.data[idx];
    if (!point) return;
    const { ctx, chartArea } = c;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(point.x, chartArea.top);
    ctx.lineTo(point.x, chartArea.bottom);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.restore();
  },
};

let chartRafPending = false;
export function setPlaybackIndex(i) {
  if (!chart) return;
  chart.$playbackIndex = i;
  if (chartRafPending) return;
  chartRafPending = true;
  requestAnimationFrame(() => {
    chartRafPending = false;
    if (chart) chart.update('none');
  });
}

export function getPlaybackIndex() {
  return chart ? chart.$playbackIndex : null;
}

export function initChart() {
  const canvas = document.getElementById('speedChart');
  if (!canvas || typeof Chart === 'undefined') return;
  Chart.defaults.color = '#9ca3af';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';
  chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    plugins: [playbackLinePlugin, eventLinePlugin],
    data: {
      labels: [],
      datasets: [{
        label: 'Скорость (км/ч)',
        data: [],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.12)',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHitRadius: 12,
      }, {
        label: 'Топливо (л)',
        data: [],
        borderColor: '#10b981',
        borderWidth: 2,
        fill: false,
        tension: 0.2,
        pointRadius: 0,
        pointHitRadius: 8,
        yAxisID: 'y1',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { font: { size: 11 } } },
        tooltip: {
          animation: false, // без анимации тултип не дёргается при движении курсора
          callbacks: {
            title: (items) => items.length ? (chart.data.labels[items[0].dataIndex] || '') : '',
            afterBody: (items) => {
              if (!items.length || suppressHover) return '';
              const idx = items[0].dataIndex;
              import('./playback.js').then((pb) => pb.setPosition(idx, { fromChart: true }));
              return '';
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af', font: { size: 10 }, maxTicksLimit: 12, maxRotation: 0 },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af', font: { size: 10 } },
          title: { display: true, text: 'км/ч', color: '#3b82f6', font: { size: 10 } },
        },
        y1: {
          position: 'right',
          display: false,
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: { color: '#9ca3af', font: { size: 10 } },
          title: { display: true, text: 'литры', color: '#10b981', font: { size: 10 } },
        },
      },
    },
  });

  onState('cleared', () => setTrack([]));
}

export function setTrack(points) {
  if (!chart) return;
  chart.$playbackIndex = null;
  chart.$eventIndex = null;
  lastTrackTs = (points || []).map((p) => p.ts || 0);
  const labels = (points || []).map((p) => (p.wdate || '').slice(11, 19));
  const data = (points || []).map((p) => (isFinite(p.speed) ? p.speed : 0));
  suppressHover = true;
  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.update('none');
  setTimeout(() => { suppressHover = false; }, 100);
  reapplyFuel(); // трек загружен/перезагружен — восстанавливаем линию топлива
}

export function getFuelState() {
  if (!chart || !chart.data.datasets[1]) return { points: 0, shown: false };
  return {
    points: chart.data.datasets[1].data.length,
    shown: !!chart.options.scales.y1.display,
  };
}

// Линия события топлива на графике: ближайшая к ts точка трека
let eventRafPending = false;
export function showEventAt(ts) {
  if (!chart || !lastTrackTs.length) return;
  let lo = 0;
  let hi = lastTrackTs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lastTrackTs[mid] < ts) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(lastTrackTs[lo - 1] - ts) <= Math.abs(lastTrackTs[lo] - ts)) lo -= 1;
  chart.$eventIndex = lo;
  if (eventRafPending) return;
  eventRafPending = true;
  requestAnimationFrame(() => {
    eventRafPending = false;
    if (chart) chart.update('none');
  });
}

export function clearEvent() {
  if (!chart) return;
  chart.$eventIndex = null;
  chart.update('none');
}

export function getEventIndex() {
  return chart ? chart.$eventIndex : null;
}

export function resizeChart() {
  if (chart) chart.resize();
}

/** Линия топлива на графике: значения интерполируются по времени на ось трека. */
export function setFuelPoints(fuelPoints) {
  lastFuelPoints = fuelPoints || null;
  reapplyFuel();
}

function reapplyFuel() {
  if (!chart) return;
  const ds = chart.data.datasets[1];
  if (!ds) return;
  const fp = lastFuelPoints;
  if (!fp || !fp.length || !lastTrackTs.length) {
    ds.data = [];
    chart.options.scales.y1.display = false;
    chart.update('none');
    return;
  }
  const sorted = fp.slice().sort((a, b) => a.ts - b.ts);
  const data = new Array(lastTrackTs.length);
  let j = 0;
  for (let i = 0; i < lastTrackTs.length; i++) {
    const t = lastTrackTs[i];
    while (j < sorted.length - 1 && sorted[j + 1].ts <= t) j++;
    if (t <= sorted[0].ts) {
      data[i] = sorted[0].liters;
    } else if (j >= sorted.length - 1) {
      data[i] = sorted[sorted.length - 1].liters;
    } else {
      const a = sorted[j];
      const b = sorted[j + 1];
      const f = Math.min(1, Math.max(0, (t - a.ts) / ((b.ts - a.ts) || 1)));
      data[i] = Math.round((a.liters + (b.liters - a.liters) * f) * 10) / 10;
    }
  }
  ds.data = data;
  chart.options.scales.y1.display = true;
  chart.update('none');
}
