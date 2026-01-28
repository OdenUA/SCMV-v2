# SCMV WebSocket Protocol Specification

## Overview

SCMV использует WebSocket для всей коммуникации между клиентом и сервером.

**Endpoint:** `wss://scmv.vpngps.com:4445`

---

## 1. Общая структура сообщений

### Запрос (Request)

```json
{
  "name": "<request_name>",
  "type": "<request_type>",
  "mid": <number>,
  "act": "<action>",
  "filter": [{ "<key>": ["<value>"] }],
  "nowait": <boolean>,
  "waitfor": ["<field>"],
  "usr": "<username>",
  "pwd": "<password>",
  "uid": <user_id>,
  "lang": "en"
}
```

### Ответ (Response)

```json
{
  "name": "<request_name>",
  "res": [{
    "cols": [...],
    "f": [...]
  }],
  "filter": [...],
  "msg": "<error_or_status_message>"
}
```

---

## 2. Авторизация

### Login Request

```json
{
  "name": "login",
  "type": "login",
  "mid": 0,
  "act": "setup",
  "usr": "username",
  "pwd": "password",
  "uid": 0,
  "lang": "en"
}
```

### Login Response (Success)

```json
{
  "name": "login",
  "res": [{
    "uid": 123
  }]
}
```

### Login Response (Failure)

```json
{
  "name": "login",
  "res": [{}],
  "msg": "Invalid credentials"
}
```

**Проверка успеха:** `response.res[0].uid > 0`

---

## 3. Список устройств

### Vehicle Select Min (Init)

```json
{
  "name": "Vehicle Select Min",
  "type": "etbl",
  "mid": 4,
  "act": "init",
  "usr": "username",
  "pwd": "password",
  "uid": 123,
  "lang": "en"
}
```

### Vehicle Select Min (Setup)

Отправляется через ~150ms после init:

```json
{
  "name": "Vehicle Select Min",
  "type": "etbl",
  "mid": 4,
  "act": "setup",
  "filter": [{ "selecteduid": [123] }],
  "nowait": true,
  "waitfor": [],
  "usr": "username",
  "pwd": "password",
  "uid": 123,
  "lang": "en"
}
```

### Response

```json
{
  "name": "Vehicle Select Min",
  "res": [{
    "cols": [
      {
        "f": "fleet",
        "k": [
          { "key": 1, "val": "Флот 1" },
          { "key": 2, "val": "Флот 2" }
        ]
      }
    ],
    "f": [
      {
        "id": 456,
        "fleet": 1,
        "vehicle": "Машина ABC-123",
        "imei": "123456789012345"
      }
    ]
  }]
}
```

**Поля устройства:**
- `id` — уникальный ID устройства (используется как `selectedvihicleid`)
- `fleet` — ID флота (ключ для `cols[].k`)
- `vehicle` — название устройства
- `imei` — IMEI трекера

---

## 4. Mileage Report

### Request

```json
{
  "name": "Mileage Report",
  "type": "map",
  "mid": 2,
  "act": "filter",
  "filter": [
    { "selectedvihicleid": ["456"] },
    { "selectedpgdateto": ["2025-01-13T23:59:59"] },
    { "selectedpgdatefrom": ["2025-01-13T00:00:00"] }
  ],
  "usr": "username",
  "pwd": "password",
  "uid": 123,
  "lang": "en"
}
```

### Response

```json
{
  "name": "Mileage Report",
  "res": [{
    "f": [
      {
        "coordinates": [[50.1234, 30.5678], [50.1235, 30.5679]],
        "fdate": "2025-01-13 08:00:00",
        "tdate": "2025-01-13 08:30:00",
        "period": "00:30:00",
        "ismoved": true
      },
      {
        "coordinates": [[50.1235, 30.5679]],
        "fdate": "2025-01-13 08:30:00",
        "tdate": "2025-01-13 09:00:00",
        "period": "00:30:00",
        "ismoved": false
      }
    ]
  }]
}
```

**Поля сегмента:**
- `coordinates` — массив `[lat, lon]`
- `fdate` — время начала сегмента
- `tdate` — время окончания
- `period` — продолжительность (HH:mm:ss)
- `ismoved` — `true` = движение, `false` = стоянка

---

## 5. Vehicle Track (GPS Points)

### Request

```json
{
  "name": "Vehicle Track",
  "type": "map",
  "mid": 2,
  "act": "filter",
  "filter": [
    { "selectedpgdateto": ["2025-01-13T23:59:59"] },
    { "selectedpgdatefrom": ["2025-01-13T00:00:00"] },
    { "selectedvihicleid": ["456"] }
  ],
  "usr": "username",
  "pwd": "password",
  "uid": 123,
  "lang": "en"
}
```

### Response

```json
{
  "name": "Vehicle Track",
  "res": [{
    "f": [
      {
        "latitude": 50.12345,
        "longitude": 30.67890,
        "wdate": "2025-01-13T08:00:15",
        "speed": 45
      }
    ]
  }]
}
```

**Поля точки:**
- `latitude`, `longitude` — координаты
- `wdate` — время (ISO или `YYYY-MM-DD HH:mm:ss`)
- `speed` — скорость км/ч

---

## 6. Device Track (Raw Track)

### Request

```json
{
  "name": "Device Track",
  "type": "etbl",
  "mid": 6,
  "act": "setup",
  "filter": [
    { "selectedpgdateto": ["2025-01-13T23:59:59"] },
    { "selectedpgdatefrom": ["2025-01-13T00:00:00"] },
    { "selecteddeviceid": ["456"] }
  ],
  "nowait": false,
  "waitfor": ["selectedpgdateto"],
  "usr": "username",
  "pwd": "password",
  "uid": 123,
  "lang": "en"
}
```

**Важно:** Используется `selecteddeviceid`, а не `selectedvihicleid`.

### Response

Аналогично Vehicle Track, но может содержать дополнительные поля:
- `satelites` — количество спутников
- `ignition` — состояние зажигания
- `ismoves` — датчик движения

---

## 7. Startstop Accumulation

### Request

```json
{
  "name": "Startstop accumulation",
  "type": "etbl",
  "mid": 5,
  "act": "filter",
  "filter": [
    { "selectedpgdatefrom": ["2025-01-13T00:00:00"] },
    { "selectedvihicleid": ["456"] },
    { "selectedpgdateto": ["2025-01-13T23:59:59"] }
  ],
  "usr": "username",
  "pwd": "password",
  "uid": 123,
  "lang": "en"
}
```

### Response

```json
{
  "name": "Startstop accumulation",
  "res": [{
    "f": [
      {
        "state": "asstopped",
        "dist": 15.5,
        "time": "2025-01-13 08:30:00",
        "duration": "00:30:00"
      }
    ]
  }]
}
```

---

## 8. Device Log

### Request

```json
{
  "name": "Device Log",
  "type": "etbl",
  "mid": 5,
  "act": "filter",
  "filter": [
    { "selecteddeviceid": ["456"] },
    { "selectedpgdateto": ["2025-01-13T23:59:59"] },
    { "selectedpgdatefrom": ["2025-01-13T00:00:00"] }
  ],
  "usr": "username",
  "pwd": "password",
  "uid": 123,
  "lang": "en"
}
```

---

## 9. Формат дат

### В запросах
```
YYYY-MM-DDTHH:mm:ss
```
Пример: `2025-01-13T08:00:00`

### В ответах
Может быть:
- ISO: `2025-01-13T08:00:15`
- Пробел: `2025-01-13 08:00:15`

---

## 10. Обработка ошибок

### Сетевые ошибки
При потере соединения — переподключение через 5 секунд.

### Ошибки API
Проверять поле `msg` в ответе:
```json
{
  "name": "...",
  "res": [{}],
  "msg": "Error description"
}
```

---

## 11. Константы для Android

```kotlin
object WsConstants {
    const val WS_URL = "wss://scmv.vpngps.com:4445"
    const val RECONNECT_DELAY_MS = 5000L
    const val INIT_SETUP_DELAY_MS = 150L
}
```

---

## 12. Kotlin Data Classes (примеры)

```kotlin
@Serializable
data class WsRequest(
    val name: String,
    val type: String,
    val mid: Int,
    val act: String,
    val filter: List<Map<String, List<String>>> = emptyList(),
    val nowait: Boolean? = null,
    val waitfor: List<String>? = null,
    val usr: String,
    val pwd: String,
    val uid: Int,
    val lang: String = "en"
)

@Serializable
data class WsResponse(
    val name: String,
    val res: List<WsResultSet>? = null,
    val filter: List<Map<String, List<String>>>? = null,
    val msg: String? = null
)

@Serializable
data class WsResultSet(
    val cols: List<WsColumn>? = null,
    val f: List<JsonObject>? = null
)
```

---

## Примечания для реализации

1. **Порядок filter-параметров** — может быть важен, сохранять как в примерах
2. **Значения в filter** — всегда массив строк, даже для чисел
3. **uid** — числовой, не строка
4. **mid** — идентификатор типа запроса, фиксированный для каждого name
