// Админ-панель v2.1 — bootstrap: сессия, WS-статус в шапке, навигация по разделам.

import { auth, initAuth, requireSession, performLogout, onAuthChange } from '../core/auth.js';
import { connect, close, onWsEvent, isOpen } from '../core/ws.js';
import { initModals } from '../core/components.js';
import { copyToClipboard, showToast } from '../core/utils.js';
import { initVehicleList, loadVehicleList, initVehicleEdit, loadVehicleEdit } from './vehicle-list.js';
import { initDeviceEdit, loadDeviceEdit } from './device-edit.js';
import { initDeviceStatus, loadDeviceStatus } from './device-status.js';
import { initAudit } from './audit.js';
import { initReports } from './reports.js';
import { initDeviceAdd } from './device-add.js';
import { initDashboard } from '../app/bootstrap.js';

if (!requireSession()) {
  // requireSession уже перенаправил на login.html
  throw new Error('Нет активной сессии');
}

// ---------- Статус соединения в шапке ----------
const statusDot = document.getElementById('wsStatusDot');
const statusText = document.getElementById('statusText');
const lastResponseEl = document.getElementById('lastResponse');
let statusTimer = null;

const DOT_COLORS = {
  red: 'bg-rose-500',
  green: 'bg-emerald-500',
  blue: 'bg-brand-500',
  gray: 'bg-gray-500',
};

function setDot(color) {
  if (!statusDot) return;
  Object.values(DOT_COLORS).forEach((c) => statusDot.classList.remove(c));
  statusDot.classList.add(DOT_COLORS[color] || DOT_COLORS.gray);
}

function setStatus(text, color, autoClearMs) {
  if (statusText) statusText.textContent = text;
  setDot(color || 'gray');
  if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
  if (autoClearMs) {
    statusTimer = setTimeout(() => {
      if (statusText) statusText.textContent = isOpen() ? 'Подключено' : 'Не подключено';
      setDot(isOpen() ? 'green' : 'red');
    }, autoClearMs);
  }
}

onWsEvent((event, payload) => {
  try {
    if (event === 'open') {
      setStatus('Подключено', 'green');
    } else if (event === 'close') {
      setStatus('Соединение закрыто', 'red');
    } else if (event === 'status' && payload) {
      setStatus(payload.text || '', payload.color || 'gray', payload.autoClearMs);
    } else if (event === 'response' && payload) {
      if (lastResponseEl) {
        const t = new Date(payload.at);
        const hh = String(t.getHours()).padStart(2, '0');
        const mm = String(t.getMinutes()).padStart(2, '0');
        const ss = String(t.getSeconds()).padStart(2, '0');
        lastResponseEl.textContent = `${payload.name} ${hh}:${mm}:${ss}`;
      }
    } else if (event === 'login-ok') {
      setStatus('Вход выполнен', 'green', 4000);
      updateUserBlock();
      // данные активного раздела запрашивались до установки соединения — повторяем
      reloadActiveSection();
    } else if (event === 'login-failed') {
      setStatus('Ошибка логина', 'red');
    }
  } catch (e) {
    console.warn('status handler error', e);
  }
});

function updateUserBlock() {
  const nameEl = document.getElementById('userName');
  const avatarEl = document.getElementById('userAvatar');
  if (nameEl) nameEl.textContent = auth.user || '—';
  if (avatarEl) avatarEl.textContent = (auth.user || '?').charAt(0).toUpperCase();
}
onAuthChange(updateUserBlock);

// ---------- Логаут ----------
document.getElementById('logoutBtn').addEventListener('click', () => {
  try {
    close(); // закрываем сокет до очистки localStorage
  } catch (e) {
    console.warn('close socket failed', e);
  }
  performLogout();
});

// ---------- Навигация по разделам ----------
// lazy-load: каждый раздел догружает свои данные при первом показе (и при каждом повторном)
const SECTIONS = {
  'vehicle-list': { init: initVehicleList, load: loadVehicleList },
  'vehicle-edit': { init: initVehicleEdit, load: loadVehicleEdit },
  'device-edit': { init: initDeviceEdit, load: loadDeviceEdit },
  'device-status': { init: initDeviceStatus, load: loadDeviceStatus },
  audit: { init: initAudit, load: null },
  reports: { init: initReports, load: null },
};

const navButtons = document.querySelectorAll('.admin-nav-btn');
const initialized = new Set();
let activeSectionName = null;

// ---------- Сворачивание левой навигации до иконок ----------
const sideNav = document.getElementById('adminSideNav');
const navToggle = document.getElementById('adminNavToggle');
const NAV_COLLAPSED_KEY = 'adminNavCollapsed';

function applyNavCollapsed(collapsed) {
  if (!sideNav) return;
  sideNav.classList.toggle('w-60', !collapsed);
  sideNav.classList.toggle('w-14', collapsed);
  sideNav.querySelectorAll('.nav-label').forEach((el) => el.classList.toggle('hidden', collapsed));
  sideNav.querySelectorAll('.admin-nav-btn').forEach((b) => {
    b.classList.toggle('justify-center', collapsed);
    b.classList.toggle('space-x-3', !collapsed);
    b.classList.toggle('px-3', !collapsed);
    b.classList.toggle('px-0', collapsed);
  });
  if (navToggle) {
    const icon = navToggle.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-chevron-left', !collapsed);
      icon.classList.toggle('fa-chevron-right', collapsed);
    }
    navToggle.title = collapsed ? 'Развернуть меню' : 'Свернуть меню до иконок';
  }
  try { localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
}

let navCollapsed = false;
try { navCollapsed = localStorage.getItem(NAV_COLLAPSED_KEY) === '1'; } catch (e) { /* ignore */ }
if (navToggle) {
  navToggle.addEventListener('click', () => {
    navCollapsed = !navCollapsed;
    applyNavCollapsed(navCollapsed);
  });
}
applyNavCollapsed(navCollapsed);

function reloadActiveSection() {
  if (!activeSectionName) return;
  const mod = SECTIONS[activeSectionName];
  if (mod && mod.load) {
    try { mod.load(); } catch (e) { console.warn('reload section failed', e); }
  }
}

function activateSection(name) {
  activeSectionName = name;
  document.querySelectorAll('.admin-section').forEach((s) => s.classList.add('hidden'));
  const section = document.getElementById(`section-${name}`);
  if (section) section.classList.remove('hidden');

  navButtons.forEach((btn) => {
    const active = btn.dataset.section === name;
    btn.classList.toggle('bg-brand-600', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('text-gray-400', !active);
    btn.classList.toggle('hover:bg-darkbg-700', !active);
  });

  // Мониторинг — полный функционал дашборда (общий шаблон и модули)
  if (name === 'monitoring') {
    try {
      initDashboard({
        tabs: ['stops', 'anomalies', 'devlog', 'analysis', 'fuel-events', 'fuel-summary', 'fuel-daily'],
        actions: ['track', 'raw', 'analyze', 'devlog'],
        clipboard: true,
        adminTools: true,
        mapDistanceOnly: true,
        vehicleSource: 'show', // все устройства (Vehicle Show), а не ТС пользователя (Vehicle Select Min)
        wireHeader: false, // шапку и соединение ведёт админка
        connect: false,
        mount: '#dashboardMount',
      });
    } catch (e) {
      console.error('initDashboard (monitoring) failed:', e);
    }
    return;
  }

  const mod = SECTIONS[name];
  if (!mod) return;
  try {
    if (!initialized.has(name) && mod.init) {
      initialized.add(name);
      mod.init();
    }
    if (mod.load) mod.load();
  } catch (e) {
    console.warn(`init/load раздела ${name} завершился ошибкой`, e);
  }
}

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => activateSection(btn.dataset.section));
});

// ---------- Запуск ----------
initAuth();
initModals();

// Кнопка «Копировать» в SQL-модалке
const copySqlBtn = document.getElementById('copySqlBtn');
if (copySqlBtn) {
  copySqlBtn.addEventListener('click', async () => {
    const out = document.getElementById('sqlOutput');
    if (!out) return;
    const ok = await copyToClipboard(out.textContent || '');
    if (ok) showToast('SQL скопирован в буфер обмена');
  });
}

initDeviceAdd();

connect({ autoLogin: true });
updateUserBlock();
activateSection('monitoring');
