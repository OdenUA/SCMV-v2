# Типы аномалий в SCMV v2

Данный документ описывает все типы аномалий, которые рассчитываются системой SCMV для анализа треков GPS-устройств.

---

## Содержание

1. [Аномалии трека устройства (Device Track)](#1-аномалии-трека-устройства-device-track)
   - [Time Gap (Временной разрыв)](#11-time-gap-временной-разрыв)
   - [Speed Spike (Скачок скорости)](#12-speed-spike-скачок-скорости)
   - [Position Jump (Прыжок позиции)](#13-position-jump-прыжок-позиции)
   - [Out of Bounds (Вне границ)](#14-out-of-bounds-вне-границ)
2. [Аномалии отчёта по интервалам (Full Device Track Report)](#2-аномалии-отчёта-по-интервалам-full-device-track-report)
   - [Type 1: Движение без питания](#21-type-1-движение-без-питания)
   - [Type 2: Мало спутников](#22-type-2-мало-спутников)
   - [Type 3: Комбинированная](#23-type-3-комбинированная)
   - [Type 4: За пределами (GPS-аномалия)](#24-type-4-за-пределами-gps-аномалия)
3. [Аномалии пробега (Mileage)](#3-аномалии-пробега-mileage)
   - [Пропуски между сегментами](#31-пропуски-между-сегментами)
4. [Константы и пороговые значения](#4-константы-и-пороговые-значения)
5. [Генерация SQL для удаления](#5-генерация-sql-для-удаления)

---

## 1. Аномалии трека устройства (Device Track)

Эти аномалии определяются в функции `processDeviceTrack()` в файле `device_track.js`.

### 1.1 Time Gap (Временной разрыв)

**Описание:** Обнаруживается, когда между двумя последовательными точками трека прошло слишком много времени.

**Алгоритм расчёта:**
```javascript
var GAP_THRESHOLD_MS = 10 * 60 * 1000; // 10 минут в миллисекундах

var timeDiffMs = parseDate(currentPoint.wdate) - parseDate(prevPoint.wdate);
if (timeDiffMs > GAP_THRESHOLD_MS) {
    isGap = true;
    anomalyType = "Time Gap";
}
```

**Условие срабатывания:**
- Разница во времени между точками > **10 минут** (600 000 мс)

**Визуализация:** Красная линия между точками на карте

**Фильтрация:** Добавляется в таблицу аномалий только если расстояние между точками ≥ 500 метров

---

### 1.2 Speed Spike (Скачок скорости)

**Описание:** Фиксируется нереально высокая расчётная скорость между двумя точками.

**Алгоритм расчёта:**
```javascript
var SPEED_THRESHOLD_KPH = 200; // км/ч

var distanceM = prevLL.distanceTo(currLL);
var speedKph = distanceM / 1000 / (timeDiffMs / 3600000);

if (speedKph > SPEED_THRESHOLD_KPH) {
    isGap = true;
    anomalyType = "Speed Spike";
}
```

**Условие срабатывания:**
- Расчётная скорость > **200 км/ч**

**Визуализация:** 
- В Device Track: красная линия
- В Track Raw: жёлтая пунктирная линия (порог 150 км/ч)

---

### 1.3 Position Jump (Прыжок позиции)

**Описание:** Устройство "прыгнуло" на большое расстояние при малой заявленной скорости.

**Алгоритм расчёта:**
```javascript
var JUMP_SPEED_THRESHOLD_KPH = 50;  // расчётная скорость
var REAL_SPEED_THRESHOLD_KPH = 10;   // заявленная скорость устройства

if (speedKph > JUMP_SPEED_THRESHOLD_KPH && currentPoint.speed < REAL_SPEED_THRESHOLD_KPH) {
    isGap = true;
    anomalyType = "Position Jump";
}
```

**Условие срабатывания:**
- Расчётная скорость > **50 км/ч** И
- Заявленная скорость устройства < **10 км/ч**

**Суть:** Устройство сообщает о низкой скорости, но координаты говорят о быстром перемещении — признак сбоя GPS.

---

### 1.4 Out of Bounds (Вне границ)

**Описание:** Координаты точки находятся за пределами допустимой географической зоны (Украина).

**Алгоритм расчёта:**
```javascript
// Границы (globals.js)
var BOUNDS = {
    MIN_LAT: 44.3,
    MAX_LAT: 52.4,
    MIN_LON: 22.1,
    MAX_LON: 40.2
};

function isOutOfBounds(lat, lon) {
    return (
        lat < BOUNDS.MIN_LAT ||
        lat > BOUNDS.MAX_LAT ||
        lon < BOUNDS.MIN_LON ||
        lon > BOUNDS.MAX_LON
    );
}
```

**Условие срабатывания:**
- Широта < 44.3° или > 52.4°
- Долгота < 22.1° или > 40.2°

**Визуализация:** Фиолетовая линия на карте

**Группировка:** Последовательные точки вне границ объединяются в один интервал аномалии.

---

## 2. Аномалии отчёта по интервалам (Full Device Track Report)

Эти аномалии определяются в функции `buildIntervals()` в файле `device_track.js` и отображаются в таблице "Отчёт по интервалам".

### 2.1 Type 1: Движение без питания

**Описание:** Устройство показывает движение (`ismoves = true`), но зажигание выключено (`ignition = false`).

**Алгоритм расчёта:**
```javascript
function classify(n) {
    var ign = (n.ignition === false || n.ignition === 'false' || 
               n.ignition === 0 || n.ignition === '0');
    var move = (n.ismoves === true || n.ismoves === 'true' || 
                n.ismoves === 1 || n.ismoves === '1');
    
    var type1 = ign && move;  // ignition=false И ismoves=true
    // ...
}
```

**Условие срабатывания:**
- `ignition = false` (зажигание выключено) И
- `ismoves = true` (датчик движения активен)

**Интерпретация:** Возможно, машину буксируют или GPS даёт ложные данные о движении.

---

### 2.2 Type 2: Мало спутников

**Описание:** Количество видимых спутников ниже порогового значения.

**Алгоритм расчёта:**
```javascript
var satThreshold = 10; // значение по умолчанию
// Может быть изменено пользователем через поле satThresholdInput

var sats = parseInt(n.satelites, 10);
var type2 = (sats != null && sats < satThreshold);
```

**Условие срабатывания:**
- Количество спутников < **10** (настраиваемый порог)

**Интерпретация:** Низкое качество GPS-сигнала, возможны неточные координаты.

---

### 2.3 Type 3: Комбинированная

**Описание:** Одновременно выполняются условия Type 1 и Type 2.

**Алгоритм расчёта:**
```javascript
if (type1 && type2) type = 3;
else if (type1) type = 1;
else if (type2) type = 2;
```

**Условие срабатывания:**
- Движение без питания (Type 1) И
- Мало спутников (Type 2)

**Интерпретация:** Наиболее вероятная аномалия GPS — данные ненадёжны.

---

### 2.4 Type 4: За пределами (GPS-аномалия)

**Описание:** Координаты отсутствуют или находятся за пределами допустимой зоны.

**Алгоритм расчёта:**
```javascript
function getLatLonFromRaw(raw) {
    var lat = Number(raw.latitude || raw.LATITUDE || raw.lat);
    var lon = Number(raw.longitude || raw.LONGITUDE || raw.lon);
    return {lat: lat, lon: lon};
}

// Проверка major-аномалии
if (lat == null || lon == null || isOutOfBounds(lat, lon)) {
    isMajor = true;
}

var thisType = isMajor ? 'major' : null;
// ... finalType = 4
```

**Условие срабатывания:**
- Координаты отсутствуют (null/undefined) ИЛИ
- Координаты за пределами границ Украины

**Приоритет:** Type 4 имеет высший приоритет и отображается первым в отчёте.

---

## 3. Аномалии пробега (Mileage)

Определяются в файле `mileage.js`.

### 3.1 Пропуски между сегментами

**Описание:** Расстояние между концом одного сегмента движения и началом следующего.

**Алгоритм расчёта:**
```javascript
function drawMileageGaps() {
    // Фильтруем только сегменты с движением
    var moved = lastMileageSegments.filter(function(s) {
        return s.ismoved !== false;
    });
    
    for (var i = 0; i < moved.length - 1; i++) {
        var currEnd = curr.coordinates[curr.coordinates.length - 1];
        var nextStart = next.coordinates[0];
        
        var dist = L.latLng(currEnd).distanceTo(L.latLng(nextStart));
        
        if (dist < 1) continue; // пропускаем, если меньше 1 метра
        
        // Рисуем красную пунктирную линию
        var gapLine = L.polyline([currEnd, nextStart], {
            color: "#ff0000",
            dashArray: "4,6",
            weight: 3
        });
    }
}
```

**Условие срабатывания:**
- Расстояние между сегментами ≥ **1 метр**

**Визуализация:** Красная пунктирная линия между сегментами

---

## 4. Константы и пороговые значения

| Константа | Значение | Описание | Файл |
|-----------|----------|----------|------|
| `GAP_THRESHOLD_MS` | 600 000 мс (10 мин) | Порог временного разрыва | device_track.js |
| `SPEED_THRESHOLD_KPH` | 200 км/ч | Порог скачка скорости (Device Track) | device_track.js |
| `SPEED_THRESHOLD_KPH` | 150 км/ч | Порог скачка скорости (Track Raw) | device_track.js |
| `JUMP_SPEED_THRESHOLD_KPH` | 50 км/ч | Расчётная скорость для прыжка позиции | device_track.js |
| `REAL_SPEED_THRESHOLD_KPH` | 10 км/ч | Заявленная скорость для прыжка позиции | device_track.js |
| `satThreshold` | 10 (настраиваемый) | Минимальное количество спутников | device_track.js |
| `BOUNDS.MIN_LAT` | 44.3° | Минимальная широта (юг) | globals.js |
| `BOUNDS.MAX_LAT` | 52.4° | Максимальная широта (север) | globals.js |
| `BOUNDS.MIN_LON` | 22.1° | Минимальная долгота (запад) | globals.js |
| `BOUNDS.MAX_LON` | 40.2° | Максимальная долгота (восток) | globals.js |

### Настраиваемые параметры (UI)

| Параметр | Поле ввода | Описание |
|----------|------------|----------|
| Минимальная длительность | `fullTrackMinDuration` | Фильтр интервалов по длительности (секунды) |
| Порог спутников | `fullTrackSatThreshold` | Минимум спутников для Type 2 |
| Объединение интервалов | `fullTrackMergeGap` | Объединение близких интервалов (секунды) |

---

## 5. Генерация SQL для удаления

Система позволяет генерировать SQL-команды для удаления аномальных данных из базы.

### Формат SQL

```sql
-- Комментарий с описанием диапазона
DELETE FROM snsrmain 
WHERE deviceid='<ID>' 
AND wdate >= '<начало>' 
AND wdate <= '<конец>';

-- Пересчёт start/stop для затронутых дат
SELECT recalcstartstop(<ID>, '<дата>'::date, true);
```

### Функции генерации

1. **`buildTrackCutSql(first, second)`** — SQL для удаления между двумя выбранными точками (route.js)
2. **`generateSqlFromIntervals(intervals)`** — SQL для всех аномалий Type 4 из отчёта (device_track.js)
3. **`generateAnomalySql(anomaly)`** — SQL для отдельной GPS-аномалии (utils.js)

### Особенности

- Временной диапазон расширяется на ±1 секунду для надёжности
- Удаление разбивается по дням (отдельный DELETE для каждого дня)
- После удаления вызывается `recalcstartstop()` для пересчёта стоянок

---

## Визуальное обозначение

| Тип аномалии | Цвет линии | Стиль |
|--------------|------------|-------|
| Time Gap | Красный | Сплошная |
| Speed Spike | Красный / Жёлтый | Сплошная / Пунктир |
| Position Jump | Красный | Сплошная |
| Out of Bounds | Фиолетовый (#800080) | Сплошная |
| Mileage Gap | Красный | Пунктир (4,6) |

### Цвета строк в таблице отчёта

| Type | CSS-класс | Описание |
|------|-----------|----------|
| 1 | `fdt-interval-type1` | Движение без питания |
| 2 | `fdt-interval-type2` | Мало спутников |
| 3 | `fdt-interval-type3` | Комбинированная |
| 4 | `fdt-interval-type4` | За пределами |

---

*Документ создан: 26.11.2025*
*Версия системы: SCMV v2*
