// Конфигурация v2.1: константы, настройки аномалий, лимиты памяти

// URL читается в момент подключения (позволяет задать override до загрузки страницы)
export function getWsUrl() {
  try {
    return localStorage.getItem('scmv_ws_url') || 'wss://scmv.vpngps.com:4445';
  } catch (e) {
    return 'wss://scmv.vpngps.com:4445';
  }
}

// Географические границы допустимых координат (Украина) — «Вне границ»
export const BOUNDS = { MIN_LAT: 44.3, MAX_LAT: 52.4, MIN_LON: 22.1, MAX_LON: 40.2 };

// Лимиты управления памятью
export const MEMORY_LIMITS = {
  trackPoints: 15000,
  fullTrackCache: 15000,
  tableRows: 5000,
  markers: 2000,
  deviceHistory: 2,
};

// Серверный кап строк в одном ответе (чанкинг догрузкой более ранних интервалов)
export const ROW_CHUNK_LIMIT = 14000;

// Радиус вхождения локации в маршрут (метры): маршрут считается проходящим через
// локацию, если проходит в пределах этого радиуса от её точки
export const LOCATION_RADIUS_M = 500;

export const ANOMALY_SETTINGS_KEY = 'anomalySettings';

export const ANOMALY_DEFAULTS = {
  gapThresholdMs: 10 * 60 * 1000,        // Time Gap, мин*60*1000 (храним в мин)
  speedThresholdKph: 200,                // Speed Spike (расчётная скорость)
  jumpSpeedThresholdKph: 50,             // Position Jump: расчётная >
  realSpeedThresholdKph: 10,             // Position Jump: приборная <
  positionJumpDistanceM: 1200,           // Position Jump по расстоянию
  tableMinDistanceM: 0,                  // мин. дистанция для таблицы аномалий
  clipboardReb: 'Збій у роботі GPS пристрою через застосування РЕБ. Частково відсутні координати у БД',
  clipboardReb2: 'Збій у роботі GPS пристрою через застосування РЕБ. Відбулось зависання модулю GPS у пристрої. Частково відсутні координати у БД',
  clipboardDevOff: 'Несвоєчасне вимкнення трекеру. Частково відсутні координати у БД',
  clipboardDevOn: 'Несвоєчасне увімкнення трекеру. Частково відсутні координати у БД',
  clipboardOkTemplate: 'У базі збережено повний трек без часових розривів, втрати сигналу або інших аномальних проявів.\nПробіг по GPS: {{dest}} км',
};

// Действующие настройки (мутируемый синглтон)
let current = { ...ANOMALY_DEFAULTS };

function asNumber(value, fallback) {
  const n = Number(value);
  return isFinite(n) && n >= 0 ? n : fallback;
}
function asString(value, fallback) {
  return typeof value === 'string' && value.length ? value : fallback;
}

export function getAnomalySettings() {
  return { ...current };
}

export function applyAnomalySettings(settings) {
  if (!settings || typeof settings !== 'object') return getAnomalySettings();
  current = {
    gapThresholdMs: asNumber(settings.gapThresholdMs, current.gapThresholdMs),
    speedThresholdKph: asNumber(settings.speedThresholdKph, current.speedThresholdKph),
    jumpSpeedThresholdKph: asNumber(settings.jumpSpeedThresholdKph, current.jumpSpeedThresholdKph),
    realSpeedThresholdKph: asNumber(settings.realSpeedThresholdKph, current.realSpeedThresholdKph),
    positionJumpDistanceM: asNumber(settings.positionJumpDistanceM, current.positionJumpDistanceM),
    tableMinDistanceM: asNumber(settings.tableMinDistanceM, current.tableMinDistanceM),
    clipboardReb: asString(settings.clipboardReb, current.clipboardReb),
    clipboardReb2: asString(settings.clipboardReb2, current.clipboardReb2),
    clipboardDevOff: asString(settings.clipboardDevOff, current.clipboardDevOff),
    clipboardDevOn: asString(settings.clipboardDevOn, current.clipboardDevOn),
    clipboardOkTemplate: asString(settings.clipboardOkTemplate, current.clipboardOkTemplate),
  };
  return getAnomalySettings();
}

export function loadAnomalySettings() {
  try {
    const raw = localStorage.getItem(ANOMALY_SETTINGS_KEY);
    if (raw) applyAnomalySettings(JSON.parse(raw));
  } catch (e) {
    console.warn('Не удалось загрузить настройки аномалий', e);
  }
  return getAnomalySettings();
}

export function saveAnomalySettings(settings) {
  const applied = applyAnomalySettings(settings);
  try {
    localStorage.setItem(ANOMALY_SETTINGS_KEY, JSON.stringify(applied));
  } catch (e) {
    console.warn('Не удалось сохранить настройки аномалий', e);
  }
  return applied;
}

export function resetAnomalySettings() {
  try {
    localStorage.removeItem(ANOMALY_SETTINGS_KEY);
  } catch (e) { /* ignore */ }
  current = { ...ANOMALY_DEFAULTS };
  return getAnomalySettings();
}

loadAnomalySettings();

export function isOutOfBounds(lat, lon) {
  return (
    lat < BOUNDS.MIN_LAT || lat > BOUNDS.MAX_LAT ||
    lon < BOUNDS.MIN_LON || lon > BOUNDS.MAX_LON
  );
}
