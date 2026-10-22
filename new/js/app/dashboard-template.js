// HTML-шаблон дашборда. Используется index.html и админ-панелью (раздел «Мониторинг»),
// чтобы не дублировать разметку. Параметры: tabs, actions, clipboard.

const TAB_DEFS = {
  stops: { title: 'Остановки', icon: 'fa-square-parking', badge: null },
  anomalies: { title: 'Аномалии', icon: 'fa-triangle-exclamation', badge: 'anomaliesBadge' },
  devlog: { title: 'Device Log', icon: 'fa-file-lines', badge: null },
  analysis: { title: 'Анализ', icon: 'fa-magnifying-glass-chart', badge: null },
  'fuel-events': { title: 'Заправки и сливы', icon: 'fa-gas-pump', badge: null },
  'fuel-summary': { title: 'Сводка по бакам', icon: 'fa-oil-can', badge: null },
  'fuel-daily': { title: 'Суточная таблица', icon: 'fa-calendar-day', badge: null },
};

const ACTION_BTNS = {
  raw: `<button id="btnLoadRawTrack" class="btn btn-secondary !py-2 text-[11px] flex-1" title="Сырой трек (точки + все аномалии)"><i class="fa-solid fa-circle-dot"></i> Сырой</button>`,
  analyze: `<button id="btnAnalyze" class="btn btn-secondary !py-2 text-[11px] flex-1" title="Анализ маршрута (питание/спутники/напряжение)"><i class="fa-solid fa-magnifying-glass-chart"></i> Анализ</button>`,
  devlog: `<button id="btnDevLog" class="btn btn-secondary !py-2 text-[11px] flex-1" title="Device Log: полный трек + отчёт по интервалам"><i class="fa-solid fa-file-lines"></i> Dev Log</button>`,
};

function tabButtonsHtml(tabs) {
  return tabs.map((id, i) => {
    const t = TAB_DEFS[id];
    const badge = t.badge ? `<span id="${t.badge}" class="hidden ml-1 bg-rose-600 text-white rounded-full px-1.5 text-[10px]"></span>` : '';
    return `<button class="tab-btn ${i === 0 ? 'active bg-brand-600 text-white' : 'text-gray-400'} px-3 py-1.5 rounded-lg font-medium transition" data-tab="${id}">
      <i class="fa-solid ${t.icon} mr-1"></i> ${t.title}${badge}
    </button>`;
  }).join('');
}

function tabPanelsHtml(tabs) {
  return tabs.map((id, i) => {
    switch (id) {
      case 'stops':
        return `<div class="tab-panel ${i === 0 ? '' : 'hidden'}" data-panel="stops">
          <div class="table-scroll" style="max-height:300px">
            <table class="data-table"><thead id="stopsThead"></thead><tbody id="stopsTbody"></tbody></table>
          </div>
        </div>`;
      case 'anomalies':
        return `<div class="tab-panel ${i === 0 ? '' : 'hidden'}" data-panel="anomalies">
          <div class="flex items-center justify-between px-4 py-2 border-b border-gray-800/60">
            <span id="anomaliesSummary" class="text-[11px] text-gray-400"></span>
            <button id="bulkDeleteAnomaliesBtn" class="btn btn-danger btn-xs"><i class="fa-solid fa-trash"></i> Массовое удаление</button>
          </div>
          <div class="table-scroll" style="max-height:300px">
            <table class="data-table"><thead id="anomaliesThead"></thead><tbody id="anomaliesTbody"></tbody></table>
          </div>
        </div>`;
      case 'devlog':
        return `<div class="tab-panel ${i === 0 ? '' : 'hidden'}" data-panel="devlog">
          <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-800/60 text-[11px] text-gray-300">
            <label>Мин. сек <input id="devlogMinDuration" type="number" min="0" value="60" class="w-16 bg-darkbg-900 border border-gray-700 rounded px-1.5 py-0.5" /></label>
            <label>Sat &lt; <input id="devlogSatThreshold" type="number" min="1" value="10" class="w-14 bg-darkbg-900 border border-gray-700 rounded px-1.5 py-0.5" /></label>
            <label>Merge gap ≤ <input id="devlogMergeGap" type="number" min="0" value="30" class="w-14 bg-darkbg-900 border border-gray-700 rounded px-1.5 py-0.5" /></label>
            <button id="devlogApplyFilterBtn" class="btn btn-secondary btn-xs">Применить</button>
            <button id="devlogClearFocusBtn" class="btn btn-secondary btn-xs">Сброс выделения</button>
            <button id="devlogGenerateSqlBtn" class="btn btn-danger btn-xs hidden"><i class="fa-solid fa-trash"></i> SQL удаления аномалий</button>
            <span id="devlogCount" class="text-gray-400 ml-auto">0 записей</span>
          </div>
          <div class="table-scroll border-b border-gray-800/60" style="max-height:150px">
            <table class="data-table"><thead id="devlogReportThead"></thead><tbody id="devlogReportTbody"></tbody></table>
          </div>
          <div class="table-scroll" style="max-height:600px">
            <table class="data-table"><thead id="deviceLogThead"></thead><tbody id="deviceLogTbody"></tbody></table>
          </div>
        </div>`;
      case 'analysis':
        return `<div class="tab-panel ${i === 0 ? '' : 'hidden'}" data-panel="analysis">
          <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-800/60 text-[11px]">
            <span id="analysisSummary" class="text-gray-400"></span>
            <span class="flex items-center space-x-1 ml-auto">
              <button id="analysisViewChrono" class="btn btn-secondary btn-xs">Хронология</button>
              <button id="analysisViewSummary" class="btn btn-secondary btn-xs">Сводка</button>
              <button id="analysisHideOk" class="btn btn-secondary btn-xs">Скрыть норму</button>
            </span>
          </div>
          <div class="table-scroll" style="max-height:300px">
            <table class="data-table"><thead id="analysisThead"></thead><tbody id="analysisTbody"></tbody></table>
          </div>
        </div>`;
      case 'fuel-events':
        return `<div class="tab-panel ${i === 0 ? '' : 'hidden'}" data-panel="fuel-events">
          <div class="table-scroll" style="max-height:300px">
            <table class="data-table"><thead id="fuelEventsThead"></thead><tbody id="fuelEventsTbody"></tbody></table>
          </div>
        </div>`;
      case 'fuel-summary':
        return `<div class="tab-panel ${i === 0 ? '' : 'hidden'}" data-panel="fuel-summary">
          <div class="table-scroll" style="max-height:300px">
            <table class="data-table"><thead id="fuelSummaryThead"></thead><tbody id="fuelSummaryTbody"></tbody></table>
          </div>
        </div>`;
      case 'fuel-daily':
        return `<div class="tab-panel ${i === 0 ? '' : 'hidden'}" data-panel="fuel-daily">
          <div class="table-scroll" style="max-height:300px">
            <table class="data-table"><thead id="fuelDailyThead"></thead><tbody id="fuelDailyTbody"></tbody></table>
          </div>
        </div>`;
      default:
        return '';
    }
  }).join('');
}

function actionsHtml(actions) {
  const extra = actions.filter((a) => a !== 'track' && a !== 'telemetry' && a !== 'analyze' && a !== 'fuel');
  let html = `<div class="flex gap-2 flex-nowrap items-stretch">
    <button id="btnLoadTrack" class="flex-1 min-w-0 bg-brand-600 hover:bg-brand-500 text-white font-medium py-2 rounded-lg transition shadow-lg shadow-brand-600/30 flex items-center justify-center space-x-2 text-[13px]">
      <i class="fa-solid fa-play"></i><span class="truncate">Загрузить трек</span>
    </button>
    ${actions.includes('telemetry') ? `<button id="btnLoadTelemetry" class="btn btn-secondary !py-2 text-[11px] px-2.5 shrink-0" title="Телеметрия: сырой трек в плеер и график (точки на карте не рисуются); если пробег не загружен — загрузит и его"><i class="fa-solid fa-gauge-high"></i> Телеметрия</button>` : ''}
    ${actions.includes('analyze') ? `<button id="btnAnalyze" class="btn btn-secondary !py-2 text-[11px] px-2.5 shrink-0" title="Анализ маршрута (питание/спутники/напряжение)"><i class="fa-solid fa-magnifying-glass-chart"></i> Анализ</button>` : ''}
  </div>`;
  if (extra.length) {
    html += `<div class="flex gap-2">${extra.map((a) => ACTION_BTNS[a] || '').join('')}</div>`;
  }
  return html;
}

function clipboardHtml(adminTools) {
  // Шестерёнка — снаружи оборачивающего контейнера кнопок: даже при переносе кнопок
  // на вторую строку настройки остаются на первой строке справа.
  return `<div class="flex items-center">
    <div class="flex items-center gap-2 flex-wrap flex-1 min-w-0">
      <button class="panel-clipboard-icon btn btn-secondary btn-xs" data-key="reb" title="Збій GPS через РЕБ"><i class="fa-solid fa-tower-broadcast"></i> РЕБ</button>
      <button class="panel-clipboard-icon btn btn-secondary btn-xs" data-key="reb2" title="Збій GPS через РЕБ (зависание)"><i class="fa-solid fa-tower-cell"></i> РЕБ2</button>
      <button class="panel-clipboard-icon btn btn-secondary btn-xs" data-key="devoff" title="Несвоєчасне вимкнення"><i class="fa-solid fa-power-off"></i> Вимк</button>
      <button class="panel-clipboard-icon btn btn-secondary btn-xs" data-key="devon" title="Несвоєчасне увімкнення"><i class="fa-solid fa-plug"></i> Увімк</button>
      <button class="panel-clipboard-icon btn btn-secondary btn-xs" data-key="ok" title="Повний трек (шаблон, {{dest}} — пробіг)"><i class="fa-solid fa-circle-check"></i> OK</button>
    </div>
    ${adminTools ? `<button id="anomalySettingsBtn" class="p-1.5 text-gray-400 hover:text-white bg-darkbg-700 hover:bg-gray-700 rounded-lg transition shrink-0" title="Настройки аномалий">
      <i class="fa-solid fa-gear"></i>
    </button>` : ''}
  </div>`;
}

function modalsHtml() {
  return `
  <!-- Модалка SQL -->
  <div id="sqlModal" class="modal-overlay">
    <div class="modal-box" style="width:720px">
      <div class="modal-header"><h2>SQL для удаления аномалий</h2><button class="modal-close" type="button">&times;</button></div>
      <div class="modal-body">
        <div class="flex items-center gap-2 mb-2">
          <button id="copySqlBtn" class="btn btn-xs"><i class="fa-solid fa-copy"></i> Копировать</button>
          <span class="text-[11px] text-gray-500">SQL выполняется вручную на сервере БД</span>
        </div>
        <pre id="sqlOutput" class="sql-output"></pre>
      </div>
    </div>
  </div>

  <!-- Модалка настроек аномалий -->
  <div id="anomalySettingsModal" class="modal-overlay">
    <div class="modal-box" style="width:640px">
      <div class="modal-header"><h2>Настройки аномалий</h2><button class="modal-close" type="button">&times;</button></div>
      <form id="anomalySettingsForm" class="modal-body space-y-3 text-xs">
        <p class="text-gray-400">Изменения применяются к следующим построениям трека.</p>
        <div class="grid grid-cols-2 gap-3">
          <label class="block"><span class="text-gray-400 block mb-1">Порог временного разрыва, мин</span>
            <input id="anomalyGapThresholdMinutes" type="number" min="0" step="0.1" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2 py-1.5" /></label>
          <label class="block"><span class="text-gray-400 block mb-1">Порог скачка скорости, км/ч</span>
            <input id="anomalySpeedThresholdKph" type="number" min="0" step="1" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2 py-1.5" /></label>
          <label class="block"><span class="text-gray-400 block mb-1">Прыжок позиции: расчётная скорость, км/ч</span>
            <input id="anomalyJumpSpeedThresholdKph" type="number" min="0" step="1" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2 py-1.5" /></label>
          <label class="block"><span class="text-gray-400 block mb-1">Прыжок позиции: заявленная скорость, км/ч</span>
            <input id="anomalyRealSpeedThresholdKph" type="number" min="0" step="1" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2 py-1.5" /></label>
          <label class="block"><span class="text-gray-400 block mb-1">Прыжок позиции: расстояние, м</span>
            <input id="anomalyPositionJumpDistanceM" type="number" min="0" step="1" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2 py-1.5" /></label>
          <label class="block"><span class="text-gray-400 block mb-1">Мин. дистанция для таблицы, м</span>
            <input id="anomalyTableMinDistanceM" type="number" min="0" step="1" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2 py-1.5" /></label>
        </div>
        <div class="space-y-2 border-t border-gray-800 pt-3">
          <p class="font-semibold text-gray-300">Тексты для копирования</p>
          <label class="block"><span class="text-gray-400 block mb-1">РЕБ</span><textarea id="anomalyClipboardReb" rows="2" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2 py-1.5"></textarea></label>
          <label class="block"><span class="text-gray-400 block mb-1">РЕБ (зависание)</span><textarea id="anomalyClipboardReb2" rows="2" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2 py-1.5"></textarea></label>
          <label class="block"><span class="text-gray-400 block mb-1">Несвоєчасне вимкнення</span><textarea id="anomalyClipboardDevOff" rows="2" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2 py-1.5"></textarea></label>
          <label class="block"><span class="text-gray-400 block mb-1">Несвоєчасне увімкнення</span><textarea id="anomalyClipboardDevOn" rows="2" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2 py-1.5"></textarea></label>
          <label class="block"><span class="text-gray-400 block mb-1">Повний трек (шаблон, {{dest}} — пробіг)</span><textarea id="anomalyClipboardOkTemplate" rows="3" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2 py-1.5"></textarea></label>
        </div>
      </form>
      <div class="modal-footer">
        <button id="anomalySettingsResetBtn" class="btn btn-secondary" type="button">Сбросить</button>
        <button class="btn btn-secondary modal-close-btn" type="button">Отмена</button>
        <button id="anomalySettingsSaveBtn" class="btn" type="submit" form="anomalySettingsForm">Сохранить</button>
      </div>
    </div>
  </div>

  <!-- Модалка массового удаления аномалий -->
  <div id="bulkDeleteModal" class="modal-overlay">
    <div class="modal-box" style="width:480px">
      <div class="modal-header"><h2>Массовое удаление аномалий</h2><button class="modal-close" type="button">&times;</button></div>
      <form id="bulkDeleteForm" class="modal-body space-y-3 text-xs">
        <label class="flex items-center gap-2">
          <input id="bulkDeleteSpeedCheck" type="checkbox" class="rounded border-gray-700 text-brand-600 bg-darkbg-900" />
          <span>Calculated Speed (km/h) больше чем</span>
          <input id="bulkDeleteSpeedValue" type="number" min="0" value="200" class="w-20 bg-darkbg-900 border border-gray-700 rounded px-2 py-1" />
        </label>
        <label class="flex items-center gap-2">
          <input id="bulkDeleteDistanceCheck" type="checkbox" class="rounded border-gray-700 text-brand-600 bg-darkbg-900" />
          <span>Distance (km) больше чем</span>
          <input id="bulkDeleteDistanceValue" type="number" min="0" step="0.01" value="1" class="w-20 bg-darkbg-900 border border-gray-700 rounded px-2 py-1" />
        </label>
        <p class="text-gray-500">Если выбраны оба критерия, применяется условие ИЛИ.</p>
      </form>
      <div class="modal-footer">
        <button class="btn btn-secondary modal-close-btn" type="button">Отмена</button>
        <button id="bulkDeleteOkBtn" class="btn" type="submit" form="bulkDeleteForm">Сформировать SQL</button>
      </div>
    </div>
  </div>

  <!-- Модалка «Что нового» -->
  <div id="changelogModal" class="modal-overlay">
    <div class="modal-box" style="width:560px">
      <div class="modal-header"><h2>Что нового <span id="changelogVersion" class="text-gray-400"></span></h2><button class="modal-close" type="button">&times;</button></div>
      <div class="modal-body"><div id="changelogEntries" class="space-y-4 text-xs"></div></div>
      <div class="modal-footer"><button id="changelogOkBtn" class="btn" type="button">OK</button></div>
    </div>
  </div>

  <!-- Модалка деталей сегмента анализа -->
  <div id="analysisSegmentModal" class="modal-overlay">
    <div class="modal-box" style="width:560px">
      <div class="modal-header"><h2>Детали сегмента</h2><button class="modal-close" type="button">&times;</button></div>
      <div class="modal-body text-xs"><div id="analysisSegmentBody"></div></div>
    </div>
  </div>`;
}

/**
 * @param {object} opts
 *  tabs: string[] — какие вкладки таблиц показывать
 *  actions: string[] — какие кнопки действий показывать ('track' | 'raw' | 'analyze' | 'devlog')
 *  clipboard: boolean — кнопки копирования текста
 *  telemetry: boolean | 'ondemand' — проигрыватель и график скорости.
 *             'ondemand' рендерит их скрытыми (показывает bootstrap по событию 'telemetry')
 *  adminTools: boolean — настройки аномалий и «Очистить память» (default false)
 */
export function dashboardTemplate(opts = {}) {
  const tabs = opts.tabs || ['stops', 'anomalies'];
  const actions = opts.actions || ['track'];
  const clipboard = !!opts.clipboard;
  const telemetryMode = opts.telemetry === 'ondemand' ? 'ondemand' : (opts.telemetry !== false ? 'on' : 'off');
  const telemetryHidden = telemetryMode === 'ondemand';
  const adminTools = !!opts.adminTools;

  return `
  <!-- Центральная область -->
  <main id="mainArea" class="flex-1 flex flex-col h-full overflow-y-auto relative min-w-0">

    <!-- KPI -->
    <div class="grid grid-cols-2 lg:grid-cols-7 gap-3 p-4 shrink-0">
      <div class="glass-panel p-3 rounded-xl flex items-center space-x-3">
        <div class="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-lg"><i class="fa-solid fa-clock text-lg"></i></div>
        <div class="min-w-0">
          <p class="text-[11px] text-gray-400">В пути / Простой</p>
          <h3 id="statTime" class="text-base font-bold text-white kpi-value truncate">—</h3>
        </div>
      </div>
      <div class="glass-panel p-3 rounded-xl flex items-center space-x-3">
        <div class="p-2.5 bg-amber-500/10 text-amber-400 rounded-lg"><i class="fa-solid fa-gauge-simple-high text-lg"></i></div>
        <div class="min-w-0">
          <p class="text-[11px] text-gray-400">Ср. / Макс. скорость</p>
          <h3 id="statSpeed" class="text-base font-bold text-white kpi-value truncate">—</h3>
        </div>
      </div>
      <div class="glass-panel p-3 rounded-xl flex items-center space-x-3">
        <div class="p-2.5 bg-purple-500/10 text-purple-400 rounded-lg"><i class="fa-solid fa-triangle-exclamation text-lg"></i></div>
        <div class="min-w-0">
          <p class="text-[11px] text-gray-400">События на треке</p>
          <h3 id="statEvents" class="text-base font-bold text-white kpi-value truncate">—</h3>
        </div>
      </div>
      <div id="kpiFuelCons" class="glass-panel p-3 rounded-xl flex items-center space-x-3" title="Расход топлива за период (по данным отчёта топлива)">
        <div class="p-2.5 bg-amber-500/10 text-amber-400 rounded-lg"><i class="fa-solid fa-gas-pump text-lg"></i></div>
        <div class="min-w-0">
          <p class="text-[11px] text-gray-400">Расход топлива</p>
          <h3 id="statFuelConsumption" class="text-base font-bold text-white kpi-value truncate">—</h3>
        </div>
      </div>
      <div id="kpiFuelMoto" class="glass-panel p-3 rounded-xl flex items-center space-x-3" title="Моточасы за период (по данным отчёта топлива)">
        <div class="p-2.5 bg-cyan-500/10 text-cyan-400 rounded-lg"><i class="fa-solid fa-clock text-lg"></i></div>
        <div class="min-w-0">
          <p class="text-[11px] text-gray-400">Моточасы</p>
          <h3 id="statFuelMotoHours" class="text-base font-bold text-white kpi-value truncate">—</h3>
        </div>
      </div>
      <div class="glass-panel p-3 rounded-xl col-span-2 lg:col-span-1 flex items-center space-x-3">
        <div class="p-2.5 bg-brand-500/10 text-brand-400 rounded-lg"><i class="fa-solid fa-truck-front text-lg"></i></div>
        <div class="min-w-0">
          <p class="text-[11px] text-gray-400">Транспортное средство</p>
          <h3 id="statVehicle" class="text-base font-bold text-white truncate">—</h3>
        </div>
      </div>
      <div class="glass-panel p-3 rounded-xl flex items-center space-x-3">
        <div class="p-2.5 bg-blue-500/10 text-blue-400 rounded-lg"><i class="fa-solid fa-road text-lg"></i></div>
        <div class="min-w-0">
          <p class="text-[11px] text-gray-400">Общий пробег</p>
          <h3 id="statDistance" class="text-base font-bold text-white kpi-value truncate">—</h3>
        </div>
      </div>
    </div>

    <!-- Карта + проигрыватель -->
    <div id="mapBlock" class="relative mx-4 rounded-xl overflow-hidden border border-gray-800 shadow-2xl flex flex-col shrink-0" style="height:480px">
      <div id="map" class="w-full flex-1 z-0 bg-darkbg-800"></div>
      <div id="manualRouteInfo" class="manual-route-info"></div>

      <!-- Плавающая группа полноэкранного режима: бейдж «Общий пробег» + кнопка выхода -->
      <div id="mapFullscreenBar" class="hidden absolute top-3 left-1/2 -translate-x-1/2 z-[1000] items-center space-x-2">
        <div id="mapDistanceBadge" class="glass-panel px-3 py-1.5 rounded-full flex items-center space-x-2 text-xs shadow-2xl">
          <i class="fa-solid fa-road text-blue-400"></i>
          <span class="text-[11px] text-gray-400">Общий пробег</span>
          <span id="mapDistanceBadgeValue" class="font-bold text-white kpi-value">—</span>
        </div>
        <button id="mapFullscreenExitBtn" type="button" class="btn !rounded-full !py-1.5 text-xs shadow-2xl" title="Свернуть карту (Esc)">
          <i class="fa-solid fa-compress"></i> Свернуть
        </button>
      </div>

      <!-- Кнопка разворачивания карты на весь экран (правый нижний угол) -->
      <button id="mapFullscreenEnterBtn" type="button" class="map-icon-btn absolute bottom-3 right-3 z-[1000]" title="Карта на весь экран">
        <i class="fa-solid fa-expand"></i>
      </button>

      <!-- Проигрыватель -->
      ${telemetryMode !== 'off' ? `
      <div id="playbackBar"${telemetryHidden ? ' style="display:none"' : ''} class="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] w-[92%] max-w-2xl glass-panel p-3 rounded-xl shadow-2xl border border-gray-700/60 flex flex-col space-y-2">
        <div class="flex items-center justify-between text-xs text-gray-300">
          <div class="flex items-center space-x-2 min-w-0">
            <span id="playerDot" class="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
            <span id="playerCurrentTime" class="font-mono font-medium text-white">--:--:--</span>
            <span id="playerCurrentSpeed" class="text-gray-400 text-[11px] ml-1 truncate">Скорость: —</span>
          </div>
          <div class="flex items-center space-x-1 bg-darkbg-900/80 px-2 py-0.5 rounded text-[11px] shrink-0">
            <span class="text-gray-400">Ускорение:</span>
            <button class="btn-speed px-1.5 py-0.5 rounded text-brand-400 font-bold" data-speed="1">1x</button>
            <button class="btn-speed px-1.5 py-0.5 rounded text-gray-300 hover:text-white" data-speed="2">2x</button>
            <button class="btn-speed px-1.5 py-0.5 rounded text-gray-300 hover:text-white" data-speed="5">5x</button>
            <button class="btn-speed px-1.5 py-0.5 rounded text-gray-300 hover:text-white" data-speed="10">10x</button>
          </div>
        </div>
        <div class="flex items-center space-x-3">
          <button id="btnPlayPause" class="w-9 h-9 rounded-lg bg-brand-600 hover:bg-brand-500 text-white flex items-center justify-center transition shadow-md" title="Воспроизвести">
            <i class="fa-solid fa-play"></i>
          </button>
          <button id="btnResetTrack" class="w-8 h-8 rounded-lg bg-darkbg-700 hover:bg-gray-700 text-gray-300 flex items-center justify-center transition" title="Сбросить на начало">
            <i class="fa-solid fa-rotate-left text-xs"></i>
          </button>
          <div class="flex-1 relative flex flex-col">
            <input type="range" id="trackProgress" min="0" max="100" value="0" step="0.1"
              class="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-500 focus:outline-none" />
            <div id="playerTimeMarks" class="relative h-3 mt-0.5 text-[9px] leading-none text-gray-500 font-mono select-none"></div>
          </div>
          <span id="playerTotalTime" class="text-xs font-mono text-gray-400">--:--:--</span>
        </div>
      </div>` : ''}
    </div>

    <!-- Ручка ресайза карты -->
    <div id="mapResizeHandle" title="Потяните, чтобы изменить высоту карты"
      class="mx-4 my-1 h-3 shrink-0 flex items-center justify-center cursor-row-resize group">
      <div class="w-16 h-1 rounded-full bg-gray-700 group-hover:bg-brand-500 transition"></div>
    </div>

    <!-- График скорости -->
    ${telemetryMode !== 'off' ? `
    <div id="telemetryWrap"${telemetryHidden ? ' style="display:none"' : ''} class="p-4 pt-1 shrink-0">
      <div class="glass-panel p-4 rounded-xl border border-gray-800">
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-xs font-semibold uppercase tracking-wider text-gray-300 flex items-center">
            <i class="fa-solid fa-chart-line text-brand-500 mr-2"></i>
            Телеметрия: скорость (км/ч) по времени
          </h4>
          <span class="flex items-center space-x-2">
            <span class="text-[11px] text-gray-400 hidden sm:block">Наведите на график, чтобы синхронизировать с картой</span>
            <button id="telemetryToggleBtn" class="p-1 text-gray-400 hover:text-white transition" title="Свернуть/развернуть панель телеметрии (скрывает проигрыватель)">
              <i id="telemetryToggleIcon" class="fa-solid fa-chevron-down"></i>
            </button>
          </span>
        </div>
        <div id="telemetryChartBody">
          <div class="h-36 w-full"><canvas id="speedChart"></canvas></div>
        </div>
      </div>
    </div>` : ''}

    <!-- Таблицы событий -->
    <div class="p-4 pt-0 shrink-0">
      <div class="glass-panel rounded-xl border border-gray-800 overflow-hidden">
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-gray-800 bg-darkbg-800/50 px-4 py-2.5 gap-2">
          <div id="tabButtons" class="flex flex-wrap space-x-2 text-xs">
            ${tabButtonsHtml(tabs)}
          </div>
          <div class="flex items-center space-x-1 text-xs shrink-0">
            <span class="text-gray-400 mr-1 text-[11px]">Экспорт:</span>
            <button id="exportExcelBtn" class="px-2.5 py-1 bg-darkbg-700 hover:bg-gray-700 text-emerald-400 rounded transition flex items-center space-x-1">
              <i class="fa-solid fa-file-excel"></i> <span>Excel</span>
            </button>
          </div>
        </div>
        ${tabPanelsHtml(tabs)}
      </div>
    </div>
  </main>

  <!-- Правая панель -->
  <aside id="sidebar"
    class="w-80 md:w-96 bg-darkbg-800 border-l border-gray-800 flex flex-col z-30 shrink-0 transition-transform duration-300 absolute md:relative inset-y-0 right-0 translate-x-full md:translate-x-0">

    <!-- ТС: заголовок и фильтры (не скроллятся) -->
    <div class="p-4 pb-2 space-y-2 shrink-0">
      <label class="block text-xs font-semibold uppercase tracking-wider text-gray-400">
        <i class="fa-solid fa-truck-front mr-1 text-brand-500"></i> Выбор ТС
      </label>
      <div class="relative">
        <i class="fa-solid fa-search absolute left-3 top-2.5 text-gray-500 text-sm"></i>
        <input type="text" id="vehicleSearch" placeholder="Поиск по номеру, имени..."
          class="w-full bg-darkbg-900 text-xs border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-gray-200 focus:outline-none focus:border-brand-500 transition" />
      </div>
      <div class="flex space-x-1 text-[11px]">
        <button class="filter-status-btn active px-2.5 py-1 rounded-md bg-brand-600 text-white" data-status="all">Все</button>
        <button class="filter-status-btn px-2.5 py-1 rounded-md bg-darkbg-700 text-gray-400 hover:text-gray-200" data-status="online">Онлайн</button>
        <button class="filter-status-btn px-2.5 py-1 rounded-md bg-darkbg-700 text-gray-400 hover:text-gray-200" data-status="offline">Офлайн</button>
        <button id="vehicleAutoModeBtn" class="ml-auto px-2.5 py-1 rounded-md bg-darkbg-700 text-gray-400 hover:text-gray-200" title="Авто-режим: единственное совпадение в поиске сразу выбирает ТС и строит трек">Авто</button>
      </div>
      <select id="fleetFilter" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-brand-500">
        <option value="all">Все филиалы</option>
      </select>
    </div>

    <!-- Карточки ТС: занимают всё свободное пространство -->
    <div id="vehicleList" class="flex-1 overflow-y-auto px-4 pb-2 space-y-2 min-h-[80px]"></div>

    <!-- Нижняя панель (прижата к нижнему краю): период, действия, буферы -->
    <div class="shrink-0 border-t border-gray-800 p-4 pt-3 space-y-4 overflow-y-auto" style="max-height:52%">

      <!-- Период -->
      <div>
        <label class="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
          <i class="fa-solid fa-calendar-days mr-1 text-brand-500"></i> Период анализа
        </label>
        <div class="grid grid-cols-3 gap-1.5 mb-2.5">
          <button class="preset-date-btn bg-darkbg-700 hover:bg-gray-700 text-gray-300 text-xs py-1.5 rounded-md transition text-center" data-preset="today">Сегодня</button>
          <button class="preset-date-btn bg-darkbg-700 hover:bg-gray-700 text-gray-300 text-xs py-1.5 rounded-md transition text-center" data-preset="yesterday">Вчера</button>
          <button class="preset-date-btn bg-darkbg-700 hover:bg-gray-700 text-gray-300 text-xs py-1.5 rounded-md transition text-center" data-preset="week">За неделю</button>
        </div>
        <div class="space-y-2 text-xs">
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-gray-400 text-[11px]">Начало:</span>
              <span class="flex items-center space-x-1">
                <button id="copyDateFromToBtn" class="btn btn-secondary btn-xs" title="Скопировать дату из «Начало» в «Окончание» (23:59)">⇐</button>
                <button id="dateLockBtn" class="btn btn-secondary btn-xs" title="Связать даты (один день 00:00–23:59)" aria-pressed="false">🔓</button>
              </span>
            </div>
            <input type="datetime-local" id="startDate" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-gray-200 focus:outline-none focus:border-brand-500" />
          </div>
          <div>
            <span class="text-gray-400 block mb-1 text-[11px]">Окончание:</span>
            <input type="datetime-local" id="endDate" class="w-full bg-darkbg-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-gray-200 focus:outline-none focus:border-brand-500" />
          </div>
        </div>
      </div>

      <!-- Действия -->
      <div class="space-y-2">
        ${actionsHtml(actions)}
      </div>

      <!-- Буферы (+ настройки аномалий в админке) -->
      ${clipboard ? clipboardHtml(adminTools) : (adminTools ? `<div class="flex items-center">
        <button id="anomalySettingsBtn" class="ml-auto p-1.5 text-gray-400 hover:text-white bg-darkbg-700 hover:bg-gray-700 rounded-lg transition" title="Настройки аномалий">
          <i class="fa-solid fa-gear"></i>
        </button>
      </div>` : '')}
    </div>

    <!-- Подвал: версия (+ очистка памяти в админке) -->
    <div class="shrink-0 border-t border-gray-800 px-4 py-2 flex items-center justify-between text-[11px]">
      <a href="#" id="versionLink" class="version-link text-gray-500 hover:text-gray-300"></a>
      ${adminTools ? `<button id="memoryCleanupBtn" class="text-gray-500 hover:text-gray-300"><i class="fa-solid fa-broom mr-1"></i>Очистить память</button>` : ''}
    </div>
  </aside>

  <!-- Мобильная кнопка сайдбара -->
  <button id="sidebarToggleBtn" class="md:hidden absolute bottom-4 right-4 z-40 bg-brand-600 text-white p-3 rounded-full shadow-lg">
    <i class="fa-solid fa-sliders"></i>
  </button>

  ${modalsHtml()}`;
}
