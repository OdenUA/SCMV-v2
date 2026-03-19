const wsUrl = (function resolveWsUrl() {
    if (window.location && /^https?:$/i.test(window.location.protocol) && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)) {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return proto + '//' + window.location.host + '/ws';
    }
    return 'wss://scmv.vpngps.com:4445';
})();

const statusDiv = document.getElementById('status');
const wsUrlLabel = document.getElementById('wsUrlLabel');
const sessionUidLabel = document.getElementById('sessionUidLabel');
const lastPacketLabel = document.getElementById('lastPacketLabel');
const authSummary = document.getElementById('authSummary');
const responsePayloadPre = document.getElementById('responsePayload');
const copyResponseBtn = document.getElementById('copyResponseBtn');
const dateFromInput = document.getElementById('dateFrom');
const dateToInput = document.getElementById('dateTo');
const vehicleIdInput = document.getElementById('vehicleId');
const loginUserInput = document.getElementById('loginUserInput');
const loginPasswordInput = document.getElementById('loginPasswordInput');
const authUidInput = document.getElementById('authUidInput');
const sendLoginBtn = document.getElementById('sendLoginBtn');
const clearSessionBtn = document.getElementById('clearSessionBtn');
const fillLoginPresetBtn = document.getElementById('fillLoginPresetBtn');
const sendVehicleSelectMinBtn = document.getElementById('sendVehicleSelectMin');
const sendVehicleShowBtn = document.getElementById('sendVehicleShow');
const sendMileageReportBtn = document.getElementById('sendMileageReport');
const sendDeviceTrackBtn = document.getElementById('sendDeviceTrack');
const rawRequestInput = document.getElementById('rawRequestInput');
const rawRequestSendBtn = document.getElementById('rawRequestSend');
const rawRequestClearBtn = document.getElementById('rawRequestClear');
const rawResponseLog = document.getElementById('rawResponseLog');
const presetDesktopBtn = document.getElementById('presetDesktopBtn');
const presetSelectMinBtn = document.getElementById('presetSelectMinBtn');
const presetDeviceTrackBtn = document.getElementById('presetDeviceTrackBtn');

let socket = null;
let map = null;
let featureGroup = null;
let reconnectTimer = null;
let authState = {
    user: loginUserInput ? loginUserInput.value.trim() : '',
    password: loginPasswordInput ? loginPasswordInput.value : '',
    uid: null,
    loggedIn: false,
    loginInProgress: false,
    lastPacket: '-'
};

function setStatus(text, kind) {
    if (!statusDiv) return;
    statusDiv.textContent = text;
    statusDiv.classList.remove('is-pending', 'is-ok', 'is-bad');
    statusDiv.classList.add(kind || 'is-pending');
}

function syncAuthInputs() {
    authState.user = loginUserInput ? loginUserInput.value.trim() : authState.user;
    authState.password = loginPasswordInput ? loginPasswordInput.value : authState.password;
}

function updateSessionUi() {
    if (wsUrlLabel) wsUrlLabel.textContent = wsUrl;
    if (sessionUidLabel) sessionUidLabel.textContent = authState.uid != null ? String(authState.uid) : '-';
    if (lastPacketLabel) lastPacketLabel.textContent = authState.lastPacket || '-';
    if (authUidInput) authUidInput.value = authState.uid != null ? String(authState.uid) : '';
    if (authSummary) {
        if (authState.loggedIn) {
            authSummary.textContent = 'Авторизовано: ' + authState.user + ' / uid=' + authState.uid;
        } else if (authState.loginInProgress) {
            authSummary.textContent = 'Выполняется login...';
        } else {
            authSummary.textContent = 'Сессия не авторизована.';
        }
    }
}

function appendRawLog(text, direction) {
    if (!rawResponseLog) return;
    const ts = new Date().toISOString().slice(11, 19);
    const line = document.createElement('div');
    line.textContent = '[' + ts + '] ' + text;
    line.style.padding = '2px 0';
    line.style.color = direction === 'out' ? '#6ee7b7' : (direction === 'warn' ? '#fbbf24' : '#93c5fd');
    rawResponseLog.appendChild(line);
    rawResponseLog.scrollTop = rawResponseLog.scrollHeight;
}

function buildLoginRequest() {
    syncAuthInputs();
    return {
        name: 'login',
        type: 'login',
        mid: 0,
        act: 'setup',
        usr: authState.user,
        pwd: authState.password,
        uid: 0,
        lang: 'en'
    };
}

function getDateRange() {
    return {
        dateTo: new Date(dateToInput.value).toISOString(),
        dateFrom: new Date(dateFromInput.value).toISOString()
    };
}

function resolveAuth() {
    syncAuthInputs();
    return {
        usr: authState.user,
        pwd: authState.password,
        uid: authState.uid
    };
}

function ensureLoggedInOrWarn() {
    const auth = resolveAuth();
    if (!auth.usr || !auth.pwd) {
        alert('Укажите логин и пароль.');
        return null;
    }
    if (!authState.loggedIn || auth.uid == null) {
        alert('Сначала выполните login в текущем WebSocket-соединении.');
        return null;
    }
    return auth;
}

function ensureSocketOpen() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert('WebSocket не подключен.');
        return false;
    }
    return true;
}

function sendRequest(requestObject) {
    if (!ensureSocketOpen()) return false;
    const payload = JSON.stringify(requestObject);
    socket.send(payload);
    appendRawLog('➡ ' + payload, 'out');
    setStatus('Запрос отправлен. Ожидание ответа...', 'is-pending');
    if (responsePayloadPre) responsePayloadPre.textContent = '{}';
    return true;
}

async function copyLatestResponse() {
    const text = responsePayloadPre ? String(responsePayloadPre.textContent || '').trim() : '';
    if (!text) {
        appendRawLog('⚠ Нет ответа для копирования', 'warn');
        return;
    }

    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
        } else {
            const range = document.createRange();
            range.selectNodeContents(responsePayloadPre);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('copy');
            selection.removeAllRanges();
        }
        appendRawLog('📋 Последний ответ скопирован в буфер', 'out');
        setStatus('Последний ответ скопирован.', 'is-ok');
    } catch (error) {
        appendRawLog('⚠ Не удалось скопировать ответ: ' + error.message, 'warn');
        setStatus('Не удалось скопировать ответ.', 'is-bad');
    }
}

function processMileageReport(segments) {
    let allCoords = [];
    let parkingCounter = 0;
    segments.forEach((segment) => {
        if (!segment.coordinates || segment.coordinates.length === 0) return;
        allCoords = allCoords.concat(segment.coordinates);
        if (segment.ismoved === false && segment.period) {
            const timeParts = String(segment.period).split(':').map(Number);
            const totalMinutes = (timeParts[0] || 0) * 60 + (timeParts[1] || 0);
            if (totalMinutes > 5) {
                parkingCounter += 1;
                const parkingCoord = segment.coordinates[0];
                const parkingIcon = L.divIcon({
                    className: 'parking-marker',
                    html: '<b>' + parkingCounter + '</b>',
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                });
                L.marker(parkingCoord, { icon: parkingIcon })
                    .addTo(featureGroup)
                    .bindPopup('<b>Стоянка №' + parkingCounter + '</b><br>Длительность: ' + segment.period + '<br>Начало: ' + segment.fdate);
            }
        }
    });

    if (allCoords.length > 0) {
        const polyline = L.polyline(allCoords, { color: '#d64933', weight: 4 }).addTo(featureGroup);
        map.fitBounds(polyline.getBounds(), { padding: [24, 24] });
    }
}

function processDeviceTrack(points) {
    if (!points || points.length === 0) return;
    const latLngs = points.map((point) => [point.latitude, point.longitude]);
    const polyline = L.polyline(latLngs, { color: '#2578a9', weight: 4 }).addTo(featureGroup);
    map.fitBounds(polyline.getBounds(), { padding: [24, 24] });
}

function initMap() {
    if (map) return;
    map = L.map('map').setView([48, 30], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);
    featureGroup = L.featureGroup().addTo(map);
}

function setDefaultInputs() {
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

    const toLocalISOString = (date) => {
        const tzoffset = (new Date()).getTimezoneOffset() * 60000;
        return new Date(date - tzoffset).toISOString().slice(0, 16);
    };

    if (dateToInput) dateToInput.value = toLocalISOString(todayEnd);
    if (dateFromInput) dateFromInput.value = toLocalISOString(todayStart);
}

function connect() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    setStatus('Подключение к WebSocket...', 'is-pending');
    socket = new WebSocket(wsUrl);

    socket.onopen = function () {
        setStatus('Соединение установлено.', 'is-ok');
        appendRawLog('WS open: ' + wsUrl, 'in');
    };

    socket.onmessage = function (event) {
        appendRawLog('⬅ ' + event.data, 'in');
        let data = null;
        try {
            data = JSON.parse(event.data);
        } catch (error) {
            setStatus('Получен непарсируемый ответ.', 'is-bad');
            return;
        }

        authState.lastPacket = data && data.name ? String(data.name) : '(unknown)';
        updateSessionUi();
        setStatus('Ответ получен.', 'is-ok');

        if (responsePayloadPre) {
            responsePayloadPre.textContent = JSON.stringify(data, null, 4);
        }

        if (data && data.name === 'login') {
            const packet = data.res && data.res[0] ? data.res[0] : null;
            if (packet && packet.uid) {
                authState.uid = Number(packet.uid) || null;
                authState.loggedIn = true;
                authState.loginInProgress = false;
                setStatus('Login выполнен.', 'is-ok');
            } else {
                authState.uid = null;
                authState.loggedIn = false;
                authState.loginInProgress = false;
                setStatus('Login отклонён.', 'is-bad');
            }
            updateSessionUi();
        }

        if (featureGroup) featureGroup.clearLayers();
        if (data.res && data.res[0] && data.res[0].f) {
            if (data.name === 'Mileage Report') processMileageReport(data.res[0].f);
            if (data.name === 'Device Track') processDeviceTrack(data.res[0].f);
        }
    };

    socket.onclose = function (event) {
        authState.loginInProgress = false;
        authState.loggedIn = false;
        authState.uid = null;
        updateSessionUi();
        appendRawLog('WS close: code=' + event.code + ' reason=' + (event.reason || ''), 'warn');
        setStatus('Соединение закрыто. Повторное подключение...', 'is-bad');
        reconnectTimer = setTimeout(connect, 5000);
    };

    socket.onerror = function () {
        setStatus('Ошибка WebSocket.', 'is-bad');
    };
}

function sendLogin() {
    syncAuthInputs();
    if (!authState.user || !authState.password) {
        alert('Укажите логин и пароль.');
        return;
    }
    if (!ensureSocketOpen()) return;
    authState.uid = null;
    authState.loggedIn = false;
    authState.loginInProgress = true;
    updateSessionUi();
    sendRequest(buildLoginRequest());
}

function populateRawRequest(kind) {
    const auth = resolveAuth();
    const range = getDateRange();
    const vehicleId = vehicleIdInput ? String(vehicleIdInput.value || '') : '';
    let payload = null;

    if (kind === 'login') {
        payload = buildLoginRequest();
    } else if (kind === 'desktop') {
        payload = {
            name: 'desktop',
            type: 'desktop',
            mid: 1,
            act: 'init',
            usr: auth.usr,
            pwd: auth.pwd,
            uid: auth.uid || 0,
            lang: 'en'
        };
    } else if (kind === 'select-min') {
        payload = {
            name: 'Vehicle Select Min',
            type: 'etbl',
            mid: 4,
            act: 'setup',
            filter: [{ selecteduid: [auth.uid || 0] }],
            nowait: true,
            waitfor: [],
            usr: auth.usr,
            pwd: auth.pwd,
            uid: auth.uid || 0,
            lang: 'en'
        };
    } else if (kind === 'device-track') {
        payload = {
            name: 'Device Track',
            type: 'etbl',
            mid: 6,
            act: 'filter',
            filter: [
                { selectedpgdateto: [range.dateTo] },
                { selectedpgdatefrom: [range.dateFrom] },
                { selecteddeviceid: [vehicleId] }
            ],
            usr: auth.usr,
            pwd: auth.pwd,
            uid: auth.uid || 0,
            lang: 'en'
        };
    }

    if (rawRequestInput && payload) {
        rawRequestInput.value = JSON.stringify(payload, null, 2);
    }
}

function sendRawCustom() {
    if (!rawRequestInput) return;
    let value = rawRequestInput.value.trim();
    if (!value) {
        appendRawLog('⚠ Пустой ввод', 'warn');
        return;
    }
    if (value.startsWith('send:')) value = value.slice(5);
    let obj = null;
    try {
        obj = JSON.parse(value);
    } catch (error) {
        appendRawLog('⚠ Ошибка парсинга JSON: ' + error.message, 'warn');
        return;
    }
    sendRequest(obj);
}

if (sendLoginBtn) sendLoginBtn.addEventListener('click', sendLogin);
if (clearSessionBtn) {
    clearSessionBtn.addEventListener('click', function () {
        authState.uid = null;
        authState.loggedIn = false;
        authState.loginInProgress = false;
        updateSessionUi();
        if (responsePayloadPre) responsePayloadPre.textContent = '{}';
        if (featureGroup) featureGroup.clearLayers();
    });
}
if (fillLoginPresetBtn) fillLoginPresetBtn.addEventListener('click', function () { populateRawRequest('login'); });
if (presetDesktopBtn) presetDesktopBtn.addEventListener('click', function () { populateRawRequest('desktop'); });
if (presetSelectMinBtn) presetSelectMinBtn.addEventListener('click', function () { populateRawRequest('select-min'); });
if (presetDeviceTrackBtn) presetDeviceTrackBtn.addEventListener('click', function () { populateRawRequest('device-track'); });
if (rawRequestSendBtn) rawRequestSendBtn.addEventListener('click', sendRawCustom);
if (rawRequestClearBtn) rawRequestClearBtn.addEventListener('click', function () {
    if (rawResponseLog) rawResponseLog.innerHTML = '(лог пуст)';
});
if (copyResponseBtn) copyResponseBtn.addEventListener('click', copyLatestResponse);
if (rawRequestInput) {
    rawRequestInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendRawCustom();
        }
    });
}

if (sendVehicleSelectMinBtn) {
    sendVehicleSelectMinBtn.addEventListener('click', function () {
        const auth = ensureLoggedInOrWarn();
        if (!auth) return;
        sendRequest({
            name: 'Vehicle Select Min',
            type: 'etbl',
            mid: 4,
            act: 'setup',
            filter: [{ selecteduid: [auth.uid] }],
            nowait: true,
            waitfor: [],
            usr: auth.usr,
            pwd: auth.pwd,
            uid: auth.uid,
            lang: 'en'
        });
    });
}

if (sendVehicleShowBtn) {
    sendVehicleShowBtn.addEventListener('click', function () {
        const auth = ensureLoggedInOrWarn();
        if (!auth) return;
        sendRequest({
            name: 'Vehicle Show',
            type: 'etbl',
            mid: 2,
            act: 'setup',
            filter: [],
            nowait: true,
            waitfor: [],
            usr: auth.usr,
            pwd: auth.pwd,
            uid: auth.uid,
            lang: 'en'
        });
    });
}

if (sendMileageReportBtn) {
    sendMileageReportBtn.addEventListener('click', function () {
        const auth = ensureLoggedInOrWarn();
        if (!auth) return;
        const range = getDateRange();
        const vehicleId = vehicleIdInput.value;
        sendRequest({
            name: 'Mileage Report',
            type: 'map',
            mid: 2,
            act: 'filter',
            filter: [
                { selectedvihicleid: [vehicleId] },
                { selectedpgdateto: [range.dateTo] },
                { selectedpgdatefrom: [range.dateFrom] }
            ],
            usr: auth.usr,
            pwd: auth.pwd,
            uid: auth.uid,
            lang: 'en'
        });
    });
}

if (sendDeviceTrackBtn) {
    sendDeviceTrackBtn.addEventListener('click', function () {
        const auth = ensureLoggedInOrWarn();
        if (!auth) return;
        const range = getDateRange();
        const deviceId = vehicleIdInput.value;
        sendRequest({
            name: 'Device Track',
            type: 'etbl',
            mid: 6,
            act: 'filter',
            filter: [
                { selectedpgdateto: [range.dateTo] },
                { selectedpgdatefrom: [range.dateFrom] },
                { selecteddeviceid: [deviceId] }
            ],
            usr: auth.usr,
            pwd: auth.pwd,
            uid: auth.uid,
            lang: 'en'
        });
    });
}

initMap();
setDefaultInputs();
updateSessionUi();
populateRawRequest('login');
connect();