# SCMV Android — План разработки

## Обзор проекта

**Цель:** Android-приложение для просмотра и анализа GPS-треков устройств, аналог веб-версии SCMV v2.

**Технологии:**
- Kotlin
- Jetpack Compose (UI)
- Min SDK: 24 (Android 7.0)
- OkHttp (WebSocket)
- OSMdroid (OpenStreetMap карты)
- Kotlin Coroutines + Flow (async)
- Hilt (DI)
- DataStore (хранение сессии)

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│  │  Login  │ │   Map   │ │ Devices │ │  Logs   │            │
│  │ Screen  │ │ Screen  │ │  List   │ │ Screen  │            │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘            │
│       │           │           │           │                  │
│  ┌────┴───────────┴───────────┴───────────┴────┐            │
│  │              ViewModels                      │            │
│  │  (LoginVM, MapVM, DevicesVM, LogsVM)        │            │
│  └─────────────────────┬───────────────────────┘            │
└────────────────────────┼────────────────────────────────────┘
                         │
┌────────────────────────┼────────────────────────────────────┐
│                  Domain Layer                                │
│  ┌─────────────────────┴───────────────────────┐            │
│  │              Use Cases                       │            │
│  │  (GetTracks, GetMileage, DetectAnomalies)   │            │
│  └─────────────────────┬───────────────────────┘            │
└────────────────────────┼────────────────────────────────────┘
                         │
┌────────────────────────┼────────────────────────────────────┐
│                   Data Layer                                 │
│  ┌─────────────────────┴───────────────────────┐            │
│  │           Repository                         │            │
│  └─────────────────────┬───────────────────────┘            │
│                        │                                     │
│  ┌─────────────────────┴───────────────────────┐            │
│  │        WebSocket Client (OkHttp)            │            │
│  │        Session Storage (DataStore)          │            │
│  └─────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

---

## Структура проекта

```
scmv-android/
├── app/
│   ├── src/main/
│   │   ├── kotlin/com/scmv/android/
│   │   │   ├── ScmvApp.kt                    # Application class
│   │   │   ├── MainActivity.kt               # Single Activity
│   │   │   │
│   │   │   ├── data/
│   │   │   │   ├── remote/
│   │   │   │   │   ├── WebSocketClient.kt    # WebSocket управление
│   │   │   │   │   ├── WebSocketMessage.kt   # Модели сообщений
│   │   │   │   │   └── MessageHandler.kt     # Роутинг ответов
│   │   │   │   ├── repository/
│   │   │   │   │   ├── AuthRepository.kt     # Авторизация
│   │   │   │   │   ├── DeviceRepository.kt   # Устройства
│   │   │   │   │   ├── TrackRepository.kt    # Треки
│   │   │   │   │   └── MileageRepository.kt  # Пробеги
│   │   │   │   └── session/
│   │   │   │       └── SessionManager.kt     # DataStore сессия
│   │   │   │
│   │   │   ├── domain/
│   │   │   │   ├── model/
│   │   │   │   │   ├── Device.kt
│   │   │   │   │   ├── TrackPoint.kt
│   │   │   │   │   ├── MileageSegment.kt
│   │   │   │   │   ├── Anomaly.kt
│   │   │   │   │   └── User.kt
│   │   │   │   └── usecase/
│   │   │   │       ├── LoginUseCase.kt
│   │   │   │       ├── GetDevicesUseCase.kt
│   │   │   │       ├── GetTrackUseCase.kt
│   │   │   │       ├── GetMileageUseCase.kt
│   │   │   │       └── DetectAnomaliesUseCase.kt
│   │   │   │
│   │   │   ├── ui/
│   │   │   │   ├── navigation/
│   │   │   │   │   └── NavGraph.kt           # Navigation Compose
│   │   │   │   ├── theme/
│   │   │   │   │   ├── Theme.kt
│   │   │   │   │   ├── Color.kt
│   │   │   │   │   └── Type.kt
│   │   │   │   ├── components/
│   │   │   │   │   ├── MapView.kt            # OSM карта
│   │   │   │   │   ├── TrackOverlay.kt       # Треки на карте
│   │   │   │   │   ├── DeviceCard.kt
│   │   │   │   │   ├── DateRangePicker.kt
│   │   │   │   │   ├── SearchBar.kt
│   │   │   │   │   └── LoadingIndicator.kt
│   │   │   │   ├── screen/
│   │   │   │   │   ├── login/
│   │   │   │   │   │   ├── LoginScreen.kt
│   │   │   │   │   │   └── LoginViewModel.kt
│   │   │   │   │   ├── map/
│   │   │   │   │   │   ├── MapScreen.kt
│   │   │   │   │   │   └── MapViewModel.kt
│   │   │   │   │   ├── devices/
│   │   │   │   │   │   ├── DevicesScreen.kt
│   │   │   │   │   │   └── DevicesViewModel.kt
│   │   │   │   │   └── logs/
│   │   │   │   │       ├── LogsScreen.kt
│   │   │   │   │       └── LogsViewModel.kt
│   │   │   │   └── state/
│   │   │   │       └── UiState.kt            # Общие состояния UI
│   │   │   │
│   │   │   ├── util/
│   │   │   │   ├── DateUtils.kt
│   │   │   │   ├── AnomalyDetector.kt        # Детектор аномалий
│   │   │   │   ├── SqlGenerator.kt           # Генерация SQL
│   │   │   │   └── Constants.kt              # Пороги, границы
│   │   │   │
│   │   │   └── di/
│   │   │       ├── AppModule.kt
│   │   │       ├── NetworkModule.kt
│   │   │       └── RepositoryModule.kt
│   │   │
│   │   ├── res/
│   │   │   ├── values/
│   │   │   │   ├── strings.xml
│   │   │   │   └── themes.xml
│   │   │   └── drawable/
│   │   │
│   │   └── AndroidManifest.xml
│   │
│   └── build.gradle.kts
│
├── gradle/
│   └── libs.versions.toml                    # Version catalog
├── settings.gradle.kts
├── build.gradle.kts
└── docs/
    ├── DEVELOPMENT_PLAN.md                   # Этот файл
    ├── WEBSOCKET_PROTOCOL.md                 # Спецификация протокола
    └── agent.md                              # Инструкции для AI
```

---

## Этапы разработки

### Этап 1: Инфраструктура (3-4 дня)
**Приоритет: Критический**

| Задача | Описание | Файлы |
|--------|----------|-------|
| 1.1 | Создать проект Android с Compose | build.gradle.kts, settings.gradle.kts |
| 1.2 | Настроить Hilt DI | di/*.kt, ScmvApp.kt |
| 1.3 | Создать WebSocket клиент | data/remote/WebSocketClient.kt |
| 1.4 | Реализовать SessionManager | data/session/SessionManager.kt |
| 1.5 | Настроить навигацию | ui/navigation/NavGraph.kt |
| 1.6 | Создать тему приложения | ui/theme/*.kt |

**Критерий завершения:** Приложение запускается, WebSocket подключается к серверу.

---

### Этап 2: Авторизация (2 дня)
**Приоритет: Критический**

| Задача | Описание | Файлы |
|--------|----------|-------|
| 2.1 | Создать модели User, Session | domain/model/User.kt |
| 2.2 | Реализовать AuthRepository | data/repository/AuthRepository.kt |
| 2.3 | Создать LoginUseCase | domain/usecase/LoginUseCase.kt |
| 2.4 | Создать LoginScreen + ViewModel | ui/screen/login/*.kt |
| 2.5 | Реализовать "Запомнить меня" | SessionManager.kt |
| 2.6 | Автологин при запуске | MainActivity.kt |

**Критерий завершения:** Можно залогиниться, сессия сохраняется при "Запомнить меня".

---

### Этап 3: Список устройств и поиск (2-3 дня)
**Приоритет: 1**

| Задача | Описание | Файлы |
|--------|----------|-------|
| 3.1 | Создать модель Device | domain/model/Device.kt |
| 3.2 | Реализовать DeviceRepository | data/repository/DeviceRepository.kt |
| 3.3 | Создать GetDevicesUseCase | domain/usecase/GetDevicesUseCase.kt |
| 3.4 | Создать DevicesScreen | ui/screen/devices/DevicesScreen.kt |
| 3.5 | Реализовать поиск (по имени, IMEI, флоту) | DevicesScreen.kt, SearchBar.kt |
| 3.6 | Фильтрация по флотам | DevicesScreen.kt |

**Критерий завершения:** Список устройств загружается, работает поиск и фильтрация.

---

### Этап 4: Карта и базовое отображение треков (3-4 дня)
**Приоритет: 1**

| Задача | Описание | Файлы |
|--------|----------|-------|
| 4.1 | Интегрировать OSMdroid | ui/components/MapView.kt |
| 4.2 | Создать модели TrackPoint, MileageSegment | domain/model/*.kt |
| 4.3 | Реализовать TrackRepository | data/repository/TrackRepository.kt |
| 4.4 | Создать GetTrackUseCase | domain/usecase/GetTrackUseCase.kt |
| 4.5 | Создать MapScreen + ViewModel | ui/screen/map/*.kt |
| 4.6 | Отображение Mileage треков на карте | ui/components/TrackOverlay.kt |
| 4.7 | Выбор даты и устройства | DateRangePicker.kt |
| 4.8 | Цветовая дифференциация (движение/стоянка) | TrackOverlay.kt |

**Критерий завершения:** Mileage треки отображаются на карте с цветами.

---

### Этап 5: Track Raw (сырые данные) (2 дня)
**Приоритет: 1**

| Задача | Описание | Файлы |
|--------|----------|-------|
| 5.1 | Расширить TrackRepository для Raw | TrackRepository.kt |
| 5.2 | Переключатель Mileage/Raw в UI | MapScreen.kt |
| 5.3 | Отображение Raw треков | TrackOverlay.kt |
| 5.4 | Popup с информацией о точке | MapScreen.kt |

**Критерий завершения:** Можно переключаться между Mileage и Raw треками.

---

### Этап 6: Mileage отчёты (2 дня)
**Приоритет: 1**

| Задача | Описание | Файлы |
|--------|----------|-------|
| 6.1 | Создать MileageRepository | data/repository/MileageRepository.kt |
| 6.2 | Создать GetMileageUseCase | domain/usecase/GetMileageUseCase.kt |
| 6.3 | Табличное представление сегментов | MapScreen.kt (BottomSheet) |
| 6.4 | Навигация к сегменту на карте | MapScreen.kt |

**Критерий завершения:** Mileage отчёт отображается, клик по записи центрирует карту.

---

### Этап 7: Детектор аномалий (2-3 дня)
**Приоритет: 2**

| Задача | Описание | Файлы |
|--------|----------|-------|
| 7.1 | Создать модель Anomaly | domain/model/Anomaly.kt |
| 7.2 | Портировать константы | util/Constants.kt |
| 7.3 | Реализовать AnomalyDetector | util/AnomalyDetector.kt |
| 7.4 | Создать DetectAnomaliesUseCase | domain/usecase/DetectAnomaliesUseCase.kt |
| 7.5 | Визуализация аномалий на карте | TrackOverlay.kt |
| 7.6 | Список аномалий (BottomSheet) | MapScreen.kt |

**Типы аномалий:**
- Time Gap (> 10 мин)
- Speed Spike (> 200 км/ч)
- Position Jump (> 800 м при низкой скорости)
- Out of Bounds (за пределами Украины)

**Критерий завершения:** Аномалии детектируются и отображаются на карте.

---

### Этап 8: Генерация SQL (1 день)
**Приоритет: 2**

| Задача | Описание | Файлы |
|--------|----------|-------|
| 8.1 | Реализовать SqlGenerator | util/SqlGenerator.kt |
| 8.2 | UI для генерации и копирования SQL | MapScreen.kt |
| 8.3 | Поддержка интервалов Type 4 | SqlGenerator.kt |

**Критерий завершения:** SQL генерируется и копируется в буфер.

---

### Этап 9: Логи устройств (2 дня)
**Приоритет: 3**

| Задача | Описание | Файлы |
|--------|----------|-------|
| 9.1 | Расширить DeviceRepository для логов | DeviceRepository.kt |
| 9.2 | Создать LogsScreen + ViewModel | ui/screen/logs/*.kt |
| 9.3 | Анализатор логов (парсинг, категоризация) | LogsScreen.kt |
| 9.4 | Фильтрация и поиск в логах | LogsScreen.kt |

**Критерий завершения:** Логи устройства отображаются с возможностью поиска.

---

### Этап 10: Полировка UI/UX (2-3 дня)
**Приоритет: Важный**

| Задача | Описание |
|--------|----------|
| 10.1 | Оптимизация для мобильных экранов |
| 10.2 | Жесты на карте (zoom, pan) |
| 10.3 | Pull-to-refresh |
| 10.4 | Обработка ошибок сети |
| 10.5 | Индикаторы загрузки |
| 10.6 | Тёмная тема |

---

## Временная оценка

| Этап | Дней | Статус |
|------|------|--------|
| 1. Инфраструктура | 3-4 | ⬜ |
| 2. Авторизация | 2 | ⬜ |
| 3. Список устройств | 2-3 | ⬜ |
| 4. Карта + Mileage | 3-4 | ⬜ |
| 5. Track Raw | 2 | ⬜ |
| 6. Mileage отчёты | 2 | ⬜ |
| 7. Аномалии | 2-3 | ⬜ |
| 8. SQL генератор | 1 | ⬜ |
| 9. Логи | 2 | ⬜ |
| 10. UI/UX | 2-3 | ⬜ |
| **Итого** | **21-26** | |

---

## Зависимости (libs.versions.toml)

```toml
[versions]
kotlin = "1.9.22"
compose-bom = "2024.02.00"
hilt = "2.50"
okhttp = "4.12.0"
osmdroid = "6.1.18"
datastore = "1.0.0"
navigation = "2.7.7"
lifecycle = "2.7.0"
coroutines = "1.8.0"
serialization = "1.6.2"

[libraries]
# Compose
compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "compose-bom" }
compose-ui = { group = "androidx.compose.ui", name = "ui" }
compose-material3 = { group = "androidx.compose.material3", name = "material3" }
compose-navigation = { group = "androidx.navigation", name = "navigation-compose", version.ref = "navigation" }

# Hilt
hilt-android = { group = "com.google.dagger", name = "hilt-android", version.ref = "hilt" }
hilt-compiler = { group = "com.google.dagger", name = "hilt-android-compiler", version.ref = "hilt" }
hilt-navigation = { group = "androidx.hilt", name = "hilt-navigation-compose", version = "1.1.0" }

# Network
okhttp = { group = "com.squareup.okhttp3", name = "okhttp", version.ref = "okhttp" }
okhttp-logging = { group = "com.squareup.okhttp3", name = "logging-interceptor", version.ref = "okhttp" }

# Map
osmdroid = { group = "org.osmdroid", name = "osmdroid-android", version.ref = "osmdroid" }

# Storage
datastore = { group = "androidx.datastore", name = "datastore-preferences", version.ref = "datastore" }

# Serialization
kotlinx-serialization = { group = "org.jetbrains.kotlinx", name = "kotlinx-serialization-json", version.ref = "serialization" }

# Lifecycle
lifecycle-viewmodel = { group = "androidx.lifecycle", name = "lifecycle-viewmodel-compose", version.ref = "lifecycle" }
lifecycle-runtime = { group = "androidx.lifecycle", name = "lifecycle-runtime-compose", version.ref = "lifecycle" }

# Coroutines
coroutines-android = { group = "org.jetbrains.kotlinx", name = "kotlinx-coroutines-android", version.ref = "coroutines" }

[plugins]
android-application = { id = "com.android.application", version = "8.2.2" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
hilt = { id = "com.google.dagger.hilt.android", version.ref = "hilt" }
```

---

## WebSocket протокол

См. [WEBSOCKET_PROTOCOL.md](./WEBSOCKET_PROTOCOL.md) для полной спецификации.

**Основные запросы:**
- `login` — авторизация
- `Vehicle Select Min` — список устройств
- `Mileage Report` — сегменты пробега
- `Vehicle Track` — GPS-точки
- `Device Track` — сырой трек (Raw)
- `Device Log` — логи устройства

---

## Рекомендации по разработке

### 1. WebSocket управление
- Использовать StateFlow для состояния подключения
- Автореконнект с экспоненциальной задержкой
- Обработка потери соединения (показ UI-индикатора)

### 2. Карта (OSMdroid)
- Кэширование тайлов на устройстве
- Кластеризация маркеров при большом количестве точек
- Фоновая загрузка тайлов

### 3. Большие треки
- Пагинация/упрощение при > 5000 точек
- Индикатор прогресса загрузки
- Фоновая обработка аномалий

### 4. Удобство мобильного UI
- Bottom Sheet для таблиц и списков
- Swipe-жесты для навигации
- Крупные touch-области (min 48dp)
- Landscape поддержка для карты

---

## Следующий шаг

Начать с **Этапа 1: Инфраструктура** — создание проекта и базовой настройки.

Команда для старта:
```bash
cd "d:\scmv\SCMV v2"
# Android Studio → New Project → Empty Compose Activity
```
