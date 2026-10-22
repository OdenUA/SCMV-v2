// Утилиты: даты, таблицы (DOM + виртуальные), SQL-генераторы, экспорт, общие helpers.
// Перенос логики utils.js / virtual_table.js / частей anomalies.js из v2.

// ---------- Даты ----------
function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** Парсер дат трека: DD.MM.YY HH:mm:ss | DD.MM.YYYY HH:mm:ss | ISO YYYY-MM-DDTHH:mm:ss (локальное). */
export function parseTrackDate(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const d = new Date(2000 + +m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
    return isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const d = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
    return isNaN(d.getTime()) ? null : d;
  }
  // ISO local — отсекаем Z/offset, парсим как локальное время
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:[Zz]|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return isNaN(d.getTime()) ? null : d;
  }
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

export function formatDate(d) {
  if (!d || isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatDateSql(d) {
  if (!d || isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Время из 'DD.MM.YY HH:mm:ss' → 'HH:MM:SS' (для индексов). */
export function timeKeyOf(str) {
  const d = parseTrackDate(str);
  if (!d) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Дополнить 'YYYY-MM-DDTHH:mm' до секунд: начало ':00', конец ':59'. */
export function buildLocalDateParam(raw, isEnd) {
  if (!raw) return '';
  if (raw.length === 16) raw += isEnd ? ':59' : ':00';
  return raw;
}

export function normalizeDateKey(str) {
  return (str || '').slice(0, 19);
}

/** 'H:MM:SS' → мс; поддержка postgres-стиля 'N years N mons N days HH:MM:SS'. */
export function parseRelativeDurationToMs(str) {
  if (!str || typeof str !== 'string') return NaN;
  const s = str.trim();
  const hm = s.match(/^(?:(\d+)\s+days?\s+)?(\d{1,3}):(\d{2}):(\d{2})$/);
  if (hm && !/\D+\s+\D+/.test(s.replace(/^\d+\s+days?\s+/, ''))) {
    const days = hm[1] ? +hm[1] : 0;
    return ((days * 24 + +hm[2]) * 3600 + +hm[3] * 60 + +hm[4]) * 1000;
  }
  const full = s.match(/^(?:(\d+)\s+years?\s+)?(?:(\d+)\s+mons?\s+)?(?:(\d+)\s+days?\s+)?(\d{1,3}):(\d{2}):(\d{2})$/);
  if (full) {
    const years = full[1] ? +full[1] : 0;
    const mons = full[2] ? +full[2] : 0;
    const days = full[3] ? +full[3] : 0;
    return (((years * 365 + mons * 30 + days) * 24 + +full[4]) * 3600 + +full[5] * 60 + +full[6]) * 1000;
  }
  return NaN;
}

export function formatDuration(ms) {
  if (!isFinite(ms) || ms < 0) return '';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const mnt = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (h > 0) return `${h}:${pad2(mnt)}:${pad2(sec)}`;
  return `${mnt}:${pad2(sec)}`;
}

/** Возрастная категория строки по fdate (Date) или sdate (относительная длительность).
 * Цвет — тёмная тема: faint-тёплый оттенок растёт с возрастом (прозрачный = свежее). */
export function getRowAgeGrade(row, nowTs = Date.now()) {
  let ts = null;
  if (row.fdate) {
    const d = parseTrackDate(row.fdate) || (row.fdate instanceof Date ? row.fdate : null);
    if (d) ts = d.getTime();
  }
  if (ts == null && row.sdate) {
    const ms = parseRelativeDurationToMs(row.sdate);
    if (isFinite(ms)) ts = nowTs - ms;
  }
  if (ts == null) return { color: 'transparent', ageCategory: '0' };
  const days = (nowTs - ts) / 86400000;
  if (days > 365) return { color: 'rgba(250, 202, 202, 0.16)', ageCategory: '>365' };
  if (days > 180) return { color: 'rgba(252, 227, 211, 0.12)', ageCategory: '>180' };
  if (days > 30) return { color: 'rgba(255, 236, 199, 0.09)', ageCategory: '>30' };
  if (days > 5) return { color: 'rgba(255, 247, 236, 0.05)', ageCategory: '>5' };
  return { color: 'transparent', ageCategory: '0' };
}

// ---------- Общие ----------
export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function debounce(fn, ms) {
  let t = null;
  return function debounced(...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn.apply(this, args); }, ms);
  };
}

/** Поиск значения поля по списку имён (регистронезависимо). */
export function getField(obj, names) {
  if (!obj) return undefined;
  const lower = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase()] = obj[k];
  for (const n of names) {
    if (lower[n.toLowerCase()] !== undefined) return lower[n.toLowerCase()];
  }
  return undefined;
}

/** Расстояние между точками в метрах (haversine). */
export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

let toastTimer = null;
export function showToast(message, timeoutMs = 3000) {
  let toast = document.getElementById('toastNotification');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toastNotification';
    toast.className = 'toast-notification';
    toast.innerHTML = '<i class="fa-solid fa-circle-info toast-icon"></i><span id="toastText" class="toast-text"></span>';
    document.body.appendChild(toast);
  }
  const text = toast.querySelector('.toast-text') || toast.querySelector('#toastText');
  if (text) text.textContent = message;
  toast.classList.add('visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), timeoutMs);
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch (e2) {
      console.warn('Clipboard failed', e2);
      return false;
    }
  }
}

/** Экспорт строк (массив объектов) в XLSX через SheetJS. */
export function exportXls(rows, filename = 'export.xlsx', sheetName = 'Данные') {
  try {
    if (typeof XLSX === 'undefined') {
      showToast('Библиотека XLSX не загружена');
      return false;
    }
    const clean = rows.map((r) => {
      const o = {};
      for (const k of Object.keys(r)) {
        if (k.startsWith('__') || k === 'layer' || k === 'markerRef') continue;
        const v = r[k];
        o[k] = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v;
      }
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(clean);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    XLSX.writeFile(wb, filename);
    return true;
  } catch (e) {
    console.warn('exportXls failed', e);
    showToast('Ошибка экспорта: ' + e.message);
    return false;
  }
}

// ---------- Таблицы ----------
const VT_ROW_HEIGHT = 28;
const VT_OVERSCAN = 10;
export const VIRTUALIZE_THRESHOLD = 80;

/**
 * Универсальный рендер таблицы.
 * opts: {
 *   excludeKeys?: string[]            — скрыть ключи (по умолчанию ['layer'])
 *   headers?: string[]                — явный порядок колонок (иначе из ключей первой строки)
 *   onRowClick?(row, tr, ev), rowClass?(row), decorateRow?(row, tr),
 *   renderCell?(key, value, row) → string|Node|null,
 *   emptyMessage?: string,
 *   actionButtons?: [{title, icon, className, onClick(row)}]
 * }
 */
export function populateTable(tbody, thead, rows, opts = {}) {
  const exclude = opts.excludeKeys || ['layer'];
  tbody.innerHTML = '';
  if (thead) thead.innerHTML = '';
  if (!rows || !rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 100;
    td.textContent = opts.emptyMessage || 'Нет данных.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  const headers = (opts.headers || Object.keys(rows[0])).filter((k) => exclude.indexOf(k) === -1);
  if (thead) {
    const trh = document.createElement('tr');
    headers.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      trh.appendChild(th);
    });
    if (opts.actionButtons && opts.actionButtons.length) {
      const th = document.createElement('th');
      th.textContent = 'Actions';
      trh.appendChild(th);
    }
    thead.appendChild(trh);
  }
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    if (opts.rowClass) {
      const cls = opts.rowClass(row);
      if (cls) tr.className = cls;
    }
    headers.forEach((h) => {
      const td = document.createElement('td');
      let v = row[h];
      if (opts.renderCell) {
        const rendered = opts.renderCell(h, v, row);
        if (rendered == null) td.textContent = v == null ? '' : String(v);
        else if (rendered instanceof Node) td.appendChild(rendered);
        else td.innerHTML = String(rendered);
      } else {
        if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
        td.textContent = v == null ? '' : String(v);
      }
      tr.appendChild(td);
    });
    if (opts.actionButtons && opts.actionButtons.length) {
      const td = document.createElement('td');
      opts.actionButtons.forEach((btn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = btn.className || 'btn btn-xs';
        b.title = btn.title || '';
        b.innerHTML = btn.icon || btn.title || '?';
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          btn.onClick(row, ev);
        });
        td.appendChild(b);
      });
      tr.appendChild(td);
    }
    if (opts.onRowClick) {
      tr.addEventListener('click', (ev) => opts.onRowClick(row, tr, ev));
    }
    if (opts.decorateRow) opts.decorateRow(row, tr);
    tbody.appendChild(tr);
  });
}

// ---------- Виртуальная таблица ----------
function ensureScrollParent(tbody) {
  let el = tbody.parentElement;
  while (el && el !== document.body) {
    const overflow = getComputedStyle(el).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return el;
    el = el.parentElement;
  }
  return tbody.parentElement;
}

/**
 * Windowed-таблица для больших массивов (≥ VIRTUALIZE_THRESHOLD строк).
 * API: setRows, setHeaders, refresh, scrollToIndex, getRow(s), getRowHeight, getVisibleRange, destroy.
 */
export function createVirtualTable(opts) {
  const tbody = opts.tbody;
  const rowHeight = opts.rowHeight || VT_ROW_HEIGHT;
  const overscan = opts.overscan != null ? opts.overscan : VT_OVERSCAN;
  const renderCell = opts.renderCell || null;
  let scrollEl = opts.scrollEl || ensureScrollParent(tbody);
  let rows = opts.rows || [];
  let headers = opts.headers || (rows[0] ? Object.keys(rows[0]).filter((k) => !k.startsWith('__') && k !== 'layer') : []);
  let measuredHeight = rowHeight;
  let raf = null;
  let destroyed = false;

  function renderHead() {
    const thead = opts.thead || (tbody.parentElement ? tbody.parentElement.querySelector('thead') : null);
    if (!thead) return;
    thead.innerHTML = '';
    const trh = document.createElement('tr');
    headers.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
  }

  function renderCellInto(td, row, colKey, rowIndex) {
    let v = row ? row[colKey] : '';
    if (renderCell) {
      const rendered = renderCell(row, colKey, rowIndex);
      if (rendered == null) td.textContent = v == null ? '' : String(v);
      else if (rendered instanceof Node) td.appendChild(rendered);
      else td.innerHTML = String(rendered);
    } else {
      if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
      td.textContent = v == null ? '' : String(v);
    }
  }

  function measureRowHeight() {
    if (!rows.length) return;
    const tr = tbody.querySelector('tr[data-vt-row]');
    if (tr) {
      const h = tr.getBoundingClientRect().height;
      if (h > 4 && Math.abs(h - measuredHeight) > 1) {
        measuredHeight = h;
        scheduleRender();
      }
    }
  }

  function renderVisible() {
    if (destroyed) return;
    raf = null;
    if (!rows.length) {
      tbody.innerHTML = '';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 100;
      td.textContent = opts.emptyMessage || 'Нет данных.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
    const clientH = scrollEl ? scrollEl.clientHeight : 600;
    const total = rows.length;
    let start = Math.max(0, Math.floor(scrollTop / measuredHeight) - overscan);
    let end = Math.min(total, Math.ceil((scrollTop + clientH) / measuredHeight) + overscan);
    if (end - start < 10 && total > 10) end = Math.min(total, start + 30);

    tbody.innerHTML = '';
    const topH = start * measuredHeight;
    const bottomH = (total - end) * measuredHeight;
    if (topH > 0) {
      const sp = document.createElement('tr');
      sp.className = 'vt-spacer';
      const td = document.createElement('td');
      td.colSpan = 100;
      td.style.height = topH + 'px';
      td.style.padding = '0';
      sp.appendChild(td);
      tbody.appendChild(sp);
    }
    for (let i = start; i < end; i++) {
      const row = rows[i];
      const tr = document.createElement('tr');
      tr.dataset.vtRow = String(i);
      const cls = opts.getRowClass ? opts.getRowClass(row, i) : null;
      if (cls) tr.className = cls;
      headers.forEach((h) => {
        const td = document.createElement('td');
        renderCellInto(td, row, h, i);
        tr.appendChild(td);
      });
      if (opts.onRowClick) tr.addEventListener('click', (ev) => opts.onRowClick(row, i, tr, ev));
      if (opts.decorateRow) opts.decorateRow(row, i, tr);
      tbody.appendChild(tr);
    }
    if (bottomH > 0) {
      const sp = document.createElement('tr');
      sp.className = 'vt-spacer';
      const td = document.createElement('td');
      td.colSpan = 100;
      td.style.height = bottomH + 'px';
      td.style.padding = '0';
      sp.appendChild(td);
      tbody.appendChild(sp);
    }
    setTimeout(measureRowHeight, 0);
  }

  function scheduleRender() {
    if (destroyed) return;
    if (raf) return;
    raf = requestAnimationFrame(renderVisible);
  }

  if (scrollEl) scrollEl.addEventListener('scroll', scheduleRender, { passive: true });
  renderHead();
  scheduleRender();

  const api = {
    setRows(newRows, newHeaders) {
      rows = newRows || [];
      if (newHeaders) headers = newHeaders;
      else if (rows[0]) headers = Object.keys(rows[0]).filter((k) => !k.startsWith('__') && k !== 'layer');
      renderHead();
      if (scrollEl) scrollEl.scrollTop = 0;
      scheduleRender();
    },
    setHeaders(h) { headers = h; renderHead(); scheduleRender(); },
    refresh: scheduleRender,
    scrollToIndex(index) {
      if (!scrollEl || !rows.length) return;
      const idx = Math.max(0, Math.min(rows.length - 1, index | 0));
      let tries = 0;
      // Итеративная коррекция: после прыжка измеряем реальное смещение центра строки
      // от центра контейнера и доводим scrollTop до совпадения (устойчиво к спейсерам
      // виртуализации и неточной высоте строки).
      const step = (reset) => {
        if (reset) scrollEl.scrollTop = idx * measuredHeight;
        scheduleRender();
        setTimeout(() => {
          const tr = tbody.querySelector(`tr[data-vt-row="${idx}"]`);
          if (!tr) { if (++tries < 6) step(true); return; }
          const scRect = scrollEl.getBoundingClientRect();
          const trRect = tr.getBoundingClientRect();
          const delta = (trRect.top + trRect.height / 2) - (scRect.top + scRect.height / 2);
          if (Math.abs(delta) > 2 && ++tries < 6) {
            scrollEl.scrollTop += delta;
            scheduleRender();
            setTimeout(() => step(false), 60);
          }
        }, 60);
      };
      step(true);
    },
    getRow(i) { return rows[i]; },
    getRows() { return rows; },
    getRowHeight() { return measuredHeight; },
    getVisibleRange() {
      const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
      const clientH = scrollEl ? scrollEl.clientHeight : 600;
      return {
        start: Math.floor(scrollTop / measuredHeight),
        end: Math.ceil((scrollTop + clientH) / measuredHeight),
      };
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (scrollEl) scrollEl.removeEventListener('scroll', scheduleRender);
      if (tbody.__virtualTable === api) delete tbody.__virtualTable;
    },
  };
  tbody.__virtualTable = api;
  return api;
}

/** Точка входа: виртуализация при ≥80 строк, иначе простой DOM с теми же опциями. */
export function mountTableBody(opts) {
  const rows = opts.rows || [];
  if (rows.length >= VIRTUALIZE_THRESHOLD) {
    return createVirtualTable(opts);
  }
  // простой рендер
  const { tbody, thead } = opts;
  const headers = opts.headers || (rows[0] ? Object.keys(rows[0]).filter((k) => !k.startsWith('__') && k !== 'layer') : []);
  if (thead) {
    thead.innerHTML = '';
    const trh = document.createElement('tr');
    headers.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
  }
  tbody.innerHTML = '';
  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    const cls = opts.getRowClass ? opts.getRowClass(row, i) : null;
    if (cls) tr.className = cls;
    headers.forEach((h) => {
      const td = document.createElement('td');
      const rendered = opts.renderCell ? opts.renderCell(row, h, i) : null;
      if (rendered == null) {
        let v = row[h];
        if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
        td.textContent = v == null ? '' : String(v);
      } else if (rendered instanceof Node) td.appendChild(rendered);
      else td.innerHTML = String(rendered);
      tr.appendChild(td);
    });
    if (opts.onRowClick) tr.addEventListener('click', (ev) => opts.onRowClick(row, i, tr, ev));
    if (opts.decorateRow) opts.decorateRow(row, i, tr);
    tbody.appendChild(tr);
  });
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 100;
    td.textContent = opts.emptyMessage || 'Нет данных.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  const shim = {
    setRows(r, h) { opts.rows = r; if (h) opts.headers = h; mountTableBody(opts); },
    setHeaders(h) { opts.headers = h; mountTableBody(opts); },
    refresh() { mountTableBody(opts); },
    scrollToIndex(i) {
      const tr = tbody.children[i];
      if (tr && tr.scrollIntoView) tr.scrollIntoView({ block: 'center' });
    },
    getRow(i) { return (opts.rows || [])[i]; },
    getRows() { return opts.rows || []; },
    getRowHeight() { return VT_ROW_HEIGHT; },
    getVisibleRange() { return { start: 0, end: (opts.rows || []).length }; },
    destroy() { if (tbody.__virtualTable === shim) delete tbody.__virtualTable; },
  };
  tbody.__virtualTable = shim;
  return shim;
}

// ---------- SQL-генерация ----------
function parseAnomalyTime(str) {
  // Строгий парсер 'DD.MM.YY HH:mm:ss'
  const m = String(str || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(2000 + +m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
}

/** Разбить диапазон дат по суткам: [{from,to,dateStr}]. */
export function splitRangeByDays(start, end) {
  const parts = [];
  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return parts;
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= endDay) {
    const dayStart = cursor > start ? new Date(cursor) : new Date(start);
    const dayEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 23, 59, 59, 999);
    const to = dayEnd < end ? dayEnd : new Date(end);
    parts.push({ from: dayStart, to, dateStr: formatDateSql(dayStart).slice(0, 10) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return parts;
}

export function buildDeleteStatements(deviceId, start, end) {
  const parts = splitRangeByDays(start, end);
  return parts.map((p) =>
    `DELETE FROM snsrmain WHERE deviceid='${deviceId}' AND wdate >= '${formatDateSql(p.from)}' AND wdate <= '${formatDateSql(p.to)}';`
  );
}

export function buildRecalcStatements(deviceId, dateStrs) {
  const uniq = [...new Set(dateStrs)].sort();
  return uniq.map((d) => `SELECT recalcstartstop(${deviceId}, '${d}'::date, true);`);
}

/** SQL по объекту аномалии из таблицы (±1 с, разбиение по суткам). */
export function generateAnomalySql(anomaly, deviceId) {
  const start = parseAnomalyTime(anomaly['Start Time']);
  const end = parseAnomalyTime(anomaly['End Time']);
  if (!start || !end) return null;
  start.setSeconds(start.getSeconds() - 1);
  end.setSeconds(end.getSeconds() + 1);
  const lines = [`-- Аномалия: ${anomaly['Anomaly Type'] || ''}`];
  lines.push(...buildDeleteStatements(deviceId, start, end));
  lines.push(...buildRecalcStatements(deviceId, splitRangeByDays(start, end).map((p) => p.dateStr)));
  return lines.join('\n');
}

/** SQL для массива аномалий (условие ИЛИ, дедуп дат recalc). */
export function generateBulkAnomalySql(anomalies, deviceId, criteriaText = '') {
  const lines = [`-- Массовое удаление аномалий: ${anomalies.length} шт.`];
  if (criteriaText) lines.push(`-- ${criteriaText}`);
  const allDates = [];
  anomalies.forEach((anomaly) => {
    const start = parseAnomalyTime(anomaly['Start Time']);
    const end = parseAnomalyTime(anomaly['End Time']);
    if (!start || !end) return;
    start.setSeconds(start.getSeconds() - 1);
    end.setSeconds(end.getSeconds() + 1);
    lines.push(`-- Аномалия: ${anomaly['Anomaly Type'] || ''} (${anomaly['Start Time']} — ${anomaly['End Time']})`);
    lines.push(...buildDeleteStatements(deviceId, start, end));
    allDates.push(...splitRangeByDays(start, end).map((p) => p.dateStr));
  });
  lines.push(...buildRecalcStatements(deviceId, allDates));
  return lines.join('\n');
}

/** SQL из Type4-интервалов отчёта Full Track: iv {start,end,isAnomaly}. */
export function generateSqlFromIntervals(deviceId, intervals) {
  const targets = (intervals || []).filter((iv) => iv.isAnomaly);
  if (!targets.length) return null;
  const lines = [`-- Удаление GPS-аномалий (тип 4): ${targets.length} интервалов`];
  const allDates = [];
  targets.forEach((iv) => {
    if (!iv.start || !iv.end) return;
    const start = new Date(iv.start.getTime() - 1000);
    const end = new Date(iv.end.getTime() + 1000);
    lines.push(...buildDeleteStatements(deviceId, start, end));
    allDates.push(...splitRangeByDays(start, end).map((p) => p.dateStr));
  });
  lines.push(...buildRecalcStatements(deviceId, allDates));
  return lines.join('\n');
}

/** Открыть SQL в модалке (элементы #sqlModal/#sqlOutput создаются components.js). */
export function openSqlModal(sql) {
  const modal = document.getElementById('sqlModal');
  const out = document.getElementById('sqlOutput');
  if (!modal || !out) {
    console.warn('SQL modal not found');
    return;
  }
  out.textContent = sql;
  modal.classList.add('open');
}

/** Ближайшая точка к latlng средли массива parsed [{lat,lng}]. */
export function findNearestPoint(latlng, points) {
  let best = null;
  let bestDist = Infinity;
  for (const p of points) {
    const d = haversineM(latlng.lat, latlng.lng, p.lat, p.lng);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return { point: best, distance: bestDist };
}

/** Азимут между двумя точками в градусах (0 = север, по часовой). */
export function bearingDeg(lat1, lng1, lat2, lng2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const dLon = toRad(lng2 - lng1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}
