// Центральное состояние дашборда + pub/sub. Импортируется всеми модулями app/*.

export const state = {
  // ТС
  vehicles: [],            // список ТС: Vehicle Select Min (дашборд) или Vehicle Show — все устройства (админка)
  vehicleDetails: [],      // Vehicle Show (для мержа model/imei)
  selectedVehicle: null,   // {id, number, fleet, model, ...}
  deviceId: '',
  // Период
  dateFrom: '',
  dateTo: '',
  // Данные
  trackPoints: [],         // отсортированные точки Vehicle Track [{lat,lng,wdate,ts,speed,...}]
  anomalies: [],           // последние аномалии (таблица)
  mileageSegments: [],     // сегменты Mileage Report
  stops: [],               // стоянки startstop
  markerLocations: [],     // справочник локаций (cols marker из reinit)
  fuelPoints: [],          // точки уровня топлива
  fuelEvents: [],          // заправки/сливы
  fuelDaily: [],           // суточная таблица
  fuelSummary: null,       // сводка по бакам
  mileageTotalKm: 0,
  startstopTotalKm: 0,     // итоговый dest последней строки Startstop Sum Result
  stopDurationMs: 0,
  moveDurationMs: 0,
  // Готовность модулей
  trackLoaded: false,
  mileageLoaded: false,
};

const listeners = new Map(); // event -> Set<fn>

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  [...set].forEach((fn) => {
    try { fn(payload); } catch (e) { console.error(`Listener error (${event}):`, e); }
  });
}

// События: 'vehicles' (загружен список), 'vehicle-selected', 'track' (загружен трек),
// 'mileage', 'stops', 'cleared' (смена ТС/дат), 'settings' (настройки аномалий)
