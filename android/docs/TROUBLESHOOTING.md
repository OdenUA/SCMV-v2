# Решение проблем с подключением

## Проблема 1: NO_INPUT_CHANNEL в эмуляторе

### Что исправлено:
- Удалён вызов `enableEdgeToEdge()` который вызывал проблемы с input на некоторых эмуляторах
- Добавлено детальное логирование в MainActivity

### Как проверить:
1. Переустановите APK в эмуляторе
2. Проверьте logcat на наличие сообщения "MainActivity onCreate called"
3. Если проблема осталась:
   ```bash
   adb logcat -s MainActivity WsClient
   ```

---

## Проблема 2: 502 Bad Gateway на реальном устройстве

### Диагностика:

Ошибка **502 Bad Gateway** означает, что WebSocket клиент достигает прокси/nginx сервера, но сервер не может подключиться к бэкенду.

### Возможные причины:

#### 1. **Сервер выключен или перезагружается**
Проверка:
```bash
# Windows PowerShell
Test-NetConnection -ComputerName scmv.vpngps.com -Port 4445

# Linux/Mac
nc -zv scmv.vpngps.com 4445
```

Если порт закрыт → сервер не работает, нужно его запустить.

#### 2. **Проблема с SSL сертификатом**
Текущая конфигурация приложения **уже принимает самоподписанные сертификаты** (см. `AppModule.kt`).

Но если сервер возвращает 502, возможно:
- Сертификат настроен неправильно на nginx
- Бэкенд WebSocket сервер не запущен
- Nginx не может проксировать к WebSocket серверу

#### 3. **Nginx/Прокси конфигурация**
Проверьте nginx конфиг для WebSocket:
```nginx
location / {
    proxy_pass http://localhost:BACKEND_PORT;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 86400;
}
```

#### 4. **Бэкенд WebSocket сервер не запущен**
Проверьте логи бэкенд сервера:
```bash
# Если это Node.js сервер
pm2 logs scmv-backend

# Или проверьте процессы
ps aux | grep node
```

### Временное решение: использовать ws:// вместо wss://

#### Метод 1: Изменить Constants.kt
```kotlin
// d:\scmv\SCMV v2\android\app\src\main\kotlin\com\scmv\android\util\Constants.kt
object Constants {
    const val WS_URL = "ws://scmv.vpngps.com:4445"  // БЕЗ SSL
    const val WS_URL_FALLBACK = "wss://scmv.vpngps.com:4445"
    // ...
}
```

Затем пересобрать:
```powershell
cd "d:\scmv\SCMV v2\android"
.\gradlew.bat assembleDebug
```

#### Метод 2: Использовать прямой IP (если известен)
```kotlin
const val WS_URL = "ws://YOUR_SERVER_IP:4445"
```

#### Метод 3: Использовать локальную сеть (для разработки)
Если сервер на локальной машине:
```kotlin
const val WS_URL = "ws://192.168.x.x:4445"  // IP вашего компьютера в локальной сети
```

### Улучшенная диагностика в приложении

После текущего обновления, приложение покажет детальную ошибку на русском языке:

```
Сервер недоступен (502 Bad Gateway).

Возможные причины:
1. Сервер scmv.vpngps.com выключен или перезагружается
2. Порт 4445 закрыт firewall
3. Nginx/прокси сервер не может подключиться к бэкенду
4. SSL сертификат настроен неправильно

Попробуйте:
• Проверить работу сервера через браузер
• Использовать ws:// вместо wss:// (без SSL)
• Обратиться к администратору сервера
```

Эта информация будет видна в:
1. Logcat: `adb logcat -s WsClient`
2. UI приложения (ConnectionStatusChip на экране логина)
3. Новый экран Settings (в разработке)

---

## Проверка подключения с компьютера

### 1. Проверить доступность порта
```powershell
Test-NetConnection -ComputerName scmv.vpngps.com -Port 4445
```

Должно вернуть `TcpTestSucceeded : True`

### 2. Проверить WebSocket через браузер
Откройте `web/test_ws.html` в браузере и проверьте подключение.

### 3. Проверить через Node.js WebSocket клиент
```javascript
const WebSocket = require('ws');
const ws = new WebSocket('wss://scmv.vpngps.com:4445');

ws.on('open', () => console.log('Connected!'));
ws.on('error', (err) => console.error('Error:', err));
ws.on('close', (code, reason) => console.log('Closed:', code, reason));
```

---

## Следующие шаги

### Если сервер работает, но приложение всё равно не подключается:

1. **Соберите логи с устройства:**
   ```bash
   adb logcat -s WsClient:V MainActivity:V *:E > app_logs.txt
   ```

2. **Попробуйте ws:// вместо wss://**
   Измените Constants.kt как описано выше

3. **Проверьте firewall на сервере:**
   ```bash
   # На сервере
   sudo ufw status
   sudo ufw allow 4445/tcp
   ```

4. **Проверьте бэкенд логи:**
   Посмотрите что происходит на стороне сервера когда приложение пытается подключиться

### Если нужна помощь с сервером:

Отправьте администратору сервера:
- Время попытки подключения (точное время с секундами)
- Версию приложения
- Логи из `adb logcat`
- Результат `Test-NetConnection`

---

## Финальная проверка

После сборки установите APK:
```bash
adb install -r "d:\scmv\SCMV v2\android\app\build\outputs\apk\debug\app-debug.apk"
```

Запустите логирование:
```bash
adb logcat -s WsClient:V MainActivity:V
```

Запустите приложение и следите за логами.
