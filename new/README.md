# SCMV v2

 овый интерфейс мониторинга автопарка поверх протокола SCMV v2.
Полная переработка UI: тёмная тема, панель управления справа, проигрыватель трека, график скорости, админ-панель в едином дизайне.

> Проект является отдельной веткой развития SCMV v2 (`D:\Dev\Projects\scmv\SCMV v2`) — исходный v2 не изменяется.

## Состав

| Файл | Назначение |
|------|------------|
| `index.html` | Дашборд пользователя: выбор ТС, период, пробег, стоянки, фильтр по филиалам, ресайз карты |
| `admin.html` | Админ-панель: **Мониторинг** (полный функционал дашборда, включая Device Log/Alarm, Полный трек, Анализ и буферы копирования), справочники ТС/устройств, редактирование, Device Status, аудит, отчёты, cleanup аномалий, мастер добавления пары «устройство + ТС» |
| `login.html` | Вход (те же ключи localStorage, что и в v2: `dt_user`, `dt_pwd`, `dt_session`, `dt_remember`) |
| `js/core/` | Общие модули: config, auth, ws (диспетчер пакетов), utils, map-core, components |
| `js/app/` | Модули дашборда + общий шаблон (`dashboard-template.js`) и инициализатор (`bootstrap.js`) |
| `js/admin/` | Модули админ-панели |
| `tools/` | Верификация: mock WS-сервер (capture-ответы из v2), smoke-тесты через Chrome CDP (дашборд и админка) |

## Запуск

```bash
cd "D:\Dev\Projects\scmv\SCMV v2\web\new"
python -m http.server 8000
# открыть http://localhost:8000
```

WS-сервер по умолчанию `wss://scmv.vpngps.com:4445` (переопределяется `localStorage.scmv_ws_url`).

## Локальная верификация без реального бэкенда

```bash
node tools/mock-server.js          # mock WS на :44451 (отдаёт capture из ../examples)
node tools/smoke-cdp.js            # static :8123 + mock :44451 + headless Chrome (CDP): сценарий дашборда, скриншоты в tools/shots/
node tools/check-syntax.js         # node --check по всем js/
```

## Стек

Tailwind CSS v3 (локальная сборка `vendor/tailwind/app.css`), FontAwesome 6.4.0, Leaflet 1.9.4 + leaflet-polylinedecorator 1.6.0, Chart.js 4.4.7, SheetJS (XLSX) 0.18.5 — всё локально в `vendor/`. Современный ES6+ (модули, без бандлера).
