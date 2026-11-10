// Список ТС: Vehicle Select Min (+merge Vehicle Show) либо Vehicle Show (все устройства,
// админ-панель через setVehiclesSource('show')). Карточки, поиск, фильтры, выбор.
// В online-режиме список рендерит online.js (setOnlineListRenderer) по записям Surv,
// а кнопки статусов переключаются на статусы online (Все/В движении/Стоянка/Нет связи).

import { onPacket, sendRequest } from '../core/ws.js';
import { auth } from '../core/auth.js';
import { escapeHtml, showToast, parseRelativeDurationToMs } from '../core/utils.js';
import { state, emit, on } from './state.js';

let fleetKeyMap = null;
let filterQuery = '';
let filterStatus = 'all';
let filterFleet = 'all';
let showHiddenFleets = false;
// Рендер списка в online-режиме (регистрируется online.js, чтобы избежать циклического импорта).
let onlineListRenderer = null;
// Источник списка ТС: 'select-min' — ТС пользователя (Vehicle Select Min),
// 'show' — все устройства (Vehicle Show, админ-панель).
let vehiclesSource = 'select-min';
export let autoMode = false;

export function getFleetKeyMap() { return fleetKeyMap; }

/** Текущие фильтры списка ТС (использует online-рендер списка в online-режиме). */
export function getVehicleFilters() {
  return { query: filterQuery, fleet: filterFleet, status: filterStatus };
}

/** Регистрация рендера списка для online-режима (вызывается из online.js). */
export function setOnlineListRenderer(fn) {
  onlineListRenderer = fn;
}

/** Выбор источника списка ТС: 'select-min' (по uid) или 'show' (все устройства). */
export function setVehiclesSource(src) {
  vehiclesSource = src === 'show' ? 'show' : 'select-min';
}

/** Название филиала по числовому ключу (fleetKeyMap из cols ответа сервера). */
export function fleetNameOf(v) {
  if (!v || v.fleet == null) return '';
  if (fleetKeyMap && fleetKeyMap[v.fleet] != null) return String(fleetKeyMap[v.fleet]);
  return String(v.fleet);
}

export function initVehicles() {
  try {
    autoMode = localStorage.getItem('vehicleAutoMode') === '1';
  } catch (e) { /* ignore */ }
  updateAutoBtn();

  document.getElementById('vehicleAutoModeBtn').addEventListener('change', (e) => {
    autoMode = e.target.checked;
    try {
      localStorage.setItem('vehicleAutoMode', autoMode ? '1' : '0');
    } catch (e) { /* ignore */ }
    updateAutoBtn();
    renderVehicleList();
  });

  document.getElementById('vehicleSearch').addEventListener('input', (e) => {
    filterQuery = e.target.value.trim();
    renderVehicleList();
  });

  const hiddenFleetsToggle = document.getElementById('monitoringShowHiddenFleets');
  if (hiddenFleetsToggle) {
    hiddenFleetsToggle.addEventListener('change', () => {
      showHiddenFleets = hiddenFleetsToggle.checked;
      renderVehicleList();
    });
  }

  document.getElementById('fleetFilter').addEventListener('change', (e) => {
    filterFleet = e.target.value;
    renderVehicleList();
  });

  // Смена режима дашборда: фильтры статусов и список переключаются на режим
  on('app-mode', () => {
    filterStatus = 'all';
    renderStatusButtons();
    renderVehicleList();
  });

  // Пакеты списков ТС
  onPacket('Vehicle Select Min', handleVehiclePacket, { priority: 5 });
  onPacket('Vehicle Show', handleVehiclePacket, { priority: 5 });

  // У Vehicle Show нет sdate/контроля — статус неизвестен, фильтр статусов бессмыслен
  if (vehiclesSource === 'show') {
    const box = document.getElementById('vehicleStatusFilters');
    if (box) box.style.display = 'none';
  }

  renderStatusButtons();
  populateFleetFilter();
  renderVehicleList();
}

// Кнопки фильтра статуса: набор зависит от режима (история — Онлайн/Офлайн,
// online — статусы Surv); «Автовыбор» в online-режиме скрыт.
const STATUS_BUTTONS = {
  history: [
    { status: 'all', title: 'Все' },
    { status: 'online', title: 'Онлайн' },
    { status: 'offline', title: 'Офлайн' },
  ],
  online: [
    { status: 'all', title: 'Все' },
    { status: 'moving', title: 'В движении' },
    { status: 'stopped', title: 'Стоянка' },
    { status: 'offline', title: 'Нет связи' },
  ],
};

function renderStatusButtons() {
  const container = document.getElementById('vehicleStatusFilters');
  if (!container) return;
  const mode = state.appMode === 'online' ? 'online' : 'history';
  container.innerHTML = STATUS_BUTTONS[mode].map((b) => {
    const active = filterStatus === b.status;
    return `<button type="button" class="filter-status-btn ${active
      ? 'active px-2.5 py-1 rounded-md bg-brand-600 text-white'
      : 'px-2.5 py-1 rounded-md bg-darkbg-700 text-gray-400 hover:text-gray-200'}" data-status="${b.status}">${b.title}</button>`;
  }).join('');
  container.querySelectorAll('.filter-status-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      filterStatus = btn.dataset.status;
      renderStatusButtons();
      renderVehicleList();
      emit('vehicles-filter-changed');
    });
  });
  const autoWrap = document.getElementById('vehicleAutoModeWrap');
  if (autoWrap) autoWrap.classList.toggle('hidden', mode === 'online');
}

function updateAutoBtn() {
  const btn = document.getElementById('vehicleAutoModeBtn');
  btn.checked = autoMode;
  btn.setAttribute('aria-pressed', String(autoMode));
}

function handleVehiclePacket(data) {
  const packet = data.res && data.res[0];
  if (!packet) return false;
  if (packet.cols) {
    const fleetCol = packet.cols.find((c) => c.f === 'fleet' && Array.isArray(c.k));
    if (fleetCol) {
      fleetKeyMap = {};
      fleetCol.k.forEach((entry) => {
        if (entry && entry.key !== undefined) fleetKeyMap[entry.key] = entry.val;
      });
    }
  }
  if (packet.f && Array.isArray(packet.f) &&
      (data.act === 'setup' || data.act === 'filter' || data.act === 'reinit')) {
    if (data.name === 'Vehicle Show') {
      state.vehicleDetails = packet.f.slice();
      if (vehiclesSource === 'show') state.vehicles = packet.f.slice(); // админка: все устройства
      mergeDetails();
    } else {
      state.vehicles = packet.f.slice();
      mergeDetails();
    }
    emit('vehicles');
    populateFleetFilter();
    renderVehicleList();
  }
  return false; // не поглощаем — другие модули тоже слушают Vehicle Show
}

/** Заполняет селект филиалов уникальными значениями (сохраняет выбранное). */
function populateFleetFilter() {
  const select = document.getElementById('fleetFilter');
  if (!select) return;
  const seen = new Map(); // key -> label
  state.vehicles.forEach((v) => {
    if (v.fleet == null) return;
    const key = String(v.fleet);
    if (!seen.has(key)) seen.set(key, fleetNameOf(v));
  });
  const options = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  const prev = filterFleet;
  select.innerHTML = '<option value="all">Все филиалы</option>' +
    options.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join('');
  if (prev !== 'all' && seen.has(prev)) select.value = prev;
  else filterFleet = 'all';
}

function mergeDetails() {
  if (!state.vehicles.length || !state.vehicleDetails.length) return;
  const byId = new Map();
  state.vehicleDetails.forEach((d) => {
    const id = d.deviceid != null ? String(d.deviceid) : (d.id != null ? String(d.id) : null);
    if (id != null) byId.set(id, d);
  });
  state.vehicles.forEach((v) => {
    const d = byId.get(String(v.id));
    if (d) {
      v.model = d.model || v.model;
      v.brand = d.brand || v.brand;
      v.imei = d.imei || v.imei;
      v.__detail = d;
    }
  });
}

export function requestVehicleSelectMin() {
  if (!auth.loggedIn) return;
  sendRequest({
    name: 'Vehicle Select Min', type: 'etbl', mid: 4, act: 'init',
    lang: 'en',
  });
  setTimeout(() => {
    sendRequest({
      name: 'Vehicle Select Min', type: 'etbl', mid: 4, act: 'setup',
      filter: [{ selecteduid: [auth.uid] }],
      nowait: true, waitfor: [],
      lang: 'en',
    });
  }, 150);
}

export function requestVehicleShow() {
  if (!auth.loggedIn) return;
  // init — чтобы получить cols с картой fleet (ключ -> название филиала)
  sendRequest({
    name: 'Vehicle Show', type: 'etbl', mid: 2, act: 'init',
    lang: 'en',
  });
  setTimeout(() => {
    sendRequest({
      name: 'Vehicle Show', type: 'etbl', mid: 2, act: 'setup',
      filter: [],
      nowait: true, waitfor: [],
      lang: 'ru',
    });
  }, 150);
}

// «На связи» определяется по sdate (время с последней активности, postgres-стиль
// '00:02:27' / '9 mons 11 days 22:43:13'). Поле 'контроль' связанностью не является
// (у простаивающих трекеров оно ON) — используем только как fallback.
// Статусы: online — активность ≤30 мин; week — ≤7 дней (жёлтый); иначе offline.
// Статусы: online — активность ≤30 мин; week — ≤7 дней (жёлтый); offline — дольше;
// unknown — нет ни sdate, ни 'контроль' (у Vehicle Show этих полей нет).
const ONLINE_THRESHOLD_MS = 30 * 60 * 1000;
const WEEK_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

function deviceStatus(v) {
  const ms = parseRelativeDurationToMs(String(v.sdate || ''));
  if (isFinite(ms)) {
    if (ms <= ONLINE_THRESHOLD_MS) return 'online';
    if (ms <= WEEK_THRESHOLD_MS) return 'week';
    return 'offline';
  }
  if (v['контроль'] != null || v.kontrol != null) {
    return String(v['контроль'] || v.kontrol || '').toUpperCase() === 'ON' ? 'online' : 'offline';
  }
  return 'unknown';
}

function isOnline(v) {
  return deviceStatus(v) === 'online';
}

const STATUS_DOT = {
  online: { cls: 'bg-emerald-500', title: 'На связи (≤30 мин)' },
  week: { cls: 'bg-amber-400', title: 'Активность в пределах недели' },
  offline: { cls: 'bg-rose-500', title: 'Не на связи (больше недели)' },
  unknown: { cls: 'bg-gray-500', title: 'Нет данных о статусе' },
};

const HIDDEN_FLEET_PREFIXES = ['del', 'undefined', 'склад'];

function isHiddenFleet(v) {
  const fleet = fleetNameOf(v).trim().toLowerCase();
  return HIDDEN_FLEET_PREFIXES.some((prefix) => fleet.startsWith(prefix));
}

function filteredVehicles() {
  const q = filterQuery.toLowerCase();
  return state.vehicles.filter((v) => {
    const matchesQuery = !q ||
      String(v.number || '').toLowerCase().includes(q) ||
      String(v.model || '').toLowerCase().includes(q) ||
      String(v.id || '').includes(q);
    const matchesStatus = filterStatus === 'all' ||
      (filterStatus === 'online' ? isOnline(v) : !isOnline(v) && deviceStatus(v) !== 'unknown');
    const matchesFleet = filterFleet === 'all' || String(v.fleet) === filterFleet;
    const matchesHiddenFleet = vehiclesSource !== 'show' || showHiddenFleets || !isHiddenFleet(v);
    return matchesQuery && matchesStatus && matchesFleet && matchesHiddenFleet;
  });
}

// Сортировка списка по времени последнего коннекта (sdate — относительная длительность
// 'HH:MM:SS' / 'N mons N days HH:MM:SS'): меньше мс = свежее, свежие — сверху.
// Нераспознанный sdate уходит в конец списка. Контрола в UI нет; направление можно
// переопределить через localStorage 'vehicleSortMode' = 'conn-old' (сначала давние).
function currentSortMode() {
  try {
    return localStorage.getItem('vehicleSortMode') || 'conn-fresh';
  } catch (e) {
    return 'conn-fresh';
  }
}

function sortVehicles(list) {
  const mode = currentSortMode();
  if (mode !== 'conn-fresh' && mode !== 'conn-old') return list;
  const dir = mode === 'conn-fresh' ? 1 : -1;
  return list.slice().sort((a, b) => {
    const ma = parseRelativeDurationToMs(String(a.sdate || ''));
    const mb = parseRelativeDurationToMs(String(b.sdate || ''));
    if (!isFinite(ma) && !isFinite(mb)) return 0;
    if (!isFinite(ma)) return 1;
    if (!isFinite(mb)) return -1;
    return (ma - mb) * dir;
  });
}

export function renderVehicleList() {
  const container = document.getElementById('vehicleList');
  if (!container) return;
  // В online-режиме список рендерит online.js (записи Surv в карточках)
  if (state.appMode === 'online') {
    if (onlineListRenderer) onlineListRenderer();
    return;
  }
  container.innerHTML = '';
  const list = sortVehicles(filteredVehicles());

  if (!state.vehicles.length) {
    container.innerHTML = '<div class="text-xs text-gray-500 p-2">Нет данных. Ожидание входа...</div>';
    return;
  }
  if (!list.length) {
    container.innerHTML = '<div class="text-xs text-gray-500 p-2">Ничего не найдено.</div>';
    return;
  }

  list.forEach((v) => {
    const selected = state.selectedVehicle && String(state.selectedVehicle.id) === String(v.id);
    const status = STATUS_DOT[deviceStatus(v)] || STATUS_DOT.unknown;
    const fleetName = fleetNameOf(v);
    const card = document.createElement('div');
    card.className = `vehicle-card p-2.5 rounded-lg cursor-pointer border flex items-center justify-between bg-darkbg-900/80 ${
      selected ? 'selected border-brand-500/80' : 'border-gray-800 hover:border-gray-700'
    }`;
    card.innerHTML = `
      <div class="flex items-center space-x-3 min-w-0">
        <div class="p-2 rounded bg-darkbg-700 text-brand-400 shrink-0"><i class="fa-solid fa-truck"></i></div>
        <div class="min-w-0">
          <div class="font-bold text-xs text-gray-100 truncate">${escapeHtml(v.number || '—')}</div>
          <div class="text-[11px] text-gray-400 truncate mt-0.5 flex items-center gap-1">
            <span class="bg-darkbg-700 px-1.5 py-0.5 rounded text-gray-300 font-mono">id ${escapeHtml(String(v.id))}</span>
            ${fleetName ? `<span class="bg-darkbg-700 px-1.5 py-0.5 rounded text-gray-300" title="Филиал">${escapeHtml(fleetName)}</span>` : ''}
            ${v.model ? `<span>• ${escapeHtml(String(v.model))}</span>` : ''}
          </div>
          <div class="text-[10px] text-gray-500 mt-0.5">${escapeHtml(String(v.sdate || ''))}</div>
        </div>
      </div>
      <span class="w-2 h-2 rounded-full shrink-0 ${status.cls}" title="${status.title}"></span>`;
    card.addEventListener('click', () => selectVehicle(v));
    container.appendChild(card);
  });

  // Авто-режим: единственное совпадение → выбрать и запустить загрузку
  if (autoMode && list.length === 1 && (!state.selectedVehicle || String(state.selectedVehicle.id) !== String(list[0].id))) {
    selectVehicle(list[0], { auto: true });
  }
}

export function selectVehicle(v, opts = {}) {
  state.selectedVehicle = v;
  state.deviceId = String(v.id);
  if (state.appMode === 'online') {
    // В online-режиме клик по ТС только центрирует карту и открывает попап
    // (online.js слушает 'online-focus-request'); сброс/загрузка истории не нужны.
    renderVehicleList();
    updateHeaderVehicle();
    emit('online-focus-request', v);
    return;
  }
  emit('vehicle-selected', { vehicle: v, auto: !!opts.auto });
  renderVehicleList();
  updateHeaderVehicle();
}

export function updateHeaderVehicle() {
  const el = document.getElementById('headerVehicle');
  if (!el) return;
  if (state.selectedVehicle) {
    el.textContent = `ТС: ${state.selectedVehicle.number || ''} (id ${state.selectedVehicle.id})`;
    el.classList.remove('hidden');
  } else {
    el.textContent = '';
  }
}

export function vehicleDisplayName(v) {
  if (!v) return '';
  return `${v.number || ''} (id ${v.id})`;
}

// Удобный доступ для буфера «ok» и KPI
export function getSelectedVehicleName() {
  return vehicleDisplayName(state.selectedVehicle);
}
