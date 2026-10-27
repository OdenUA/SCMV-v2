// Период анализа: чтение/запись полей, пресеты, связка дат.

import { buildLocalDateParam } from '../core/utils.js';

function toLocalInput(d) {
  const p = (n) => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function getDates() {
  const fromEl = document.getElementById('startDate');
  const toEl = document.getElementById('endDate');
  return {
    dateFrom: buildLocalDateParam(fromEl ? fromEl.value : '', false),
    dateTo: buildLocalDateParam(toEl ? toEl.value : '', true),
  };
}

export function setDates(from, to) {
  const fromEl = document.getElementById('startDate');
  const toEl = document.getElementById('endDate');
  if (fromEl) fromEl.value = from;
  if (toEl) toEl.value = to;
}

export function setDefaultDates() {
  const today = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  const date = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  setDates(`${date}T00:00`, `${date}T23:59`);
}

export function applyPreset(preset) {
  const now = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  const fmt = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  let from;
  let to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59);
  if (preset === 'today') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0);
  } else if (preset === 'yesterday') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0);
    to = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59);
  } else if (preset === 'week') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0);
  } else {
    return;
  }
  setDates(toLocalInput(from), toLocalInput(to));
}

let dateLockEnabled = false;
export function isDateLockEnabled() { return dateLockEnabled; }

export function initDates(onChange) {
  try {
    dateLockEnabled = localStorage.getItem('dateLockEnabled') === '1';
  } catch (e) { /* ignore */ }
  const lockBtn = document.getElementById('dateLockBtn');
  const updateLockBtn = () => {
    lockBtn.textContent = dateLockEnabled ? '🔒' : '🔓';
    lockBtn.setAttribute('aria-pressed', String(dateLockEnabled));
  };
  updateLockBtn();

  lockBtn.addEventListener('click', () => {
    dateLockEnabled = !dateLockEnabled;
    try {
      if (dateLockEnabled) localStorage.setItem('dateLockEnabled', '1');
      else localStorage.removeItem('dateLockEnabled');
    } catch (e) { /* ignore */ }
    updateLockBtn();
    if (dateLockEnabled) syncLock();
    onChange && onChange();
  });

  const syncLock = () => {
    if (!dateLockEnabled) return;
    const fromEl = document.getElementById('startDate');
    const toEl = document.getElementById('endDate');
    if (!fromEl || !fromEl.value) return;
    toEl.value = `${fromEl.value.slice(0, 10)}T23:59`;
  };

  // Закрытие календаря после выбора даты. Пикер открывается кликом мышью — такое
  // взаимодействие помечаем; любой ввод с клавиатуры (стрелки, набор) метку
  // снимает, чтобы правка не теряла фокус. Мышиный выбор с полным значением
  // (дата+время уже есть) закрывает попап сразу (blur по input); неполное время
  // не закрывает — попап сам закроется после выбора времени. blur из change не
  // делаем: браузер шлёт change и при правке стрелками — это срывало бы фокус.
  ['startDate', 'endDate'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    let mousePick = false;
    el.addEventListener('mousedown', () => { mousePick = true; });
    el.addEventListener('keydown', () => { mousePick = false; });
    el.addEventListener('input', () => {
      if (mousePick && (!el.value || el.value.length >= 16)) el.blur();
    });
    el.addEventListener('change', () => { mousePick = false; });
  });

  document.getElementById('startDate').addEventListener('change', () => {
    if (dateLockEnabled) syncLock();
    onChange && onChange();
  });
  document.getElementById('endDate').addEventListener('change', () => onChange && onChange());

  document.getElementById('copyDateFromToBtn').addEventListener('click', () => {
    const fromEl = document.getElementById('startDate');
    const toEl = document.getElementById('endDate');
    if (fromEl && fromEl.value && toEl) {
      toEl.value = `${fromEl.value.slice(0, 10)}T23:59`;
      onChange && onChange();
    }
  });

  document.querySelectorAll('.preset-date-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-date-btn').forEach((b) => {
        b.classList.toggle('bg-brand-600', b === btn);
        b.classList.toggle('text-white', b === btn);
        b.classList.toggle('bg-darkbg-700', b !== btn);
        b.classList.toggle('text-gray-300', b !== btn);
      });
      applyPreset(btn.dataset.preset);
      onChange && onChange();
    });
  });

  const shiftDate = (el, days) => {
    if (!el || !el.value) return;
    const date = new Date(el.value);
    if (Number.isNaN(date.getTime())) return;
    date.setDate(date.getDate() + days);
    el.value = toLocalInput(date);
  };

  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (document.querySelector('.modal-overlay.open')) return;
    const target = event.target instanceof Element ? event.target : null;
    const dateInput = target && target.closest('#startDate, #endDate');
    const interactive = target && target.closest('input, textarea, select, button, a, [contenteditable="true"]');

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (interactive && !dateInput) return;
      const fromEl = document.getElementById('startDate');
      const toEl = document.getElementById('endDate');
      const days = event.key === 'ArrowUp' ? 1 : -1;
      event.preventDefault();
      if (dateInput) {
        shiftDate(dateInput, days);
        if (dateInput.id === 'startDate') syncLock();
      } else {
        shiftDate(fromEl, days);
        if (dateLockEnabled) syncLock();
        else shiftDate(toEl, days);
      }
      onChange && onChange();
      return;
    }

    if (event.key !== 'Enter' || event.repeat || (interactive && !dateInput)) return;
    event.preventDefault();
    if (dateInput) dateInput.blur();
    const loadBtn = document.getElementById('btnLoadTrack');
    if (loadBtn) loadBtn.click();
  });

  if (!document.getElementById('startDate').value) setDefaultDates();
}
