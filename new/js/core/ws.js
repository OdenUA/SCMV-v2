// WebSocket: соединение, авто-логин, диспетчер пакетов, реконнект.
// Заменяет hook-цепочку v2 единым реестром обработчиков (onPacket).

import { getWsUrl } from './config.js';
import { auth, storedCredentials, setAuthInfo, resetAuthState } from './auth.js';

let socket = null;
let manualClose = false;
let reconnectTimer = null;
let autoLoginEnabled = true;
let attempt = 0;

export function getSocket() { return socket; }
export function isOpen() { return !!socket && socket.readyState === WebSocket.OPEN; }

// ---------- События статуса ----------
const wsListeners = new Set();
export function onWsEvent(fn) {
  wsListeners.add(fn);
  return () => wsListeners.delete(fn);
}
function emit(event, payload) {
  wsListeners.forEach((fn) => { try { fn(event, payload); } catch (e) { console.error(e); } });
}

// ---------- Индикатор загрузки: считаем незавершённые запросы ----------
const inflight = new Map(); // rid -> {name, timer}
let ridSeq = 0;
const INFLIGHT_TIMEOUT_MS = 30000; // подстраховка: запрос без ответа не держит индикатор вечно

function emitLoading() {
  emit('loading', { count: inflight.size });
}

function trackInflight(name) {
  const rid = ++ridSeq;
  const timer = setTimeout(() => {
    if (inflight.delete(rid)) emitLoading();
  }, INFLIGHT_TIMEOUT_MS);
  inflight.set(rid, { name, timer });
  emitLoading();
}

function untrackByName(name) {
  for (const [rid, v] of inflight) {
    if (v.name === name) {
      clearTimeout(v.timer);
      inflight.delete(rid);
      emitLoading();
      return;
    }
  }
}

function clearInflight() {
  if (!inflight.size) return;
  inflight.forEach((v) => clearTimeout(v.timer));
  inflight.clear();
  emitLoading();
}

// Видимый индикатор загрузки в шапке (#loadIndicator). Вызывается из connect() —
// сама находит элементы, если разметка есть на странице (дашборд/админка).
let loadIndicatorBound = false;
export function initLoadIndicator() {
  if (loadIndicatorBound) return;
  const box = document.getElementById('loadIndicator');
  if (!box) return;
  loadIndicatorBound = true;
  const textEl = document.getElementById('loadIndicatorText');
  let current = 0;
  onWsEvent((event, payload) => {
    if (event !== 'loading' || !payload) return;
    const n = payload.count || 0;
    if (n === current) return;
    current = n;
    if (n > 0) {
      box.classList.remove('hidden');
      box.classList.add('inline-flex');
      if (textEl) textEl.textContent = n > 1 ? `Загрузка данных (${n})…` : 'Загрузка данных…';
    } else {
      box.classList.add('hidden');
      box.classList.remove('inline-flex');
    }
  });
}

// ---------- Реестр обработчиков пакетов ----------
// handler(data) → вернуть true = пакет «поглощён» (остальные не вызываются)
const packetHandlers = [];
let handlerSeq = 0;

/**
 * Подписаться на пакеты сервера.
 * @param {string} name значение data.name
 * @param {(data:object)=>boolean|void} fn вернуть true для consume
 * @param {object} opts {predicate(data), once, priority(больше=раньше)}
 * @returns функция отписки
 */
export function onPacket(name, fn, opts = {}) {
  const h = {
    id: ++handlerSeq,
    name,
    fn,
    predicate: opts.predicate || null,
    once: !!opts.once,
    priority: opts.priority || 0,
  };
  packetHandlers.push(h);
  packetHandlers.sort((a, b) => b.priority - a.priority);
  return () => {
    const i = packetHandlers.indexOf(h);
    if (i !== -1) packetHandlers.splice(i, 1);
  };
}

/** Одноразовое ожидание пакета как Promise. */
export function waitForPacket(name, predicate = null, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Timeout waiting for ' + name)); }, timeoutMs);
    const off = onPacket(name, (data) => {
      if (predicate && !predicate(data)) return false;
      clearTimeout(timer);
      off();
      resolve(data);
      return true;
    });
  });
}

// ---------- Отправка ----------
export function sendRaw(obj) {
  if (!isOpen()) {
    emit('status', { text: 'WebSocket не подключен.', color: 'red' });
    return false;
  }
  try {
    socket.send(JSON.stringify(obj));
    trackInflight(obj && obj.name ? obj.name : '');
    emit('status', { text: 'Запрос отправлен. Ожидание ответа...', color: 'blue' });
    return true;
  } catch (e) {
    console.warn('send failed', e);
    return false;
  }
}

/** Дополнить пакет учётными данными и отправить. */
export function sendRequest(partial) {
  const req = {
    usr: auth.user,
    pwd: auth.pwd,
    uid: auth.uid,
    ...partial,
  };
  return sendRaw(req);
}

export function buildLoginRequest(user, pwd) {
  return {
    name: 'login', type: 'login', mid: 0, act: 'setup',
    usr: user, pwd, uid: 0, lang: 'en',
  };
}

export function sendLogin() {
  if (!isOpen()) return false;
  const { user, pwd } = storedCredentials();
  if (!user || !pwd) return false;
  auth.loginInProgress = true;
  auth.lastLoginFailed = false;
  emit('status', { text: 'Отправка логина...', color: 'blue' });
  return sendRaw(buildLoginRequest(user, pwd));
}

// ---------- Соединение ----------
export function connect({ autoLogin = true } = {}) {
  autoLoginEnabled = autoLogin;
  manualClose = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  initLoadIndicator(); // индикатор загрузки данных в шапке (если разметка есть)
  emit('status', { text: 'Подключение...', color: 'gray' });

  socket = new WebSocket(getWsUrl());

  socket.onopen = () => {
    attempt = 0;
    emit('open');
    emit('status', { text: 'Соединение установлено.', color: 'green', autoClearMs: 4000 });
    if (autoLoginEnabled && !auth.loggedIn) sendLogin();
  };

  socket.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (e) { console.warn('Bad WS message', e); return; }
    if (data && data.name) emit('response', { name: data.name, at: Date.now() });
    dispatch(data);
  };

  socket.onclose = () => {
    const loginFailed = !!auth.lastLoginFailed;
    resetAuthState();
    clearInflight(); // незавершённые запросы пропали вместе с соединением
    if (manualClose) { emit('close', { manual: true }); return; }
    if (loginFailed) {
      emit('status', { text: 'Логин не выполнен. Проверьте логин/пароль.', color: 'red', autoClearMs: 8000 });
      emit('login-failed');
      return;
    }
    emit('status', { text: 'Соединение потеряно. Повторное подключение...', color: 'red' });
    emit('close', { manual: false });
    attempt += 1;
    const delay = Math.min(5000 * attempt, 30000);
    reconnectTimer = setTimeout(() => connect({ autoLogin: autoLoginEnabled }), delay);
  };

  socket.onerror = (err) => {
    emit('error', err);
    emit('status', { text: 'Ошибка соединения.', color: 'red', autoClearMs: 8000 });
  };
}

export function close() {
  manualClose = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  try { if (socket) socket.close(); } catch (e) { /* ignore */ }
}

function dispatch(data) {
  if (data && data.name) untrackByName(data.name);
  emit('status', { text: 'Ответ получен...', color: 'green', autoClearMs: 4000 });

  // Встроенная обработка логина — регистрируем «псевдо-хендлер» первым делом
  if (data.name === 'login' && data.res && data.res[0]) {
    const r = data.res[0];
    if (r.uid) {
      const { user, pwd } = storedCredentials();
      setAuthInfo(r.uid, user, pwd);
      emit('login-ok');
    } else {
      auth.loginInProgress = false;
      auth.lastLoginFailed = true;
      resetAuthState();
      emit('status', { text: 'Ошибка логина. Проверьте логин/пароль.', color: 'red', autoClearMs: 6000 });
      emit('login-failed');
      try { if (socket && socket.readyState === WebSocket.OPEN) socket.close(); } catch (_) { /* ignore */ }
    }
    return;
  }

  for (const h of [...packetHandlers]) {
    if (h.name && h.name !== data.name) continue;
    try {
      let matched = true;
      if (h.predicate) matched = !!h.predicate(data);
      if (!matched) continue;
      const consumed = h.fn(data);
      if (h.once) {
        const i = packetHandlers.indexOf(h);
        if (i !== -1) packetHandlers.splice(i, 1);
      }
      if (consumed === true) break;
    } catch (e) {
      console.error(`Handler error for ${h.name}:`, e);
    }
  }
}

/** Эхо filter из ответа сервера (сервер возвращает filter запроса). */
export function echoFilter(data) {
  return (data && Array.isArray(data.filter)) ? data.filter : [];
}

/** Значение первого ключа эха, подходящего под regexp, как строка. */
export function echoValue(data, keyRe) {
  const f = echoFilter(data);
  for (const entry of f) {
    if (!entry || typeof entry !== 'object') continue;
    for (const k of Object.keys(entry)) {
      if (keyRe.test(k)) {
        const v = entry[k];
        return Array.isArray(v) ? String(v[0]) : String(v);
      }
    }
  }
  return null;
}
