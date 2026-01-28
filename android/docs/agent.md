# SCMV Android — Agent Instructions

## Project Overview

Android-приложение для просмотра и анализа GPS-треков устройств. Порт веб-версии SCMV v2.

## Tech Stack

- **Language:** Kotlin
- **Min SDK:** 24 (Android 7.0)
- **UI:** Jetpack Compose + Material 3
- **DI:** Hilt
- **Network:** OkHttp WebSocket
- **Map:** OSMdroid
- **Storage:** DataStore Preferences
- **Async:** Kotlin Coroutines + Flow
- **Serialization:** kotlinx-serialization

## Architecture

Clean Architecture с тремя слоями:
1. **UI** — Compose screens, ViewModels
2. **Domain** — Use Cases, Models
3. **Data** — Repositories, WebSocket Client, Session Manager

## Key Files

- `DEVELOPMENT_PLAN.md` — полный план разработки с этапами
- `WEBSOCKET_PROTOCOL.md` — спецификация WebSocket API

## WebSocket Server

- **URL:** `wss://scmv.vpngps.com:4445`
- **Protocol:** JSON messages
- **Auth:** login/password → uid

## Critical Implementation Notes

### 1. WebSocket
- Использовать OkHttp WebSocketListener
- Авто-реконнект при потере соединения (5 сек delay)
- StateFlow для состояния подключения
- Все сообщения — JSON

### 2. Authentication
- После успешного login сохранять: usr, pwd, uid
- "Запомнить меня" → DataStore
- При старте проверять сохранённую сессию

### 3. Date Format
- Запросы: `YYYY-MM-DDTHH:mm:ss`
- Ответы могут быть: ISO или `YYYY-MM-DD HH:mm:ss`

### 4. Device IDs
- `selectedvihicleid` — для Mileage, Vehicle Track
- `selecteddeviceid` — для Device Track, Device Log

### 5. Anomaly Detection (Local)
Constants in `util/Constants.kt`:
```kotlin
// Vehicle Track thresholds
const val GAP_THRESHOLD_MS = 600_000L         // 10 min
const val SPEED_THRESHOLD_KPH = 200.0         // km/h
const val JUMP_SPEED_KPH = 50.0               // calculated speed
const val REAL_SPEED_KPH = 10.0               // reported speed
const val POSITION_JUMP_M = 800.0             // meters

// Raw Track thresholds (stricter)
const val RAW_GAP_THRESHOLD_MS = 1_800_000L   // 30 min
const val RAW_SPEED_THRESHOLD_KPH = 150.0     // km/h
const val RAW_POSITION_JUMP_M = 1200.0        // meters

// Ukraine bounds
const val MIN_LAT = 44.3
const val MAX_LAT = 52.4
const val MIN_LON = 22.1
const val MAX_LON = 40.2
```

### 6. OSMdroid
- Требует USER_AGENT для загрузки тайлов
- Кэширование тайлов включено по умолчанию
- Configuration в Application.onCreate()

## Coding Standards

1. **Flat structure** — избегать глубокой вложенности
2. **Explicit state** — StateFlow/UiState для UI
3. **Descriptive naming** — понятные имена функций и переменных
4. **Structured logging** — Log.d/i/e с тегами
5. **Regenerable modules** — каждый файл независим

## Testing

- Unit tests для Use Cases и AnomalyDetector
- Instrumented tests для WebSocket (mock server)
- UI tests с Compose Testing

## Current Status

- [x] Этап 1: Инфраструктура (Gradle, Hilt, OkHttp)
- [x] Этап 2: Авторизация (LoginScreen + SessionManager)
- [x] Этап 3: Список устройств (DevicesScreen + поиск)
- [x] Этап 4: Карта + Mileage треки (OSMdroid + polylines)
- [x] Этап 5: Track Raw (сырые данные)
- [x] Этап 7: Аномалии (AnomalyDetector + AnomalyPanel + map visualization)
- [x] Этап 7.1: Direction arrows (pixel-based, zoom-independent)
- [x] Этап 7.2: Stop visibility toggle (filter stops < 5 min)
- [x] Этап 7.3: Settings screen (logout, line width, marker size)
- [x] Этап 7.4: Date/time defaults (today 00:00-23:59)
- [ ] Этап 6: Mileage отчёты (таблица в BottomSheet)
- [ ] Этап 8: SQL генератор
- [ ] Этап 9: Логи устройств

## Build Status

- ✅ APK builds successfully (18.7 MB)
- ✅ Java 21 + Gradle 8.7 + AGP 8.5.0
- ✅ Min SDK 24, Target SDK 34

## UI Components

### Device Selection
- **`DeviceSelectionSheet.kt`** — Modal bottom sheet for device selection
  - Full-screen modal that opens when tapping device selector button
  - Features: search (by name, IMEI, ID, филиал), fleet filter chips, scrollable device list
  - Selected device is highlighted with primary color border
  - Pattern: matches web version's vehicle overlay modal behavior
  - UI terminology: "Филиал" instead of "fleet"

### Map Screen
- **`MapScreen.kt`** — Main map view with bottom sheet controls
  - Uses `DeviceSelectorCard` button to trigger `DeviceSelectionSheet`
  - Track mode buttons (Mileage/Raw) disabled until device selected
  - Date/time pickers for range selection
  - Load button triggers data fetch via ViewModel
  - Default center: Ukraine (lat 48.4, lon 31.2, zoom 6)

### WebSocket Endpoints
- **Device list:** Uses "Vehicle Show" (mid=2)
  - Requires TWO requests: init (for fleet mappings) then setup (for device data)
  - Init response `cols` contains fleet key-value mappings
  - Setup response `f` contains device data: id, number (name), fleet, imei
  - Fleet names resolved from init response's cols[fleet].k array

- **Mileage Report:** (mid=2, type=map, act=filter)
  - Uses `selectedvihicleid` (note the typo - protocol requirement)
  - Response `f` array contains segments with: coordinates, fdate, period, ismoved, dest
  - NO `tdate` field - must calculate: endTime = fdate + period
  - Coordinates format: `[[lat, lon], [lat, lon], ...]`
  - `dest` is distance in METERS (integer)

- **Vehicle Track:** (mid=2, type=map, act=filter)
  - Fields: latitude, longitude, wdate, speed, status
  
- **Startstop accumulation:** (mid=5, type=etbl, act=filter)
  - Used for total mileage calculation
  - `dest` is distance in KILOMETERS as STRING (e.g., "72.87")
  - Sum all `dest` where `stopnum == 0` for total km

### Anomaly Detection (Fully Implemented)

Location: `util/AnomalyDetector.kt`

**Functions:**
- `detectAnomalies(points: List<TrackPoint>)` — For Vehicle Track (10 min gap, 200 km/h speed)
- `detectRawTrackAnomalies(points: List<TrackPoint>)` — For Raw Track (5 min gap, 150 km/h speed)

**Anomaly Types:**
| Type | Color | Style | Threshold |
|------|-------|-------|-----------|
| Time Gap | Red (#ff4136) | Dashed (8,6) | 30 min (raw), 10 min (vehicle) |
| Speed Spike | Yellow (#ffdc00) | Dashed (6,4) | 150 km/h (raw), 200 km/h (vehicle) |
| Position Jump | Red (#ff4136) | Dashed (10,5) | 800m distance |
| Out of Bounds | Purple (#800080) | Solid | Outside Ukraine bounds |

**UI Components:**
- `AnomalyPanel.kt` — Collapsible bottom panel showing anomaly list with clickable filter badges
- Filter badges show count by type (e.g., 🔴154 Time Gap, 🟡11 Speed Spike)
- Click badge → toggles filter (greyed out when inactive)
- Click on anomaly → map pans to location with persistent marker and info popup
- Click on marker → toggles popup visibility
- Click on map → removes anomaly marker completely
- **Only shown in Raw Track mode** (not in Mileage mode)

### Direction Arrows (Fully Implemented)

Location: `ui/screen/map/components/DirectionArrow.kt`

Matches web version's Leaflet polylineDecorator behavior:
- **Offset:** 25 pixels from start
- **Repeat:** Every 50 pixels along polyline
- **Size:** 8 pixels (fixed, zoom-independent)
- **Color:** Black filled triangle
- Arrows do NOT appear on gap/anomaly polylines
- Recalculates on map pan/zoom

### Stop Visibility Toggle (Fully Implemented)

- Toggle button (eye icon) shows/hides stops on map
- Only displays stops with duration ≥ 5 minutes (matching web's `totalMin <= 5` threshold)
- Constant: `STOP_MIN_DURATION_MINUTES = 5` in `Constants.kt`
- Short stops (< 5 min) are filtered out when loading mileage

### Settings Screen (Fully Implemented)

Location: `ui/screen/settings/SettingsScreen.kt`

Features:
- **Change User** button - clears session and navigates to login
- **Track Line Thickness** - slider 2-12px (default 6)
- **Stop Marker Size** - slider 16-48px (default 24)
- **Arrow Thickness** - slider 2-16px (default 8)
- **Language Selection** - Ukrainian (default) or Russian

Settings stored in DataStore (`data/settings/AppSettings.kt`):
```kotlin
object SettingsKeys {
    val TRACK_LINE_WIDTH = floatPreferencesKey("track_line_width")
    val STOP_MARKER_SIZE = intPreferencesKey("stop_marker_size")
    val ARROW_SIZE = intPreferencesKey("arrow_size")
    val APP_LANGUAGE = stringPreferencesKey("app_language") // "uk" or "ru"
}
```

### Date/Time Defaults

- Default selection: TODAY, 00:00 to 23:59
- When "From" date changes → time set to 00:00
- When "To" date changes → time set to 23:59

## Updates Log

- 2026-01-13: Initial plan created, WebSocket protocol documented
- 2026-01-13: Project builds successfully, all core features implemented
- 2026-01-13: Implemented DeviceSelectionSheet modal with search/filter, replaced dropdown device selector
- 2026-01-13: Fixed device loading to use "Vehicle Show" endpoint for full device data
- 2026-01-13: Changed UI terminology from "Флот" to "Филиал"
- 2026-01-13: Fixed double drag handle issue in MapScreen
- 2026-01-13: Centered map on Ukraine at startup
- 2026-01-13: Added debug logging to track parsing for troubleshooting
- 2026-01-13: Fixed fleet loading - now properly waits for init response before setup
- 2026-01-13: Fixed Mileage parsing - removed tdate dependency, calculate from fdate+period
- 2026-01-13: Added mileage total display using Startstop accumulation endpoint
- 2026-01-13: Implemented AnomalyDetector integration with UI panel and map visualization
- 2026-01-13: Implemented direction arrows matching web version (pixel-based, zoom-independent)
- 2026-01-13: Added stop visibility toggle (only shows stops ≥5 minutes)
- 2026-01-13: Added Settings screen with logout, track line width (2-12), stop marker size (16-48)
- 2026-01-13: Set default date/time to today 00:00-23:59, auto-adjust time on date change
- 2026-01-13: Fixed NullPointerException crash in OsmMapController.cleanup()
- 2026-01-13: Anomalies now only shown in Raw Track mode (not in Mileage)
- 2026-01-13: Improved anomaly marker behavior - persistent marker with toggle popup
- 2026-01-13: Removed geolocation center button from map
- 2026-01-13: Fixed all NullPointerException issues in OsmMapController with null-safe operators
- 2026-01-13: Added map click handler to remove anomaly marker on map tap
- 2026-01-13: Verified Time Gap threshold matches web version (5 minutes)
- 2026-01-13: Implemented clickable anomaly type filter badges with visual feedback
- 2026-01-13: Fixed app freeze on settings navigation with slide animation transitions
- 2026-01-13: Added arrow thickness setting (2-16px, default 8)
- 2026-01-13: Changed Time Gap threshold to 30 minutes
- 2026-01-13: Swapped marker sizes (stops smaller, start/stop larger)
- 2026-01-13: Implemented multi-language support (Ukrainian default, Russian)
- 2026-01-13: Created string resources for all UI text except "Mileage" and "Raw Track" buttons
- 2026-01-13: Fixed app freeze on settings exit with proper arrow update cancellation
- 2026-01-13: Fixed language change to trigger activity recreation
- 2026-01-13: Fixed start/stop marker sizes (now 24px custom circles)
- 2026-01-13: Added red gap line visualization between mileage segments (gaps >10m)
- 2026-01-13: Fixed app freeze on settings exit when track loaded (smart change detection in OsmMapView)
- 2026-01-13: Fixed direction arrows performance at high zoom (max 300/polyline, 500 total, min 20m distance, background calc)
- 2026-01-13: Complete localization fix - all UI strings now Ukrainian (default) with Russian translations
- 2026-01-13: Fixed zoom buttons hidden behind anomalies panel (dynamic bottom padding)
- 2026-01-13: Removed server connection option from settings
- 2026-01-13: Fixed settings page scroll (added verticalScroll modifier)

### Known Performance Considerations

**Direction Arrows:**
- Maximum 300 arrows per polyline, 500 total across all polylines
- Minimum geographic distance between arrows: 20 meters
- Debounce delay: 250ms to prevent recalculation spam during zoom gestures
- Arrow calculation runs on background thread (Dispatchers.Default)

**Settings Navigation:**
- Smart change detection prevents full map redraw when only visual settings change
- Track data changes trigger full redraw, settings-only changes trigger light update
- Map position preserved when returning from settings

- 2026-01-13: Added anomaly grouping - consecutive anomalies of same type grouped into one entry with count
- 2026-01-13: Fixed arrows disappearing at high zoom - now filters to visible viewport only
- 2026-01-13: Increased arrow limits (1000/polyline, 2000 total) with viewport filtering for efficiency
- 2026-01-13: Added device model (type) and phone number to Device model and UI
- 2026-01-13: Added Call and SMS buttons to device cards with model-specific SMS text
- 2026-01-13: Removed old OSMdroid built-in zoom controls (using custom buttons now)

### SMS Text by Device Model

| Model | SMS Text |
|-------|----------|
| 130 | unit 130 getinfo |
| 400 | status |
| 500, 500v2, 500v3, etc. | 1111 status |
