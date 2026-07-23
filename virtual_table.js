// virtual_table.js - lightweight windowed table renderer for large row sets
// Keeps only visible rows (+ overscan) in the DOM to avoid multi-thousand <tr> costs.

(function () {
  'use strict';

  var DEFAULT_ROW_HEIGHT = 28;
  var DEFAULT_OVERSCAN = 10;
  var VIRTUALIZE_THRESHOLD = 80;

  function ensureScrollParent(tbody) {
    if (!tbody) return null;
    var el = tbody.parentElement;
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('table-scroll')) return el;
      try {
        var style = window.getComputedStyle(el);
        if (style && (style.overflowY === 'auto' || style.overflowY === 'scroll')) return el;
      } catch (_) {}
      el = el.parentElement;
    }
    return tbody.parentElement;
  }

  function measureRowHeight(tbody, sampleTr) {
    if (!sampleTr || !tbody) return DEFAULT_ROW_HEIGHT;
    try {
      var h = sampleTr.getBoundingClientRect().height;
      if (h && h > 8) return Math.round(h);
    } catch (_) {}
    return DEFAULT_ROW_HEIGHT;
  }

  /**
   * Create a virtualized table controller.
   * @param {Object} opts
   * @param {HTMLElement} opts.tbody
   * @param {HTMLElement} [opts.thead]
   * @param {HTMLElement} [opts.scrollEl]
   * @param {string[]} opts.headers
   * @param {number} [opts.rowHeight]
   * @param {number} [opts.overscan]
   * @param {function(row, colKey, rowIndex): (string|Node|null)} opts.renderCell
   * @param {function(row, rowIndex, tr): void} [opts.onRowClick]
   * @param {function(row, rowIndex): string} [opts.getRowClass]
   * @param {function(row, rowIndex, tr): void} [opts.decorateRow]
   */
  function createVirtualTable(opts) {
    if (!opts || !opts.tbody) return null;

    var state = {
      tbody: opts.tbody,
      thead: opts.thead || null,
      scrollEl: opts.scrollEl || ensureScrollParent(opts.tbody),
      headers: opts.headers || [],
      rows: [],
      rowHeight: opts.rowHeight || DEFAULT_ROW_HEIGHT,
      overscan: opts.overscan != null ? opts.overscan : DEFAULT_OVERSCAN,
      renderCell: typeof opts.renderCell === 'function' ? opts.renderCell : function (row, key) {
        var v = row ? row[key] : '';
        return v == null ? '' : String(v);
      },
      onRowClick: typeof opts.onRowClick === 'function' ? opts.onRowClick : null,
      getRowClass: typeof opts.getRowClass === 'function' ? opts.getRowClass : null,
      decorateRow: typeof opts.decorateRow === 'function' ? opts.decorateRow : null,
      start: 0,
      end: 0,
      measured: false,
      destroyed: false,
      emptyMessage: opts.emptyMessage || 'Нет данных',
      _raf: null,
      _onScroll: null
    };

    function colCount() {
      return Math.max(1, state.headers.length);
    }

    function makeSpacer(height, cls) {
      var tr = document.createElement('tr');
      tr.className = cls || 'vt-spacer';
      tr.setAttribute('aria-hidden', 'true');
      var td = document.createElement('td');
      td.colSpan = colCount();
      td.style.cssText = 'padding:0;border:0;height:' + Math.max(0, height) + 'px;line-height:0;font-size:0;';
      tr.appendChild(td);
      return tr;
    }

    function renderVisible() {
      if (state.destroyed || !state.tbody) return;
      var rows = state.rows;
      var n = rows.length;
      state.tbody.innerHTML = '';

      if (!n) {
        var empty = document.createElement('tr');
        var td = document.createElement('td');
        td.colSpan = colCount();
        td.textContent = state.emptyMessage;
        empty.appendChild(td);
        state.tbody.appendChild(empty);
        state.start = 0;
        state.end = 0;
        return;
      }

      var scrollEl = state.scrollEl;
      var scrollTop = scrollEl ? scrollEl.scrollTop : 0;
      var viewH = scrollEl ? scrollEl.clientHeight : 400;
      var rh = state.rowHeight || DEFAULT_ROW_HEIGHT;
      var start = Math.floor(scrollTop / rh) - state.overscan;
      if (start < 0) start = 0;
      var visibleCount = Math.ceil(viewH / rh) + state.overscan * 2;
      var end = start + visibleCount;
      if (end > n) end = n;
      if (start > end) start = end;

      state.start = start;
      state.end = end;

      var frag = document.createDocumentFragment();
      var topH = start * rh;
      var bottomH = (n - end) * rh;
      if (topH > 0) frag.appendChild(makeSpacer(topH, 'vt-spacer vt-spacer-top'));

      for (var i = start; i < end; i++) {
        var row = rows[i];
        var tr = document.createElement('tr');
        tr.dataset.vtIndex = String(i);
        if (state.getRowClass) {
          try {
            var cls = state.getRowClass(row, i);
            if (cls) tr.className = cls;
          } catch (_) {}
        }
        for (var c = 0; c < state.headers.length; c++) {
          var key = state.headers[c];
          var cell = document.createElement('td');
          var content = null;
          try {
            content = state.renderCell(row, key, i);
          } catch (e) {
            content = row && row[key] != null ? String(row[key]) : '';
          }
          if (content == null) {
            cell.textContent = '';
          } else if (typeof content === 'string') {
            // allow simple HTML only if caller intentionally returns markup with tags
            if (content.indexOf('<') !== -1) cell.innerHTML = content;
            else cell.textContent = content;
          } else if (content.nodeType) {
            cell.appendChild(content);
          } else {
            cell.textContent = String(content);
          }
          tr.appendChild(cell);
        }
        if (state.decorateRow) {
          try { state.decorateRow(row, i, tr); } catch (_) {}
        }
        if (state.onRowClick) {
          (function (r, idx) {
            tr.addEventListener('click', function (ev) {
              try { state.onRowClick(r, idx, tr, ev); } catch (e) { console.warn('virtual row click', e); }
            });
          })(row, i);
        }
        frag.appendChild(tr);
      }

      if (bottomH > 0) frag.appendChild(makeSpacer(bottomH, 'vt-spacer vt-spacer-bottom'));
      state.tbody.appendChild(frag);

      // one-time measure from first real row
      if (!state.measured && end > start) {
        var first = state.tbody.querySelector('tr[data-vt-index]');
        if (first) {
          var mh = measureRowHeight(state.tbody, first);
          if (mh && Math.abs(mh - state.rowHeight) > 1) {
            state.rowHeight = mh;
            state.measured = true;
            // re-render with corrected height to keep scrollbar accurate
            scheduleRender();
            return;
          }
          state.measured = true;
        }
      }
    }

    function scheduleRender() {
      if (state.destroyed) return;
      if (state._raf) return;
      state._raf = requestAnimationFrame(function () {
        state._raf = null;
        renderVisible();
      });
    }

    function bindScroll() {
      if (!state.scrollEl || state._onScroll) return;
      state._onScroll = function () { scheduleRender(); };
      state.scrollEl.addEventListener('scroll', state._onScroll, { passive: true });
    }

    function unbindScroll() {
      if (state.scrollEl && state._onScroll) {
        try { state.scrollEl.removeEventListener('scroll', state._onScroll); } catch (_) {}
      }
      state._onScroll = null;
      if (state._raf) {
        try { cancelAnimationFrame(state._raf); } catch (_) {}
        state._raf = null;
      }
    }

    var api = {
      setRows: function (rows, headers) {
        state.rows = Array.isArray(rows) ? rows : [];
        if (headers && headers.length) state.headers = headers.slice();
        state.measured = false;
        if (state.scrollEl) state.scrollEl.scrollTop = 0;
        bindScroll();
        renderVisible();
      },
      setHeaders: function (headers) {
        state.headers = headers || [];
        scheduleRender();
      },
      refresh: function () {
        scheduleRender();
      },
      scrollToIndex: function (index, align) {
        if (!state.scrollEl || !state.rows.length) return;
        var n = state.rows.length;
        var idx = Math.max(0, Math.min(n - 1, index | 0));
        var rh = state.rowHeight || DEFAULT_ROW_HEIGHT;
        var target = idx * rh;
        if (align === 'center') {
          target = Math.max(0, target - Math.floor(state.scrollEl.clientHeight / 2) + Math.floor(rh / 2));
        }
        state.scrollEl.scrollTop = target;
        renderVisible();
      },
      getRow: function (index) {
        return state.rows[index];
      },
      getRows: function () {
        return state.rows;
      },
      getVisibleRange: function () {
        return { start: state.start, end: state.end };
      },
      getRowHeight: function () {
        return state.rowHeight;
      },
      destroy: function () {
        state.destroyed = true;
        unbindScroll();
        if (state.tbody) state.tbody.innerHTML = '';
        state.rows = [];
      }
    };

    // store on tbody for cleanup / lookup
    try {
      if (state.tbody.__virtualTable && state.tbody.__virtualTable.destroy) {
        state.tbody.__virtualTable.destroy();
      }
      state.tbody.__virtualTable = api;
    } catch (_) {}

    bindScroll();
    return api;
  }

  /**
   * Fallback non-virtual fill for small tables (keeps simple DOM when cheap).
   * Returns either a virtual API or a lightweight shim with the same methods.
   */
  function mountTableBody(opts) {
    var rows = opts.rows || [];
    var useVirtual = rows.length >= VIRTUALIZE_THRESHOLD;
    if (useVirtual) {
      var vt = createVirtualTable(opts);
      if (vt) {
        vt.setRows(rows, opts.headers);
        return vt;
      }
    }

    // Non-virtual path
    var tbody = opts.tbody;
    var headers = opts.headers || [];
    if (!tbody) return null;
    tbody.innerHTML = '';
    if (!rows.length) {
      var empty = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = Math.max(1, headers.length);
      td.textContent = opts.emptyMessage || 'Нет данных';
      empty.appendChild(td);
      tbody.appendChild(empty);
    } else {
      var frag = document.createDocumentFragment();
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var tr = document.createElement('tr');
        tr.dataset.vtIndex = String(i);
        if (opts.getRowClass) {
          try {
            var cls = opts.getRowClass(row, i);
            if (cls) tr.className = cls;
          } catch (_) {}
        }
        for (var c = 0; c < headers.length; c++) {
          var key = headers[c];
          var cell = document.createElement('td');
          var content = null;
          try {
            content = opts.renderCell ? opts.renderCell(row, key, i) : (row[key] != null ? String(row[key]) : '');
          } catch (_) {
            content = row[key] != null ? String(row[key]) : '';
          }
          if (content == null) cell.textContent = '';
          else if (typeof content === 'string') {
            if (content.indexOf('<') !== -1) cell.innerHTML = content;
            else cell.textContent = content;
          } else if (content.nodeType) cell.appendChild(content);
          else cell.textContent = String(content);
          tr.appendChild(cell);
        }
        if (opts.decorateRow) {
          try { opts.decorateRow(row, i, tr); } catch (_) {}
        }
        if (opts.onRowClick) {
          (function (r, idx) {
            tr.addEventListener('click', function (ev) {
              try { opts.onRowClick(r, idx, tr, ev); } catch (e) {}
            });
          })(row, i);
        }
        frag.appendChild(tr);
      }
      tbody.appendChild(frag);
    }

    try {
      if (tbody.__virtualTable && tbody.__virtualTable.destroy) tbody.__virtualTable.destroy();
    } catch (_) {}

    var shim = {
      setRows: function () {},
      refresh: function () {},
      scrollToIndex: function (index, align) {
        var tr = tbody.querySelector('tr[data-vt-index="' + index + '"]');
        if (tr) {
          try {
            tr.scrollIntoView({ behavior: 'smooth', block: align === 'center' ? 'center' : 'nearest' });
          } catch (_) {
            try { tr.scrollIntoView(true); } catch (_2) {}
          }
        }
      },
      getRow: function (i) { return rows[i]; },
      getRows: function () { return rows; },
      getVisibleRange: function () { return { start: 0, end: rows.length }; },
      destroy: function () { tbody.innerHTML = ''; }
    };
    tbody.__virtualTable = shim;
    return shim;
  }

  window.createVirtualTable = createVirtualTable;
  window.mountTableBody = mountTableBody;
  window.VIRTUAL_TABLE_THRESHOLD = VIRTUALIZE_THRESHOLD;
  console.log('[VirtualTable] module loaded');
})();
