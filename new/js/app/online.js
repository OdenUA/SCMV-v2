// Режим «Online Мониторинг»: транспорт на карте в реальном времени (порт экрана Surv v1).
// Протокол (боевой capture new/ws.txt): Surv (map, mid 2) — последние координаты ТС,
// Power Status (etbl, mid 3) — питание устройств. Список ТС — правая панель:
// карточки из записей Surv (стилистика исходного списка), длительность состояния
// вместо даты («Нет связи 3 дн», «Стоянка 2 ч», «В движении 45 мин»).
// Режим включается переключателем в шапке (bootstrap, body.app-mode-online):
// activateOnline() — таймер 5 с, слой на карте (кнопки тоггла нет — слой управляется
// режимом), fitBounds автопарка; deactivateOnline() — таймер остановлен, слой снят.
// Клик по ТС — центрирование + попап; в попапе кнопка «Авто-слежение».

import { onPacket, sendRequest, onWsEvent } from '../core/ws.js';
import { auth } from '../core/auth.js';
import { getOnlineLayer, getMap } from '../core/map-core.js';
import { showToast, escapeHtml, getField, parseTrackDate, haversineM, bearingDeg } from '../core/utils.js';
import { state, on, emit } from './state.js';
import { fleetNameOf, getVehicleFilters, setOnlineListRenderer, updateHeaderVehicle } from './vehicles.js';

const REFRESH_MS = 5000;
const ANIM_MS = REFRESH_MS - 200; // интерполяция чуть короче цикла — успевает к следующему снапшоту
const SNAP_M = 1500;              // скачок больше — мгновенное перемещение (GPS-прыжок)
const FRESH_MS = 30 * 60 * 1000; // «на связи»: последняя активность не старше 30 мин
const MOVE_SPEED_KPH = 5;

const STATUS_TITLE = {
  moving: 'В движении',
  stopped: 'Стоянка',
  offline: 'Нет связи',
  nodata: 'Нет данных',
};
const STATUS_DOT = {
  moving: 'bg-emerald-500',
  stopped: 'bg-sky-500',
  offline: 'bg-rose-500',
  nodata: 'bg-gray-500',
};

let activated = false; // режим Online хотя бы раз активировался в сессии
let refreshTimer = null;
let followEnabled = false; // авто-слежение (чекбокс в сайдбаре)
let followId = null;       // за каким ТС следим (по умолчанию — выбранное)
let survRows = [];     // последние строки Surv (сырые)
let powerRows = [];    // последние строки Power Status (сырые)
let entries = [];      // смерженные записи по ТС
let didFit = false; // карта уже подогнана под автопарк
let lastUpdatedAt = null;
// Плавное движение: маркеры персистентны, к каждому новому снапшоту строится
// интерполяция от текущей отображаемой позиции к новой (ANIM_MS).
const markerById = new Map();  // id -> L.marker
const animatedPos = new Map(); // id -> последняя целевая позиция {lat,lng}
let rafId = null;

export function initOnline() {
  onPacket('Surv', (data) => {
    const rows = data && data.res && data.res[0] && data.res[0].f;
    if (!Array.isArray(rows)) return false;
    survRows = rows;
    lastUpdatedAt = new Date();
    rebuild();
    return false;
  });

  onPacket('Power Status', (data) => {
    const rows = data && data.res && data.res[0] && data.res[0].f;
    if (!Array.isArray(rows)) return false;
    powerRows = rows;
    lastUpdatedAt = new Date();
    rebuild();
    return false;
  });

  // Авто-слежение в сайдбаре
  const followChk = document.getElementById('onlineFollowChk');
  if (followChk) {
    followChk.addEventListener('change', () => {
      followEnabled = followChk.checked;
      if (followEnabled) panToSelected();
    });
  }

  // Клик по ТС в online-режиме: центрирование карты + попап (vehicles.selectVehicle)
  on('online-focus-request', (v) => {
    if (!v) return;
    followId = String(v.id);
    const e = entries.find((x) => String(x.id) === String(v.id));
    if (e) focusEntry(e);
  });

  // Список ТС в правой панели в online-режиме — наши карточки (рендер делегирован)
  setOnlineListRenderer(renderOnlineVehicleList);
  on('vehicles-filter-changed', () => {
    renderOnlineVehicleList();
  });

  // Названия/филиалы ТС могут прийти позже самих online-данных
  on('vehicles', rebuild);
  // Реконнект/повторный логин: init заново на новом соединении
  onWsEvent((event) => {
    if (!activated) return;
    if (event === 'login-ok' || event === 'open') {
      initedOnce.clear();
      requestOnlineData();
    }
  });
}

// ---------- Жизненный цикл режима ----------
function startRefreshTimer() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    if (!document.hidden) requestOnlineData();
  }, REFRESH_MS);
}

export function activateOnline() {
  if (activated) {
    requestOnlineData();
    startRefreshTimer();
    startAnimLoop();
    return;
  }
  activated = true;
  requestOnlineData();
  startRefreshTimer();
  startAnimLoop();
  rebuild();
  const map = getMap();
  const layer = getOnlineLayer();
  if (map && layer && !map.hasLayer(layer)) layer.addTo(map);
  fitToEntries();
}

export function deactivateOnline() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  stopAnimLoop();
  const map = getMap();
  const layer = getOnlineLayer();
  if (map && layer && map.hasLayer(layer)) map.removeLayer(layer);
}

// ---------- Запросы (форматы фильтров — по боевому capture ws.txt) ----------
// init отправляется только при первом подключении (и после реконнекта) —
// по таймеру идут только setup/filter.
const initedOnce = new Set();

function sendInitSetup(partial, nowait) {
  const first = !initedOnce.has(partial.name);
  if (first) {
    initedOnce.add(partial.name);
    sendRequest({ ...partial, act: 'init', lang: 'en' });
  }
  setTimeout(() => {
    sendRequest({
      ...partial,
      act: 'setup',
      filter: [
        { selecteduid: [auth.uid] },
        { usreselectedvehicleid: [] }, // опечатка сервера — сохранять
        { userselectedfleetid: [] },
      ],
      nowait,
      waitfor: [],
      lang: 'en',
    });
  }, first ? 150 : 0);
}

function sendInitFilter(partial) {
  const first = !initedOnce.has(partial.name);
  if (first) {
    initedOnce.add(partial.name);
    sendRequest({ ...partial, act: 'init', lang: 'en' });
  }
  setTimeout(() => {
    sendRequest({
      ...partial,
      act: 'filter',
      filter: [
        { selecteduid: [auth.uid] },
        { userselectedfleetid: [] },
      ],
      lang: 'en',
    });
  }, first ? 150 : 0);
}

export function requestOnlineData() {
  if (!auth.loggedIn) return;
  sendInitSetup({ name: 'Surv', type: 'map', mid: 2 }, true);
  sendInitFilter({ name: 'Power Status', type: 'etbl', mid: 3 });
}

// ---------- Разбор ответов ----------
// Боевой формат Surv (ws.txt): {vehicleid, wdate, number, coordinates:[[lat,lng]], speed}
function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// Последняя валидная точка из coordinates [[lat,lng], ...] (fallback: latitude/longitude)
function coordsOf(row) {
  const list = getField(row, ['coordinates', 'coords', 'points']);
  if (Array.isArray(list)) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (Array.isArray(p) && isFinite(Number(p[0])) && isFinite(Number(p[1]))) {
        return { lat: Number(p[0]), lng: Number(p[1]) };
      }
      if (p && typeof p === 'object') {
        const lat = num(getField(p, ['lat', 'latitude']));
        const lng = num(getField(p, ['lng', 'lon', 'longitude']));
        if (lat != null && lng != null) return { lat, lng };
      }
    }
  }
  const lat = num(getField(row, ['latitude', 'lat']));
  const lng = num(getField(row, ['longitude', 'lng', 'lon']));
  return lat != null && lng != null ? { lat, lng } : { lat: null, lng: null };
}

function parseSurvRow(row) {
  const id = getField(row, ['vehicleid', 'vehicle', 'deviceid', 'id', 'did']);
  const { lat, lng } = coordsOf(row);
  const speed = num(getField(row, ['speed', 'spd']));
  const course = num(getField(row, ['course', 'angle', 'azimuth', 'direction', 'dir']));
  const wdate = getField(row, ['wdate', 'sdate', 'date', 'time']);
  const number = getField(row, ['number', 'num', 'name', 'госномер']);
  const d = parseTrackDate(String(wdate == null ? '' : wdate));
  return {
    id: id != null ? String(id) : null,
    lat, lng, speed, course,
    number: number != null ? String(number) : '',
    wdate: wdate != null ? String(wdate) : '',
    ts: d ? d.getTime() : null,
  };
}

function powerId(row) {
  const id = getField(row, ['vehicleid', 'deviceid', 'vehicle', 'id', 'did']);
  return id != null ? String(id) : null;
}

// Дата в Power Status приходит в HTML-обёртке: <div class=verylongdate>20.08.25</div>
function stripHtml(s) {
  return String(s == null ? '' : s).replace(/<[^>]*>/g, '').trim();
}

// «нет питания» — потеря внешнего питания (нештатно); «включено» — норма
function powerStateOf(row) {
  const control = String(getField(row, ['Контроль', 'kontrol', 'control', 'power', 'status']) || '').toLowerCase();
  if (!control.trim()) return null;
  if (/нет\s+питания|выключ|\boff\b/.test(control)) return 'off';
  if (/включ|\bon\b/.test(control)) return 'on';
  return null;
}

// Сводка питания: «Контроль: … · Дата: …»; id/fleet/номер/скорость пропускаем
function powerInfo(row) {
  const control = getField(row, ['Контроль', 'kontrol', 'control', 'power', 'status']);
  const date = getField(row, ['дата', 'date', 'sdate', 'wdate']);
  const parts = [];
  if (control != null && String(control).trim() !== '') parts.push(`Контроль: ${stripHtml(control)}`);
  if (date != null && String(date).trim() !== '') parts.push(`Дата: ${stripHtml(date)}`);
  if (parts.length) return parts.join(' · ');
  const skip = new Set(['№', 'deviceid', 'vehicleid', 'vehicle', 'id', 'did', 'fleet', 'машина', 'speed']);
  const rest = [];
  for (const k of Object.keys(row)) {
    if (skip.has(k.toLowerCase())) continue;
    const v = stripHtml(row[k]);
    if (v === '') continue;
    rest.push(`${k}: ${v}`);
  }
  return rest.slice(0, 3).join(' · ');
}

// Чистое слияние строк Surv/Power Status со списком ТС (export — для проверки на capture).
export function buildEntriesFrom(surv, power, vehicles) {
  const vehiclesById = new Map();
  vehicles.forEach((v) => { vehiclesById.set(String(v.id), v); });
  const powerById = new Map();
  power.forEach((p) => {
    const id = powerId(p);
    if (id != null) powerById.set(id, p);
  });

  const result = [];
  surv.forEach((row) => {
    const s = parseSurvRow(row);
    if (!s.id) return;
    const v = vehiclesById.get(s.id) || {};
    const pwr = powerById.get(s.id);
    const psFleet = pwr ? getField(pwr, ['fleet']) : null;
    // скорость/номер из Surv; из Power Status — только если в Surv пусто
    const speed = s.speed != null ? s.speed : (pwr ? num(getField(pwr, ['speed'])) : null);
    const number = s.number || v.number || (v.__detail && v.__detail.number) || '';
    const fleet = v.fleet != null ? v.fleet : (psFleet != null ? Number(psFleet) : undefined);
    const hasCoords = isFinite(s.lat) && isFinite(s.lng) &&
      s.lat >= -90 && s.lat <= 90 && s.lng >= -180 && s.lng <= 180;
    let status = 'nodata';
    if (hasCoords) {
      const fresh = s.ts != null && (Date.now() - s.ts) <= FRESH_MS;
      status = fresh
        ? (speed != null && speed > MOVE_SPEED_KPH ? 'moving' : 'stopped')
        : 'offline';
    }
    result.push({
      id: s.id,
      number,
      fleet,
      fleetName: fleetNameOf(v),
      lat: s.lat, lng: s.lng, speed, course: s.course,
      wdate: s.wdate, ts: s.ts,
      power: pwr ? powerInfo(pwr) : '',
      powerState: pwr ? powerStateOf(pwr) : null,
      status,
      hasCoords,
      markerRef: null,
    });
  });
  return result;
}

function buildEntries() {
  return buildEntriesFrom(survRows, powerRows, state.vehicles);
}

// ---------- Фильтры и рендер ----------
// Маркеры и список фильтруются фильтрами сайдбара (статус/филиал; список ещё и поиском).
function filteredEntries() {
  if (state.appMode !== 'online') return entries;
  const f = getVehicleFilters();
  return entries.filter((e) => {
    if (f.status !== 'all' && e.status !== f.status) return false;
    if (f.fleet !== 'all' && String(e.fleet) !== String(f.fleet)) return false;
    return true;
  });
}

function applyFilters() {
  syncMarkers(filteredEntries());
  renderOnlineVehicleList();
  updateMeta();
}

function rebuild() {
  entries = buildEntries();
  applyFilters();
  fillOnlineKpis();
  panToSelected();
  // первые полученные данные: показать весь автопарк (только в online-режиме)
  if (!didFit && entries.some((e) => e.hasCoords)) {
    didFit = true;
    if (state.appMode === 'online') fitToEntries();
  }
}

// Обзор всех online ТС на карте (при входе в режим)
function fitToEntries() {
  const map = getMap();
  if (!map) return;
  const pts = entries.filter((e) => e.hasCoords).map((e) => [e.lat, e.lng]);
  if (!pts.length) return;
  try { map.fitBounds(pts, { padding: [60, 60], maxZoom: 15 }); } catch (e) { /* ignore */ }
}

// Авто-слежение: карта следует за целевым ТС при каждом обновлении.
// Цель — followId (последний клик по ТС/кнопке слежения), иначе выбранное ТС.
function currentFollowId() {
  if (followId) return followId;
  return state.selectedVehicle ? String(state.selectedVehicle.id) : null;
}

function panToSelected() {
  if (!followEnabled || state.appMode !== 'online') return;
  const id = currentFollowId();
  if (!id) return;
  const e = entries.find((x) => String(x.id) === id);
  const map = getMap();
  if (e && e.hasCoords && map) map.panTo([e.lat, e.lng]);
}

function setFollow(enabled, id) {
  followEnabled = enabled;
  if (id) followId = String(id);
  const chk = document.getElementById('onlineFollowChk');
  if (chk) chk.checked = enabled;
  if (enabled) panToSelected();
}

// Длительность состояния по wdate: «меньше минуты», «N мин», «N ч», «N дн», «N мес», «N лет»
function humanDuration(ms) {
  if (!isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'меньше минуты';
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} дн`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} мес`;
  return `${Math.floor(mo / 12)} лет`;
}

// Строка состояния карточки: вместо даты — сколько длится состояние
function stateLineOf(e) {
  if (e.ts == null) return STATUS_TITLE[e.status] || '';
  const dur = humanDuration(Date.now() - e.ts);
  if (e.status === 'offline') return `Нет связи ${dur}`;
  if (e.status === 'stopped') return `Стоянка ${dur}`;
  if (e.status === 'moving') return `В движении ${dur}`;
  return STATUS_TITLE[e.status] || '';
}

// Правая панель в online-режиме: записи Surv карточками в стиле исходного списка ТС.
function renderOnlineVehicleList() {
  if (state.appMode !== 'online') return;
  const container = document.getElementById('vehicleList');
  if (!container) return;
  const f = getVehicleFilters();
  const q = (f.query || '').toLowerCase();
  const list = entries.filter((e) => {
    if (f.status !== 'all' && e.status !== f.status) return false;
    if (f.fleet !== 'all' && String(e.fleet) !== String(f.fleet)) return false;
    if (q) {
      const inNumber = (e.number || '').toLowerCase().includes(q);
      const inId = String(e.id).includes(q);
      if (!inNumber && !inId) return false;
    }
    return true;
  });

  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = '<div class="text-xs text-gray-500 p-2">Ничего не найдено.</div>';
    return;
  }

  list.forEach((e) => {
    const selected = state.selectedVehicle && String(state.selectedVehicle.id) === String(e.id);
    const dot = STATUS_DOT[e.status] || STATUS_DOT.nodata;
    const card = document.createElement('div');
    card.className = `vehicle-card p-2.5 rounded-lg cursor-pointer border flex items-center justify-between bg-darkbg-900/80 ${
      selected ? 'selected border-brand-500/80' : 'border-gray-800 hover:border-gray-700'
    }`;
    card.innerHTML = `
      <div class="flex items-center space-x-3 min-w-0">
        <div class="p-2 rounded bg-darkbg-700 text-brand-400 shrink-0"><i class="fa-solid fa-truck"></i></div>
        <div class="min-w-0">
          <div class="font-bold text-xs text-gray-100 truncate">${escapeHtml(e.number || `id ${e.id}`)}</div>
          <div class="text-[11px] text-gray-400 truncate mt-0.5 flex items-center gap-1">
            <span class="bg-darkbg-700 px-1.5 py-0.5 rounded text-gray-300 font-mono">id ${escapeHtml(String(e.id))}</span>
            ${e.fleetName ? `<span class="bg-darkbg-700 px-1.5 py-0.5 rounded text-gray-300" title="Филиал">${escapeHtml(e.fleetName)}</span>` : ''}
            <span>• ${e.speed != null ? Math.round(e.speed) : '—'} км/ч</span>
          </div>
          <div class="text-[10px] text-gray-500 mt-0.5">${escapeHtml(stateLineOf(e))}</div>
        </div>
      </div>
      <span class="w-2 h-2 rounded-full shrink-0 ${dot}" title="${escapeHtml(STATUS_TITLE[e.status] || '')}"></span>`;
    card.addEventListener('click', () => {
      const v = state.vehicles.find((item) => String(item.id) === String(e.id));
      state.selectedVehicle = v || { id: e.id, number: e.number };
      state.deviceId = String(e.id);
      updateHeaderVehicle();
      emit('online-focus-request', state.selectedVehicle);
      renderOnlineVehicleList();
    });
    container.appendChild(card);
  });
}

// ---------- Маркеры: персистентные, плавное движение к цели ----------
function markerHtml(e) {
  const cls = `online-marker-${e.status}`;
  // курса в боевом Surv нет — без курса рисуем машинку; курс вычисляется по треку
  const inner = e.course != null
    ? `<i class="fa-solid fa-arrow-up" style="transform: rotate(${Math.round(e.course)}deg)"></i>`
    : '<i class="fa-solid fa-truck"></i>';
  return `<div class="online-marker ${cls}">${inner}</div>`;
}

function buildPopupHtml(e) {
  const lines = [];
  lines.push(`<div class="popup-title">${escapeHtml(e.number || `ТС id ${e.id}`)}</div>`);
  lines.push(`Статус: ${STATUS_TITLE[e.status] || e.status}`);
  if (e.fleetName) lines.push(`Филиал: ${escapeHtml(e.fleetName)}`);
  if (e.speed != null) lines.push(`Скорость: ${Math.round(e.speed)} км/ч`);
  if (e.course != null) lines.push(`Курс: ${Math.round(e.course)}°`);
  if (e.wdate) lines.push(`Время: ${escapeHtml(e.wdate)}`);
  // сводка уже содержит свою подпись («Контроль: … · Дата: …») — префикс не нужен;
  // потеря внешнего питания подсвечивается
  if (e.power) {
    const cls = e.powerState === 'off' ? 'online-power-off' : (e.powerState === 'on' ? 'online-power-on' : '');
    lines.push(cls ? `<span class="${cls}">${escapeHtml(e.power)}</span>` : escapeHtml(e.power));
  }
  lines.push(
    `<button type="button" class="btn btn-xs" data-online-follow title="Карта будет следовать за этим ТС"><i class="fa-solid fa-location-arrow"></i> Авто-слежение</button>`
  );
  return lines.join('<br>');
}

// Синхронизация маркеров со снапшотом: создание новых, анимация к новым целям,
// удаление пропавших. Маркеры живут между циклами — позиции интерполируются.
function syncMarkers(list) {
  const group = getOnlineLayer();
  if (!group) return;
  const alive = new Set();
  list.forEach((e) => {
    if (!e.hasCoords) return;
    const id = String(e.id);
    alive.add(id);
    let marker = markerById.get(id);
    if (!marker) {
      marker = createOnlineMarker(e, group);
      markerById.set(id, marker);
    } else {
      // обновляем привязку к свежей записи и содержимое попапа/подписи
      marker.setPopupContent(buildPopupHtml(e));
      marker.setTooltipContent(escapeHtml(e.number || `id ${e.id}`));
      retargetMarker(marker, e);
    }
    e.markerRef = marker;
    marker._onlineEntry = e;
  });
  for (const [id, marker] of markerById) {
    if (!alive.has(id)) {
      group.removeLayer(marker);
      markerById.delete(id);
      animatedPos.delete(id);
    }
  }
}

function createOnlineMarker(e, group) {
  const id = String(e.id);
  const icon = L.divIcon({
    className: '',
    html: markerHtml(e),
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
  const marker = L.marker([e.lat, e.lng], { icon }).addTo(group);
  animatedPos.set(id, { lat: e.lat, lng: e.lng }); // первый снапшот — без анимации
  // номер — постоянная подпись под значком
  marker.bindTooltip(escapeHtml(e.number || `id ${e.id}`), {
    permanent: true, direction: 'bottom', offset: [0, 8], className: 'online-label',
  });
  marker.bindPopup(buildPopupHtml(e));
  marker.on('popupopen', () => {
    const popupEl = marker.getPopup() && marker.getPopup().getElement();
    if (!popupEl) return;
    // «Авто-слежение» — тоггл слежения за этим ТС; запись берём актуальную с маркера
    const current = marker._onlineEntry;
    const followBtn = popupEl.querySelector('[data-online-follow]');
    if (followBtn && current) {
      const entryId = String(current.id);
      const sync = () => {
        const active = followEnabled && currentFollowId() === entryId;
        followBtn.classList.toggle('btn-online-active', active);
        followBtn.innerHTML = active
          ? '<i class="fa-solid fa-pause"></i> Слежение вкл'
          : '<i class="fa-solid fa-location-arrow"></i> Авто-слежение';
      };
      sync();
      followBtn.addEventListener('click', () => {
        const active = followEnabled && currentFollowId() === entryId;
        setFollow(!active, entryId);
        sync();
      });
    }
  });
  return marker;
}

// Текущая отображаемая позиция маркера (с учётом незавершённой анимации)
function displayedPosOf(marker) {
  const a = marker._anim;
  if (!a) {
    const ll = marker.getLatLng();
    return { lat: ll.lat, lng: ll.lng };
  }
  const p = Math.min(1, (performance.now() - a.start) / ANIM_MS);
  return {
    lat: a.from.lat + (a.to.lat - a.from.lat) * p,
    lng: a.from.lng + (a.to.lng - a.from.lng) * p,
  };
}

// Новая цель для маркера: плавная интерполяция от текущей отображаемой позиции
function retargetMarker(marker, e) {
  const id = String(e.id);
  const to = { lat: e.lat, lng: e.lng };
  const target = animatedPos.get(id);
  if (!target) { // маркер без позиции (не должно случаться) — ставим мгновенно
    animatedPos.set(id, to);
    marker.setLatLng(to);
    marker._anim = null;
    return;
  }
  const from = displayedPosOf(marker);
  const dist = haversineM(from.lat, from.lng, to.lat, to.lng);
  animatedPos.set(id, to);
  if (rafId == null || dist > SNAP_M) { // анимация не running или GPS-скачок — мгновенно
    marker.setLatLng(to);
    marker._anim = null;
  } else if (dist > 0.5) {
    marker._anim = { from, to, start: performance.now() };
    applyBearing(marker, bearingDeg(from.lat, from.lng, to.lat, to.lng));
  } else {
    marker._anim = null; // стоит на месте
  }
}

// Курс иконки по направлению движения (стрелка вместо машинки)
function applyBearing(marker, deg) {
  const el = marker.getElement();
  const icon = el && el.querySelector('.online-marker i');
  if (!icon) return;
  icon.className = 'fa-solid fa-arrow-up';
  icon.style.transform = `rotate(${Math.round(deg)}deg)`;
}

function startAnimLoop() {
  if (rafId != null) return;
  const step = () => {
    tickAnim();
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
}

function stopAnimLoop() {
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = null;
  markerById.forEach((marker) => { marker._anim = null; }); // догоняют мгновенно
}

function tickAnim() {
  const now = performance.now();
  markerById.forEach((marker) => {
    const a = marker._anim;
    if (!a) return;
    const p = Math.min(1, (now - a.start) / ANIM_MS);
    const lat = a.from.lat + (a.to.lat - a.from.lat) * p;
    const lng = a.from.lng + (a.to.lng - a.from.lng) * p;
    marker.setLatLng([lat, lng]);
    if (p >= 1) marker._anim = null;
  });
}

function focusEntry(e) {
  if (!e || !e.markerRef) {
    showToast('Нет координат для этого ТС');
    return;
  }
  const map = getMap();
  if (!map) return;
  map.setView(e.markerRef.getLatLng(), Math.max(map.getZoom(), 15));
  setTimeout(() => e.markerRef.openPopup(), 50);
  pulseMarker(e.markerRef);
}

function pulseMarker(marker) {
  const el = marker.getElement();
  if (!el) return;
  const div = el.querySelector('.online-marker');
  if (div) {
    div.classList.add('pulsed');
    setTimeout(() => div.classList.remove('pulsed'), 2500);
  }
}

function updateMeta() {
  const t = lastUpdatedAt ? lastUpdatedAt.toLocaleTimeString('ru-RU') : '';
  const badgeTime = document.getElementById('onlineLiveBadgeTime');
  if (badgeTime) badgeTime.textContent = t;
  const statsEl = document.getElementById('onlineStats');
  if (statsEl) {
    const c = statusCounts(entries);
    statsEl.textContent = `В пути ${c.moving} · Стоянка ${c.stopped} · Нет связи ${c.offline}`;
  }
}

function statusCounts(list) {
  const c = { moving: 0, stopped: 0, offline: 0 };
  list.forEach((e) => { if (c[e.status] != null) c[e.status] += 1; });
  return c;
}

// KPI дашборда в online-режиме (вызывается bootstrap через updateKpis)
export function fillOnlineKpis() {
  if (state.appMode !== 'online') return;
  const c = statusCounts(entries);
  let speedSum = 0; let speedCnt = 0; let powerOff = 0;
  entries.forEach((e) => {
    if (e.status === 'moving' && e.speed != null) { speedSum += e.speed; speedCnt += 1; }
    if (e.powerState === 'off') powerOff += 1;
  });
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const setIcon = (id, name) => {
    const label = document.getElementById(id);
    const icon = label ? label.closest('.glass-panel').querySelector('i') : null;
    if (icon) icon.className = `fa-solid ${name} text-lg`;
  };
  const tooltips = [
    'Количество ТС в движении: скорость выше 5 км/ч, данные не старше 30 минут',
    'Количество ТС на стоянке: скорость до 5 км/ч, данные не старше 30 минут',
    'Количество ТС без свежих данных более 30 минут',
    'Количество ТС с отключённым внешним питанием',
    'Средняя скорость ТС, которые находятся в движении',
    'Количество транспортных средств, отображаемых на карте',
    'Время последнего обновления данных Online Мониторинга',
  ];
  tooltips.forEach((title, i) => {
    const label = document.getElementById(`kpiL${i + 1}`);
    const card = label ? label.closest('.glass-panel') : null;
    if (card) card.title = title;
  });
  setText('kpiL1', 'В пути');            setText('statTime', `${c.moving} ТС`);          setIcon('kpiL1', 'fa-truck-fast');
  setText('kpiL2', 'Стоянка');           setText('statSpeed', `${c.stopped} ТС`);         setIcon('kpiL2', 'fa-square-parking');
  setText('kpiL3', 'Нет связи');         setText('statEvents', `${c.offline} ТС`);        setIcon('kpiL3', 'fa-link-slash');
  setText('kpiL4', 'Потеря питания');    setText('statFuelConsumption', `${powerOff} ТС`); setIcon('kpiL4', 'fa-plug-circle-xmark');
  setText('kpiL5', 'Ср. скорость в пути'); setText('statFuelMotoHours', speedCnt ? `${Math.round(speedSum / speedCnt)} км/ч` : '—'); setIcon('kpiL5', 'fa-gauge-high');
  setText('kpiL6', 'ТС на карте');       setText('statVehicle', `${entries.length} ТС`);   setIcon('kpiL6', 'fa-map-location-dot');
  setText('kpiL7', 'Обновлено');         setText('statDistance', lastUpdatedAt ? lastUpdatedAt.toLocaleTimeString('ru-RU') : '—'); setIcon('kpiL7', 'fa-rotate');
}

export function getOnlineCount() {
  return entries.length;
}
