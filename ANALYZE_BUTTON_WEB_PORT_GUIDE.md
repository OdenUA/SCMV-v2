# Инструкция: Портирование кнопки Analyze (Analysis Mode) в веб-версию SCMV

> **Источник:** Android-приложение SCMV (`MapScreen`, `MapViewModel`, `TrackAnalyzer`, `TrackRepository`, `AnalysisPanel`)  
> **Цель:** Воспроизвести идентичный функционал режима Analysis в веб-версии (JavaScript/TypeScript).

---

## 1. Обзор функционала

Режим **Analysis** — это третий режим отображения трека (наряду с Mileage и Raw Track). Он загружает **сырые GPS-точки** устройства (`Device Track`), анализирует их на наличие проблем и отображает маршрут в виде **цветных сегментов**, где каждый цвет соответствует типу проблемы. Также отображается панель с краткой сводкой и списком сегментов.

### Ключевые отличия от Raw Track:
- Raw Track: показывает точки как есть + аномалии (разрывы, скорость, стрибки)
- Analysis: **группирует последовательные точки с одинаковыми проблемами в сегменты**, раскрашивает сегменты по цвету главной проблемы, показывает статистику по каждому сегменту

---

## 2. Архитектура Flow (последовательность действий)

```
Пользователь выбирает режим "Analysis"
    ↓
MapViewModel.loadAnalysisTrack()
    ↓
TrackRepository.getAnalysisTrack(deviceId, from, to)
    ↓
WebSocket запрос: "Device Track" (act=filter, mid=6)
    ↓
Парсинг ответа → List<TrackPoint>
    ↓
TrackAnalyzer.analyze(points) → List<TrackSegment>
    ↓
Обновление UI state: analysisSegments + isAnalysisVisible=true
    ↓
[Карта] convertAnalysisSegmentsToPolylines() → цветные полилинии
    ↓
[Панель] AnalysisPanel() → сводка + список сегментов
    ↓
[Клик по сегменту] Диалог деталей / центрирование карты
```

---

## 3. WebSocket API: Запрос и ответ

### 3.1 Запрос на загрузку точек для Analysis

```json
{
  "name": "Device Track",
  "type": "etbl",
  "mid": 6,
  "act": "filter",
  "filter": [
    {"selectedpgdateto": ["2025-01-13T23:59:59"]},
    {"selectedpgdatefrom": ["2025-01-13T00:00:00"]},
    {"selecteddeviceid": ["12345"]}
  ],
  "usr": "username",
  "pwd": "password",
  "uid": 42,
  "lang": "en"
}
```

**Важные нюансы:**
- `act`: `"filter"` (не `"setup"` как в обычном Device Track)
- Порядок в `filter` массиве: **сначала `selectedpgdateto`, потом `selectedpgdatefrom`, потом `selecteddeviceid`**
- `selecteddeviceid` — именно **device** (не vehicle!)
- Ожидаемый ответ: `name === "Device Track"`

### 3.2 Парсинг ответа

Ответ приходит в стандартном формате `WsResponse`:

```json
{
  "name": "Device Track",
  "res": [{
    "cols": [...],
    "f": [
      {
        "latitude": 50.45,
        "longitude": 30.52,
        "wdate": "13.01.25T14:30:00",
        "speed": 45.5,
        "satelites": 12,
        "ignition": true,
        "ismoves": true,
        "batvoltage": 132,
        "altitude": 180.0
      }
    ]
  }]
}
```

**Поля точки (TrackPoint):**

| Поле | Тип | Описание | Обязательное |
|------|-----|----------|-------------|
| `latitude` | number | Широта | ✅ |
| `longitude` | number | Долгота | ✅ |
| `wdate` | string | Время точки | ✅ |
| `speed` | number | Скорость (км/ч) | ❌ (default: 0) |
| `satelites` | number | Количество спутников | ❌ (raw only) |
| `ignition` | boolean | Зажигание включено | ❌ (raw only) |
| `ismoves` | boolean | Датчик движения | ❌ (raw only) |
| `batvoltage` | number | Напряжение (в десятых вольта) | ❌ (raw only) |
| `altitude` | number | Высота (м) | ❌ (raw only) |

**Парсинг дат:** Raw track использует короткий формат. Поддержать 3 формата:
1. `dd.MM.yy'T'HH:mm:ss` — основной (например, `13.01.25T14:30:00`)
2. `dd.MM.yy HH:mm:ss` — с пробелом
3. `dd.MM.yyyy'T'HH:mm:ss` — полный год

**Важно:** `batvoltage` приходит в десятых вольта (например, `132` = 13.2V). При парсинге делить на 10 для получения вольт.

---

## 4. Алгоритм анализа трека (TrackAnalyzer)

### 4.1 Вход и выход

```typescript
function analyze(points: TrackPoint[]): TrackSegment[]
```

**Правило:** точки должны быть **отсортированы по timestamp (от старого к новому)** перед анализом.

### 4.2 Детекция проблем для каждой точки

Для каждой точки (с учётом предыдущей) собирается `Set<TrackIssueType>`:

```typescript
function detectIssuesForPoint(current: TrackPoint, prev: TrackPoint | null): Set<TrackIssueType> {
  const issues = new Set<TrackIssueType>();

  // 1. Мало спутников (< 8)
  if (current.satellites !== null && current.satellites < 8) {
    issues.add(TrackIssueType.LOW_SATELLITES);
  }

  // 2. Низкое напряжение (< 12V)
  // ВАЖНО: batvoltage в ответе приходит в десятых вольта (132 = 13.2V)
  if (current.voltage !== null && current.voltage < 12.0) {
    issues.add(TrackIssueType.LOW_VOLTAGE);
  }

  // Контекстные проверки (требуют prev)
  if (prev !== null) {
    const timeDeltaMs = current.timestamp.getTime() - prev.timestamp.getTime();
    const timeDeltaMinutes = timeDeltaMs / 60000;

    // 3. Разрыв данных (> 10 минут между точками)
    if (timeDeltaMinutes > 10) {
      issues.add(TrackIssueType.TIME_GAP);
    }

    // 4. Расчёт расстояния (Haversine)
    const distanceMeters = haversineDistance(
      prev.latitude, prev.longitude,
      current.latitude, current.longitude
    );

    // 5. Движение без зажигания
    const ignition = current.ignition ?? true;
    const isMoving = current.isMoving ?? false;
    if (!ignition && (isMoving || distanceMeters > 20.0)) {
      issues.add(TrackIssueType.MOVEMENT_WITHOUT_POWER);
    }

    // 6. Стрибок швидкости (расчётная скорость > 200 км/ч)
    const timeDeltaHours = timeDeltaMs / 3600000;
    if (timeDeltaHours > 0) {
      const calculatedSpeedKmh = (distanceMeters / 1000.0) / timeDeltaHours;
      if (calculatedSpeedKmh > 200.0) {
        issues.add(TrackIssueType.SPEED_SPIKE);
      }
    }

    // 7. Аномалия высоты (> 500м изменения)
    if (prev.altitude !== null && current.altitude !== null) {
      const altDelta = Math.abs(current.altitude - prev.altitude);
      if (altDelta > 500.0) {
        issues.add(TrackIssueType.ALTITUDE_SPIKE);
      }
    }

    // 8. Статичный рух (speed == 0 но координаты изменились > 50м)
    if (current.speed === 0.0 && distanceMeters > 50.0) {
      issues.add(TrackIssueType.STATIC_MOVING);
    }
  }

  return issues;
}
```

### 4.3 Группировка в сегменты

**Ключевое правило:** последовательные точки с **точно одинаковым набором проблем** объединяются в один сегмент.

```typescript
function groupIntoSegments(
  pointsWithIssues: Array<{ point: TrackPoint; issues: Set<TrackIssueType> }>
): TrackSegment[] {
  if (pointsWithIssues.length === 0) return [];

  const segments: TrackSegment[] = [];
  let currentPoints: TrackPoint[] = [pointsWithIssues[0].point];
  let currentIssues = new Set(pointsWithIssues[0].issues);

  for (let i = 1; i < pointsWithIssues.length; i++) {
    const { point, issues } = pointsWithIssues[i];

    // Сравнение Set: одинаковый размер и все элементы совпадают
    if (setsEqual(issues, currentIssues)) {
      currentPoints.push(point);
    } else {
      // Набор проблем изменился — finalize текущий сегмент
      segments.push(createSegment(currentPoints, currentIssues));
      currentPoints = [point];
      currentIssues = new Set(issues);
    }
  }

  // Не забыть последний сегмент
  segments.push(createSegment(currentPoints, currentIssues));
  return segments;
}

function createSegment(points: TrackPoint[], issues: Set<TrackIssueType>): TrackSegment {
  const startTime = points[0].timestamp;
  const endTime = points[points.length - 1].timestamp;
  const durationMs = endTime.getTime() - startTime.getTime();

  return {
    startTime,
    endTime,
    issues: new Set(issues),
    points,
    duration: durationMs, // или Duration объект
    count: points.length,
    stats: calculateStats(points)
  };
}
```

### 4.4 Расчёт статистики сегмента

```typescript
function calculateStats(points: TrackPoint): SegmentStats {
  const satellites = points.map(p => p.satellites).filter((s): s is number => s !== null);
  const voltages = points.map(p => p.voltage).filter((v): v is number => v !== null);
  const speeds = points.map(p => p.speed);

  let totalDistance = 0.0;
  for (let i = 1; i < points.length; i++) {
    totalDistance += haversineDistance(
      points[i - 1].latitude, points[i - 1].longitude,
      points[i].latitude, points[i].longitude
    );
  }

  return {
    avgSatellites: satellites.length > 0 ? average(satellites) : null,
    minSatellites: satellites.length > 0 ? Math.min(...satellites) : null,
    maxSatellites: satellites.length > 0 ? Math.max(...satellites) : null,
    avgVoltage: voltages.length > 0 ? average(voltages) : null,
    minVoltage: voltages.length > 0 ? Math.min(...voltages) : null,
    maxVoltage: voltages.length > 0 ? Math.max(...voltages) : null,
    avgSpeed: speeds.length > 0 ? average(speeds) : null,
    maxSpeed: speeds.length > 0 ? Math.max(...speeds) : null,
    distanceTraveled: totalDistance
  };
}
```

### 4.5 Формула Haversine

```typescript
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusM = 6_371_000.0;
  const dLat = Math.toRadians(lat2 - lat1);
  const dLon = Math.toRadians(lon2 - lon1);
  const lat1Rad = Math.toRadians(lat1);
  const lat2Rad = Math.toRadians(lat2);

  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusM * c;
}
```

---

## 5. Типы проблем и их свойства

### 5.1 Перечисление TrackIssueType

| Тип | displayName (укр.) | Цвет | Emoji | Порог |
|-----|-------------------|------|-------|-------|
| `NONE` | Без помилок | `#4CAF50` | ✅ | — |
| `LOW_SATELLITES` | Мало супутників | `#FFC107` | 🟡 | < 8 спутников |
| `LOW_VOLTAGE` | Низька напруга | `#FF9800` | 🟠 | < 12V |
| `MOVEMENT_WITHOUT_POWER` | Рух без живлення | `#F44336` | 🔴 | зажигание выкл. + движение > 20м |
| `TIME_GAP` | Розрив даних | `#9E9E9E` | ⚫ | > 10 мин между точками |
| `SPEED_SPIKE` | Стрибок швидкості | `#9C27B0` | 🟣 | расчётная > 200 км/ч |
| `ALTITUDE_SPIKE` | Аномалія висоти | `#795548` | 🟤 | > 500м |
| `STATIC_MOVING` | Статичний рух | `#607D8B` | 🔵 | speed=0 + смещение > 50м |

### 5.2 Выбор главной проблемы (primaryIssue)

Когда у сегмента несколько проблем, цвет определяется по **приоритету** (от высшего к низшему):

```typescript
const ISSUE_PRIORITY = [
  TrackIssueType.MOVEMENT_WITHOUT_POWER,  // 🔴 Red — highest
  TrackIssueType.LOW_VOLTAGE,              // 🟠 Orange
  TrackIssueType.SPEED_SPIKE,              // 🟣 Purple
  TrackIssueType.LOW_SATELLITES,           // 🟡 Yellow
  TrackIssueType.TIME_GAP,                 // ⚫ Grey
  TrackIssueType.ALTITUDE_SPIKE,           // 🟤 Brown
  TrackIssueType.STATIC_MOVING             // 🔵 Blue-grey
];

function primaryIssue(issues: Set<TrackIssueType>): TrackIssueType {
  if (issues.size === 0) return TrackIssueType.NONE;
  return ISSUE_PRIORITY.find(issue => issues.has(issue)) ?? TrackIssueType.NONE;
}
```

### 5.3 Форматирование labels

```typescript
function issuesLabel(segment: TrackSegment): string {
  if (segment.issues.size === 0) return "Без помилок";

  const parts = Array.from(segment.issues).map(issue => {
    switch (issue) {
      case TrackIssueType.LOW_VOLTAGE:
        const voltage = segment.stats?.avgVoltage;
        return voltage !== null ? `Низька напруга ${voltage.toFixed(1)}V` : "Низька напруга";
      case TrackIssueType.LOW_SATELLITES:
        const sats = segment.stats?.avgSatellites;
        return sats !== null ? `Мало супутників ${sats.toFixed(1)}` : "Мало супутників";
      default:
        return issue.displayName;
    }
  });

  return parts.join(" + ");
}

function formattedDuration(durationMs: number): string {
  const totalMinutes = Math.floor(durationMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}
```

---

## 6. Визуализация на карте

### 6.1 Конвертация сегментов в полилинии

Каждый сегмент = одна полилиния на карте. Цвет полилинии = `primaryIssue.color`.

```typescript
function convertAnalysisSegmentsToPolylines(segments: TrackSegment[]): MapPolyline[] {
  return segments.map(segment => ({
    points: segment.points.map(p => ({ lat: p.latitude, lng: p.longitude })),
    color: segment.primaryIssue.color,
    width: 6,
    title: segment.primaryIssue.displayName,
    trackSegment: segment // ссылка на оригинал для клика
  }));
}
```

### 6.2 Поведение при клике на сегмент карты

При клике на полилинию сегмента:
1. Показать **AlertDialog/Modal** с деталями сегмента
2. Содержимое диалога:
   - Заголовок: "Інформація про сегмент"
   - Час: `HH:mm:ss - HH:mm:ss`
   - Тривалість: `formattedDuration()`
   - Точок: `count`
   - Проблеми: `issuesLabel()` (bold)
   - Детали (если stats есть):
     - Сер. швидкість: `avgSpeed?.toFixed(1)` км/год
     - Макс. швидкість: `maxSpeed?.toFixed(1)` км/год
     - Сер. напруга: `avgVoltage?.toFixed(1)` V
     - Сер. супутників: `avgSatellites?.toFixed(1)`
     - Відстань: `distanceTraveled?.toFixed(1)` м

---

## 7. Панель Analysis (AnalysisPanel)

### 7.1 Расположение

- **Свернутая:** Верхний правый угол (справа от кнопок управления карты), фиксированная ширина ~280px
- **Развёрнутая:** Полноэкранная панель (или большая панель поверх карты)

### 7.2 Содержимое панели

```
┌─────────────────────────────────────────┐
│ Аналіз маршруту                    [▼]  │  ← клик = expand/collapse
│ ✅ 15 без помилок, ⚠️ 3 з проблемами    │
├─────────────────────────────────────────┤
│ ● 08:15 - 08:22  Без помилок  7 хв, 42│  ← список сегментов (только expanded)
│ ● 08:22 - 08:25  Низька напруга 3 хв, 5│
│ ● 08:25 - 08:40  Розрив даних  15 хв, 1│
└─────────────────────────────────────────┘
```

### 7.3 Строка сегмента (SegmentRow)

Каждая строка содержит:
1. **Цветной индикатор** (круг 12px) — `primaryIssue.color`
2. **Время** — `HH:mm - HH:mm`
3. **Label проблемы** — `issuesLabel()`
4. **Статистика** — `formattedDuration(), count` (справа, muted)
5. **Иконка** "показать на карте" (опционально)

**Клик по строке:**
- Центрировать карту на **первой точке** сегмента
- Zoom level: `15`
- Анимация: да (плавная прокрутка)

### 7.4 Логика expand/collapse

```typescript
// Состояние в компоненте
const [isExpanded, setIsExpanded] = useState(false);

// При переключении из режима Analysis в другой — сбрасывать:
useEffect(() => {
  if (trackMode !== 'ANALYSIS') {
    setIsExpanded(false);
  }
}, [trackMode]);
```

---

## 8. Полная TypeScript модель данных

```typescript
interface TrackPoint {
  latitude: number;
  longitude: number;
  timestamp: Date; // или number (unix ms)
  speed: number;
  satellites?: number;
  ignition?: boolean;
  isMoving?: boolean;
  voltage?: number; // в вольтах (уже разделённое на 10)
  altitude?: number;
}

enum TrackIssueType {
  NONE = 'NONE',
  LOW_SATELLITES = 'LOW_SATELLITES',
  LOW_VOLTAGE = 'LOW_VOLTAGE',
  MOVEMENT_WITHOUT_POWER = 'MOVEMENT_WITHOUT_POWER',
  TIME_GAP = 'TIME_GAP',
  SPEED_SPIKE = 'SPEED_SPIKE',
  ALTITUDE_SPIKE = 'ALTITUDE_SPIKE',
  STATIC_MOVING = 'STATIC_MOVING'
}

const TRACK_ISSUE_META: Record<TrackIssueType, { displayName: string; color: string; emoji: string }> = {
  [TrackIssueType.NONE]:               { displayName: 'Без помилок', color: '#4CAF50', emoji: '✅' },
  [TrackIssueType.LOW_SATELLITES]:     { displayName: 'Мало супутників', color: '#FFC107', emoji: '🟡' },
  [TrackIssueType.LOW_VOLTAGE]:        { displayName: 'Низька напруга', color: '#FF9800', emoji: '🟠' },
  [TrackIssueType.MOVEMENT_WITHOUT_POWER]: { displayName: 'Рух без живлення', color: '#F44336', emoji: '🔴' },
  [TrackIssueType.TIME_GAP]:           { displayName: 'Розрив даних', color: '#9E9E9E', emoji: '⚫' },
  [TrackIssueType.SPEED_SPIKE]:        { displayName: 'Стрибок швидкості', color: '#9C27B0', emoji: '🟣' },
  [TrackIssueType.ALTITUDE_SPIKE]:     { displayName: 'Аномалія висоти', color: '#795548', emoji: '🟤' },
  [TrackIssueType.STATIC_MOVING]:      { displayName: 'Статичний рух', color: '#607D8B', emoji: '🔵' }
};

interface SegmentStats {
  avgSatellites?: number;
  minSatellites?: number;
  maxSatellites?: number;
  avgVoltage?: number;
  minVoltage?: number;
  maxVoltage?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  distanceTraveled?: number;
}

interface TrackSegment {
  startTime: Date;
  endTime: Date;
  issues: Set<TrackIssueType>;
  points: TrackPoint[];
  duration: number; // milliseconds
  count: number;
  stats: SegmentStats;
}
```

---

## 9. Константы (скопировать 1 в 1)

```typescript
const ANALYZER_CONSTANTS = {
  LOW_SATELLITES_THRESHOLD: 8,
  LOW_VOLTAGE_THRESHOLD: 12,        // volts
  TIME_GAP_MINUTES: 10,             // minutes
  SPEED_SPIKE_THRESHOLD: 200.0,     // km/h (calculated)
  ALTITUDE_SPIKE_THRESHOLD: 500.0,  // meters
  STATIC_MOVING_DISTANCE_THRESHOLD: 50.0, // meters
  MOVEMENT_DISTANCE_THRESHOLD: 20.0 // meters
} as const;
```

---

## 10. Edge Cases и важные замечания

1. **Одиночная точка:** если пришла 1 точка — создать 1 сегмент длительностью 0, issues через `detectIssuesForPoint(current, null)`
2. **Пустой трек:** `analyze([])` → `[]`
3. **Все точки нормальные:** все сегменты будут с `issues={NONE}`, цвет зелёный
4. **BatVoltage:** сервер присылает `132` → это `13.2V`. Парсить как `batvoltage / 10.0`
5. **Порядок фильтров в запросе:** для `analyzeTrackRequest` порядок `filter` имеет значение: сначала `selectedpgdateto`, потом `selectedpgdatefrom`, потом `selecteddeviceid`
6. **Ignition и isMoving:** могут отсутствовать в ответе. Тогда `ignition = true`, `isMoving = false` (default)
7. **Speed из ответа:** это заявленная скорость устройства. `calculatedSpeed` — расчётная по координатам. Для `SPEED_SPIKE` используется **calculatedSpeed**, не заявленная.
8. **Границы Украины (Out of Bounds):** в Analysis mode **НЕ используются** (они есть только в AnomalyDetector для Raw Track). Analysis смотрит только на спутники, напряжение, разрывы, скорость, высоту, зажигание.
9. **Сравнение Set:** при группировке сегментов важно точное совпадение множеств проблем. `{TIME_GAP, LOW_VOLTAGE} !== {TIME_GAP}` — это разные сегменты.
10. **Автоматический reset:** при переключении с Analysis на другой режим — очищать `analysisSegments` и сбрасывать `isExpanded` панели.

---

## 11. Пример полного использования (псевдо-код)

```typescript
// 1. Пользователь выбирает Analysis
function onTrackModeChange(mode: 'MILEAGE' | 'RAW' | 'ANALYSIS') {
  if (mode === 'ANALYSIS') {
    loadAnalysisTrack();
  }
}

// 2. Загрузка данных
async function loadAnalysisTrack() {
  setLoading(true);
  try {
    const response = await wsClient.sendRequest({
      name: "Device Track",
      type: "etbl",
      mid: 6,
      act: "filter",
      filter: [
        { selectedpgdateto: [dateTo] },
        { selectedpgdatefrom: [dateFrom] },
        { selecteddeviceid: [deviceId] }
      ],
      usr, pwd, uid, lang: "en"
    });

    const points = parseTrackResponse(response, /* isRawTrack */ true);
    const segments = TrackAnalyzer.analyze(points);

    setState({
      analysisSegments: segments,
      isAnalysisVisible: true,
      isLoading: false
    });
  } catch (e) {
    setError(e.message);
    setLoading(false);
  }
}

// 3. Рендер карты
function renderMap() {
  const polylines = analysisSegments.map(seg => ({
    path: seg.points.map(p => [p.latitude, p.longitude]),
    color: primaryIssue(seg.issues).color,
    width: 6,
    onClick: () => showSegmentDetails(seg)
  }));

  return <Map polylines={polylines} />;
}

// 4. Рендер панели
function renderAnalysisPanel() {
  if (trackMode !== 'ANALYSIS' || analysisSegments.length === 0) return null;

  const okCount = analysisSegments.filter(s => s.issues.size === 0).length;
  const problemCount = analysisSegments.length - okCount;

  return (
    <AnalysisPanel
      segments={analysisSegments}
      okCount={okCount}
      problemCount={problemCount}
      onSegmentClick={(seg) => map.setCenter(seg.points[0], 15)}
    />
  );
}
```

---

## 12. Сводка отличий от Raw Track Anomalies

| Аспект | Raw Track Anomalies | Analysis Mode |
|--------|-------------------|---------------|
| **Источник данных** | Device Track (act=setup) | Device Track (act=filter) |
| **Что анализируется** | Пары точек (gap, speed, jump, bounds) | Каждая точка + контекст (спутники, напряжение, зажигание) |
| **Результат** | Список Anomaly (разрозненных) | Список TrackSegment (группированных) |
| **Визуализация** | Пунктирные линии поверх трека | Сплошные цветные сегменты |
| **Панель** | AnomalyPanel (снизу) | AnalysisPanel (справа/поверх) |
| **Пороги** | 30 мин gap, 150 км/ч, 1200м jump | 10 мин gap, 200 км/ч, 500м altitude |
| **Bounds check** | Да (Украина) | Нет |
| **Статистика** | Нет | Да (avg/max speed, voltage, satellites, distance) |
