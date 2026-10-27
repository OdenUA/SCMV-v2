// Общий инициализатор дашборда. Используется index.html (wireHeader+connect)
// и админ-панелью (раздел «Мониторинг»: wireHeader:false, connect:false).

import { requireSession, initAuth, auth, performLogout } from '../core/auth.js';
import { connect, close, onWsEvent } from '../core/ws.js';
import { showToast, copyToClipboard, formatDuration } from '../core/utils.js';
import { initModals, openModal } from '../core/components.js';
import { initMap, getMap, getTrackLayer, getParkingLayer, getAnomalyLayer, getMarkerLayer, getFuelLayer } from '../core/map-core.js';
import {
  getAnomalySettings, saveAnomalySettings, resetAnomalySettings,
} from '../core/config.js';

import { state, on, emit } from './state.js';
import * as vehicles from './vehicles.js';
import { initDates, setDefaultDates } from './dates.js';
import { initChangelog } from './changelog.js';
import { getTabs } from './tabs.js';
import { dashboardTemplate } from './dashboard-template.js';

import * as track from './track.js';
import * as mileage from './mileage.js';
import * as stops from './stops.js';
import * as speedChart from './speed-chart.js';
import * as playback from './playback.js';
import * as route from './route.js';
import * as memory from './memory.js';
import * as fuel from './fuel.js';

let booted = false;

/**
 * @param {object} opts
 *  tabs?: string[]      вкладки таблиц (по умолчанию ['stops','anomalies'])
 *  actions?: string[]   кнопки действий (по умолчанию ['track'])
 *  clipboard?: boolean  кнопки копирования текста
 *  wireHeader?: boolean обновлять статус WS/пользователя в шапке страницы (default true)
 *  connect?: boolean    открывать WS-соединение (default true)
 *  mount?: string       селектор точки монтирования (default '#dashboardMount')
 *  vehicleSource?: 'select-min'|'show' список ТС: ТС пользователя (default) или все устройства (Vehicle Show, админ-панель)
 *  mapDistanceOnly?: boolean без верхней KPI-панели, только плавающий бейдж пробега над картой
 */
export function initDashboard(opts = {}) {
  if (booted) return;
  booted = true;

  const tabs = opts.tabs || ['stops', 'anomalies'];
  const actions = opts.actions || ['track'];

  // ---------- Разметка ----------
  const mount = document.querySelector(opts.mount || '#dashboardMount');
  if (!mount) throw new Error('dashboardMount не найден');
  mount.innerHTML = dashboardTemplate({
    tabs, actions,
    clipboard: !!opts.clipboard,
    telemetry: opts.telemetry,
    adminTools: !!opts.adminTools,
    mapDistanceOnly: !!opts.mapDistanceOnly,
  });

  if (!requireSession()) throw new Error('No session');
  initAuth();
  initModals();
  attachSidebarWheelScroll();

  // ---------- Карта ----------
  initMap();
  attachMapResize();

  // ---------- WS ----------
  if (opts.connect !== false) connect({ autoLogin: true });

  // Загрузка списка ТС: при уже активной сессии и при событиях логина/реконнекта.
  // 'select-min' — ТС пользователя + Vehicle Show (детали/fleet-карта);
  // 'show' (админ-панель) — только Vehicle Show, в списке все устройства.
  const useShowSource = opts.vehicleSource === 'show';
  vehicles.setVehiclesSource(useShowSource ? 'show' : 'select-min');
  const requestVehicleList = (withDetails) => {
    if (useShowSource) {
      vehicles.requestVehicleShow();
    } else {
      vehicles.requestVehicleSelectMin();
      if (withDetails) vehicles.requestVehicleShow();
    }
  };
  if (auth.loggedIn) requestVehicleList(true);
  onWsEvent((event) => {
    if (event === 'login-ok') {
      requestVehicleList(true);
    } else if (event === 'open' && auth.loggedIn) {
      requestVehicleList(false);
    }
  });

  if (opts.wireHeader !== false) wireHeader();

  // ---------- Даты ----------
  initDates(() => {
    // смена дат: сбрасываем плеер, данные пробега/стоянок/топлива/анализа (перезапрос — со следующей загрузки)
    playback.reset();
    mileage.resetMileageState();
    stops.resetStopsState();
    fuel.onDatesChanged();
    emit('cleared');
    import('./analysis.js').then((m) => m.clearAnalysis()).catch(() => {});
  });

  // ---------- Действия (кнопки по выбору) ----------
  const onClick = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  onClick('btnLoadTrack', () => {
    if (!state.deviceId) { showToast('⚠ Сначала выберите ТС'); return; }
    track.loadTrack();
  });
  onClick('btnLoadRawTrack', () => {
    if (!state.deviceId) { showToast('⚠ Сначала выберите ТС'); return; }
    track.loadRawTrack();
  });
  onClick('btnLoadTelemetry', () => {
    setTelemetryCollapsed(false); // если график был свёрнут — разворачиваем
    track.loadTelemetry();
  });
  onClick('btnAnalyze', () => {
    if (!state.deviceId) { showToast('⚠ Сначала выберите ТС'); return; }
    import('./analysis.js').then((m) => m.loadAnalysis());
  });
  onClick('btnDevLog', () => {
    if (!state.deviceId) { showToast('⚠ Сначала выберите ТС'); return; }
    import('./logs.js').then((m) => m.loadDeviceData({ scrollToLogs: true }));
  });

  // Авто-режим ТС: единственное совпадение → сразу загрузка трека
  // Любая смена ТС: сброс плеера телеметрии в начало
  // Смена ТС: полный сброс отображения (как при смене дат) — стоянки/пробег перезапросятся со следующей загрузки
  on('vehicle-selected', (payload) => {
    playback.reset();
    mileage.resetMileageState();
    stops.resetStopsState();
    import('./analysis.js').then((m) => m.clearAnalysis()).catch(() => {});
    if (payload && payload.auto) { track.loadTrack(); return; }
    // Автозагрузка трека при смене ТС, если период — один день (даты начала и конца совпадают)
    const fromEl = document.getElementById('startDate');
    const toEl = document.getElementById('endDate');
    if (fromEl && toEl && fromEl.value && toEl.value &&
        fromEl.value.slice(0, 10) === toEl.value.slice(0, 10)) {
      track.loadTrack();
    }
  });

  // ---------- KPI ----------
  function updateKpis() {
    const setText = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    setText('statVehicle', state.selectedVehicle ? (state.selectedVehicle.number || `id ${state.selectedVehicle.id}`) : '—');
    const distText = state.startstopTotalKm ? `${state.startstopTotalKm.toFixed(2)} км` : '—';
    setText('statDistance', distText);
    setText('mapDistanceBadgeValue', distText);
    setText('statTime', (state.moveDurationMs || state.stopDurationMs)
      ? `${formatDuration(state.moveDurationMs)} / ${formatDuration(state.stopDurationMs)}` : '—');
    if (state.trackPoints.length) {
      let sum = 0; let max = 0; let cnt = 0;
      state.trackPoints.forEach((p) => {
        const s = Number(p.speed);
        if (isFinite(s)) { sum += s; cnt += 1; if (s > max) max = s; }
      });
      setText('statSpeed', cnt ? `${Math.round(sum / cnt)} / ${Math.round(max)} км/ч` : '—');
    } else {
      setText('statSpeed', '—');
    }
    const parts = [];
    if (state.stops.length) parts.push(`${state.stops.length} стоянок`);
    if (state.anomalies.length) parts.push(`${state.anomalies.length} аномалий`);
    setText('statEvents', parts.length ? parts.join(', ') : '—');

    const badge = document.getElementById('anomaliesBadge');
    if (badge) {
      badge.textContent = String(state.anomalies.length);
      badge.classList.toggle('hidden', !state.anomalies.length);
    }
  }
  ['track', 'mileage', 'stops', 'vehicle-selected', 'cleared'].forEach((ev) => on(ev, updateKpis));

  // ---------- Вкладки таблиц ----------
  const renderedTabs = new Set();

  function switchTab(id) {
    document.querySelectorAll('.tab-btn').forEach((b) => {
      const active = b.dataset.tab === id;
      b.classList.toggle('active', active);
      b.classList.toggle('bg-brand-600', active);
      b.classList.toggle('text-white', active);
      b.classList.toggle('text-gray-400', !active);
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('hidden', p.dataset.panel !== id);
    });
    const tab = getTabs().find((t) => t.id === id);
    if (tab) {
      if (!renderedTabs.has(id) && tab.render) {
        renderedTabs.add(id);
        tab.render(document.querySelector(`.tab-panel[data-panel="${id}"]`));
      }
      if (tab.onShow) tab.onShow();
    }
  }
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Экспорт Excel активной вкладки
  const exportBtn = document.getElementById('exportExcelBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const active = document.querySelector('.tab-btn.active');
      if (!active) return;
      const tab = getTabs().find((t) => t.id === active.dataset.tab);
      if (tab && tab.getRows) {
        const rows = tab.getRows();
        if (!rows || !rows.length) { showToast('Нет данных для экспорта'); return; }
        import('../core/utils.js').then((u) => u.exportXls(rows, `${tab.id}.xlsx`));
      } else {
        showToast('Экспорт недоступен для этой вкладки');
      }
    });
  }

  // ---------- Мобильный тоггл ----------
  const sidebarToggle = document.getElementById('sidebarToggleBtn');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('translate-x-full');
    });
  }

  // ---------- Сворачивание панели телеметрии (вместе с проигрывателем) ----------
  const TELEMETRY_COLLAPSED_KEY = 'dt_telemetry_collapsed';
  // В режиме 'ondemand' плеер/график скрыты до первой загрузки телеметрии
  let telemetryShown = opts.telemetry !== 'ondemand';
  function applyTelemetryCollapsed(collapsed) {
    const body = document.getElementById('telemetryChartBody');
    const bar = document.getElementById('playbackBar');
    const icon = document.getElementById('telemetryToggleIcon');
    if (body) body.classList.toggle('hidden', collapsed);
    if (bar) bar.style.display = (collapsed || !telemetryShown) ? 'none' : '';
    if (icon) {
      icon.classList.toggle('fa-chevron-down', !collapsed);
      icon.classList.toggle('fa-chevron-up', collapsed);
    }
  }
  // Показ панели телеметрии/плеера (режим 'ondemand' — после загрузки телеметрии)
  function showTelemetryUI() {
    telemetryShown = true;
    const wrap = document.getElementById('telemetryWrap');
    const bar = document.getElementById('playbackBar');
    if (wrap) wrap.style.display = '';
    if (bar) bar.style.display = '';
    speedChart.resizeChart();
    const m = getMap();
    if (m) setTimeout(() => m.invalidateSize(), 60);
  }
  function hideTelemetryUI() {
    if (opts.telemetry !== 'ondemand') return;
    telemetryShown = false;
    const wrap = document.getElementById('telemetryWrap');
    const bar = document.getElementById('playbackBar');
    if (wrap) wrap.style.display = 'none';
    if (bar) bar.style.display = 'none';
  }
  on('telemetry', showTelemetryUI);
  on('cleared', hideTelemetryUI);
  let telemetryCollapsed = false;
  try { telemetryCollapsed = localStorage.getItem(TELEMETRY_COLLAPSED_KEY) === '1'; } catch (e) { /* ignore */ }
  applyTelemetryCollapsed(telemetryCollapsed);
  function setTelemetryCollapsed(collapsed) {
    if (telemetryCollapsed === collapsed) return;
    telemetryCollapsed = collapsed;
    try { localStorage.setItem(TELEMETRY_COLLAPSED_KEY, telemetryCollapsed ? '1' : '0'); } catch (e) { /* ignore */ }
    applyTelemetryCollapsed(telemetryCollapsed);
    const m = getMap();
    if (m) setTimeout(() => m.invalidateSize(), 50);
  }
  const telemetryToggleBtn = document.getElementById('telemetryToggleBtn');
  if (telemetryToggleBtn) {
    telemetryToggleBtn.addEventListener('click', () => {
      setTelemetryCollapsed(!telemetryCollapsed);
    });
  }

  // ---------- Иконки-буферы ----------
  document.querySelectorAll('.panel-clipboard-icon').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const s = getAnomalySettings();
      const key = btn.dataset.key;
      let text = '';
      if (key === 'reb') text = s.clipboardReb;
      if (key === 'reb2') text = s.clipboardReb2;
      if (key === 'devoff') text = s.clipboardDevOff;
      if (key === 'devon') text = s.clipboardDevOn;
      if (key === 'ok') text = (s.clipboardOkTemplate || '').replace('{{dest}}', state.lastOkDest || '0');
      if (!text) return;
      const ok = await copyToClipboard(text);
      showToast(ok ? 'Скопировано в буфер обмена' : 'Не удалось скопировать');
    });
  });

  // ---------- Настройки аномалий ----------
  function fillAnomalySettingsForm() {
    const s = getAnomalySettings();
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('anomalyGapThresholdMinutes', (s.gapThresholdMs / 60000).toString());
    setVal('anomalySpeedThresholdKph', s.speedThresholdKph);
    setVal('anomalyJumpSpeedThresholdKph', s.jumpSpeedThresholdKph);
    setVal('anomalyRealSpeedThresholdKph', s.realSpeedThresholdKph);
    setVal('anomalyPositionJumpDistanceM', s.positionJumpDistanceM);
    setVal('anomalyTableMinDistanceM', s.tableMinDistanceM);
    setVal('anomalyClipboardReb', s.clipboardReb);
    setVal('anomalyClipboardReb2', s.clipboardReb2);
    setVal('anomalyClipboardDevOff', s.clipboardDevOff);
    setVal('anomalyClipboardDevOn', s.clipboardDevOn);
    setVal('anomalyClipboardOkTemplate', s.clipboardOkTemplate);
  }

  const settingsBtn = document.getElementById('anomalySettingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      fillAnomalySettingsForm();
      openModal('anomalySettingsModal');
    });
  }
  const settingsForm = document.getElementById('anomalySettingsForm');
  if (settingsForm) {
    settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = (id) => parseFloat(document.getElementById(id).value);
      const str = (id) => document.getElementById(id).value;
      saveAnomalySettings({
        gapThresholdMs: val('anomalyGapThresholdMinutes') * 60000,
        speedThresholdKph: val('anomalySpeedThresholdKph'),
        jumpSpeedThresholdKph: val('anomalyJumpSpeedThresholdKph'),
        realSpeedThresholdKph: val('anomalyRealSpeedThresholdKph'),
        positionJumpDistanceM: val('anomalyPositionJumpDistanceM'),
        tableMinDistanceM: val('anomalyTableMinDistanceM'),
        clipboardReb: str('anomalyClipboardReb'),
        clipboardReb2: str('anomalyClipboardReb2'),
        clipboardDevOff: str('anomalyClipboardDevOff'),
        clipboardDevOn: str('anomalyClipboardDevOn'),
        clipboardOkTemplate: str('anomalyClipboardOkTemplate'),
      });
      document.getElementById('anomalySettingsModal').classList.remove('open');
      showToast('Настройки сохранены');
    });
  }
  const resetSettingsBtn = document.getElementById('anomalySettingsResetBtn');
  if (resetSettingsBtn) {
    resetSettingsBtn.addEventListener('click', () => {
      resetAnomalySettings();
      fillAnomalySettingsForm();
      showToast('Настройки сброшены');
    });
  }

  // ---------- Модули ----------
  initChangelog();
  vehicles.initVehicles();
  mileage.initMileage();
  stops.initStops();
  track.initTrack();
  speedChart.initChart();
  playback.initPlayback();
  route.initRoute();
  memory.initMemory();
  fuel.initFuel();

  if (tabs.some((t) => t === 'devlog' || t === 'alarm' || t === 'fulltrack') || tabs.includes('analysis')) {
    import('./logs.js').then((m) => m.initLogs()).catch((e) => console.warn('logs init failed', e));
  }
  if (tabs.includes('analysis')) {
    import('./analysis.js').then((m) => {
      m.initAnalysis();
      // дашборд: вкладку «Анализ» показываем только когда загружены данные анализа
      if (opts.analysisTabAutoHide) m.setTabAutoHide(true);
    }).catch((e) => console.warn('analysis init failed', e));
  }

  setDefaultDates();
  switchTab(tabs[0] || 'stops');

  // Debug/test hook
  window.__v21 = {
    state, emit,
    layers: () => ({
      track: getTrackLayer() ? getTrackLayer().getLayers().length : 0,
      parking: getParkingLayer() ? getParkingLayer().getLayers().length : 0,
      anomaly: getAnomalyLayer() ? getAnomalyLayer().getLayers().length : 0,
      locations: getMarkerLayer() ? getMarkerLayer().getLayers().length : 0,
      fuel: getFuelLayer() ? getFuelLayer().getLayers().length : 0,
    }),
    chartIndex: () => speedChart.getPlaybackIndex(),
    chartFuel: () => speedChart.getFuelState(),
    chartEvent: () => speedChart.getEventIndex(),
  };

  console.log('[v2.1] dashboard ready', { tabs, actions });
}

// ---------- Шапка страницы (только на дашборде) ----------
function wireHeader() {
  const dot = document.getElementById('wsStatusDot');
  const statusText = document.getElementById('statusText');
  const lastResponseEl = document.getElementById('lastResponse');
  if (!dot) return;
  let statusClearTimer = null;

  onWsEvent((event, payload) => {
    if (event === 'open' || event === 'login-ok') {
      dot.classList.remove('bg-rose-500');
      dot.classList.add('bg-emerald-500');
    }
    if (event === 'close' || event === 'login-failed') {
      dot.classList.remove('bg-emerald-500');
      dot.classList.add('bg-rose-500');
    }
    if (event === 'status' && payload && statusText) {
      statusText.textContent = payload.text;
      statusText.style.color = payload.color || '';
      if (statusClearTimer) clearTimeout(statusClearTimer);
      if (payload.autoClearMs) {
        statusClearTimer = setTimeout(() => {
          if (statusText.textContent === payload.text) statusText.textContent = '';
        }, payload.autoClearMs);
      }
    }
    if (event === 'response' && payload && lastResponseEl) {
      const t = new Date(payload.at);
      const p = (n) => (n < 10 ? '0' : '') + n;
      lastResponseEl.textContent = `${payload.name} · ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
    }
  });

  const userNameEl = document.getElementById('userName');
  const userAvatarEl = document.getElementById('userAvatar');
  if (userNameEl) userNameEl.textContent = auth.user || '—';
  if (userAvatarEl) userAvatarEl.textContent = (auth.user || '?').slice(0, 2).toUpperCase();

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      close();
      performLogout();
    });
  }
}

// ---------- Прокрутка центра колесом над панелями и фоном окна ----------
function attachSidebarWheelScroll() {
  const canScroll = (el, delta) => {
    if (!el || el.scrollHeight <= el.clientHeight) return false;
    const maxScroll = el.scrollHeight - el.clientHeight;
    return delta < 0 ? el.scrollTop > 0 : el.scrollTop < maxScroll - 1;
  };

  document.addEventListener('wheel', (event) => {
    if (!event.deltaY || event.ctrlKey || event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest('.modal-overlay.open')) return;

    for (const el of event.composedPath()) {
      if (!(el instanceof Element)) continue;
      const overflowY = getComputedStyle(el).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && canScroll(el, event.deltaY)) return;
    }

    const mainArea = document.getElementById('mainArea');
    const monitoring = document.getElementById('section-monitoring');
    const main = mainArea && (!monitoring || !monitoring.classList.contains('hidden'))
      ? mainArea
      : (document.getElementById('adminMain') || mainArea);
    const unit = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 && main ? main.clientHeight : 1);
    const delta = event.deltaY * unit;
    if (!canScroll(main, delta)) return;

    event.preventDefault();
    main.scrollTop += delta;
  }, { passive: false });
}

// ---------- Ресайз карты ----------
function attachMapResize() {
  const handle = document.getElementById('mapResizeHandle');
  const block = document.getElementById('mapBlock');
  if (!handle || !block) return;

  let dragging = false;

  const startDrag = (clientY) => {
    dragging = true;
    const startY = clientY;
    const startH = block.offsetHeight;
    const move = (ev) => {
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const maxH = window.innerHeight - 160;
      const h = Math.min(Math.max(startH + (y - startY), 240), maxH);
      block.style.height = h + 'px';
      if (ev.cancelable) ev.preventDefault();
    };
    const up = () => {
      dragging = false;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      const m = getMap();
      if (m) m.invalidateSize();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up);
  };

  handle.addEventListener('mousedown', (e) => { e.preventDefault(); startDrag(e.clientY); });
  handle.addEventListener('touchstart', (e) => { startDrag(e.touches[0].clientY); }, { passive: true });
}
