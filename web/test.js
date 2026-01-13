const wsUrl = "wss://scmv.vpngps.com:4445";

const statusDiv = document.getElementById('status');
const sendMileageReportBtn = document.getElementById('sendMileageReport');
const sendDeviceTrackBtn = document.getElementById('sendDeviceTrack');
const responsePayloadPre = document.getElementById('responsePayload');
const dateFromInput = document.getElementById('dateFrom');
const dateToInput = document.getElementById('dateTo');
const vehicleIdInput = document.getElementById('vehicleId');

let socket;
let map;
let featureGroup;
// Raw tester elements
const rawRequestInput = document.getElementById('rawRequestInput');
const rawRequestSendBtn = document.getElementById('rawRequestSend');
const rawRequestClearBtn = document.getElementById('rawRequestClear');
const rawResponseLog = document.getElementById('rawResponseLog');

function appendRawLog(text, direction){
    if (!rawResponseLog) return;
    const ts = new Date().toISOString().slice(11,19);
    const line = document.createElement('div');
    line.textContent = `[${ts}] ${text}`;
    line.style.padding = '2px 0';
    line.style.color = direction === 'out' ? '#6ee7b7' : '#93c5fd';
    rawResponseLog.appendChild(line);
    rawResponseLog.scrollTop = rawResponseLog.scrollHeight;
}

// --- Map Initialization ---
function initMap() {
    if (map) return;
    map = L.map('map').setView([48, 30], 6); // Centered on Ukraine
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);
    featureGroup = L.featureGroup().addTo(map);
}

// --- WebSocket Connection ---
function connect() {
    console.log("Attempting to connect to WebSocket...");
    if (statusDiv) {
        statusDiv.textContent = "Connecting...";
        statusDiv.style.color = "orange";
    }

    socket = new WebSocket(wsUrl);

    socket.onopen = function() {
        console.log("WebSocket connection established.");
        if (statusDiv) {
            statusDiv.textContent = "Connection established.";
            statusDiv.style.color = "green";
        }
    };

    socket.onmessage = function(event) {
        console.log("Raw data received from server:", event.data);
        if (statusDiv) {
            statusDiv.textContent = "Data received.";
            statusDiv.style.color = "blue";
        }
        appendRawLog('⬅ ' + event.data, 'in');
        
        const data = JSON.parse(event.data);
        
        // Display raw JSON
        if (responsePayloadPre) {
            responsePayloadPre.textContent = JSON.stringify(data, null, 4);
        }

        // Clear previous map layers
        featureGroup.clearLayers();

        // Process data for map
        if (data.res && data.res[0] && data.res[0].f) {
            if (data.name === "Mileage Report") {
                processMileageReport(data.res[0].f);
            } else if (data.name === "Device Track") {
                processDeviceTrack(data.res[0].f);
            }
        } else {
            console.log("No drawable data in response.");
        }
    };

    socket.onclose = function(event) {
        if (event.wasClean) {
            console.log(`WebSocket connection closed cleanly, code=${event.code} reason=${event.reason}`);
            statusDiv.textContent = `Connection closed cleanly.`;
        } else {
            console.error('WebSocket connection died.');
            statusDiv.textContent = 'Connection died. Trying to reconnect...';
        }
        statusDiv.style.color = "red";
        setTimeout(connect, 5000);
    };

    socket.onerror = function(error) {
        console.error(`WebSocket Error:`, error);
        statusDiv.textContent = `Error: ${error.message || 'Could not connect.'}`;
        statusDiv.style.color = "red";
    };
}

// --- Data Processors for Map ---
function processMileageReport(segments) {
    let allCoords = [];
    let parkingCounter = 0;
    segments.forEach(segment => {
        if (segment.coordinates && segment.coordinates.length > 0) {
            const segmentCoords = segment.coordinates;
            allCoords = allCoords.concat(segmentCoords);

            // Check if the segment is a parking/stop and its duration is more than 5 minutes
            if (segment.ismoved === false && segment.period) {
                const timeParts = segment.period.split(':').map(Number);
                const totalMinutes = timeParts[0] * 60 + timeParts[1];

                if (totalMinutes > 5) {
                    parkingCounter++;
                    const parkingCoord = segmentCoords[0];
                    
                    const parkingIcon = L.divIcon({
                        className: 'parking-marker',
                        html: `<b>${parkingCounter}</b>`,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    });

                    L.marker(parkingCoord, { icon: parkingIcon })
                      .addTo(featureGroup)
                      .bindPopup(`<b>Стоянка №${parkingCounter}</b><br>Длительность: ${segment.period}<br>Начало: ${segment.fdate}`);
                }
            }
        }
    });

    if (allCoords.length > 0) {
        const polyline = L.polyline(allCoords, { color: 'red' }).addTo(featureGroup);
        map.fitBounds(polyline.getBounds());
    }
}

function processDeviceTrack(points) {
    if (points.length === 0) return;
    
    // Leaflet uses [lat, lng], server sends correct order here.
    const latLngs = points.map(p => [p.latitude, p.longitude]);
    
    const polyline = L.polyline(latLngs, { color: 'blue' }).addTo(featureGroup);
    map.fitBounds(polyline.getBounds());
}

// --- Input Defaults ---
function setDefaultInputs() {
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

    const toLocalISOString = (date) => {
        const tzoffset = (new Date()).getTimezoneOffset() * 60000;
        const localISOTime = new Date(date - tzoffset).toISOString().slice(0, 16);
        return localISOTime;
    };

    dateToInput.value = toLocalISOString(todayEnd);
    dateFromInput.value = toLocalISOString(todayStart);
    // vehicleIdInput.value is already set in HTML
}

// --- Event Listeners ---
function sendRequest(requestObject) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert("WebSocket is not connected.");
        return;
    }
    const payload = JSON.stringify(requestObject);
    console.log("Sending payload:", payload);
    socket.send(payload);
    statusDiv.textContent = "Request sent. Waiting for response...";
    statusDiv.style.color = "blue";
    responsePayloadPre.textContent = ''; // Clear previous response
}

// --- Raw Tester ---
function sendRawCustom(){
    if (!rawRequestInput) return;
    let value = rawRequestInput.value.trim();
    if (!value){
        appendRawLog('⚠ Пустой ввод', 'in');
        return;
    }
    if (value.startsWith('send:')) value = value.slice(5);
    let obj;
    try { obj = JSON.parse(value); }
    catch(err){ appendRawLog('⚠ Ошибка парсинга JSON: '+err.message,'in'); return; }
    if (!socket || socket.readyState !== WebSocket.OPEN){
        appendRawLog('⚠ WebSocket не подключен', 'in');
        return;
    }
    const payload = JSON.stringify(obj);
    socket.send(payload);
    appendRawLog('➡ ' + payload, 'out');
}

if (rawRequestSendBtn){ rawRequestSendBtn.addEventListener('click', sendRawCustom); }
if (rawRequestClearBtn){ rawRequestClearBtn.addEventListener('click', ()=>{ if (rawResponseLog) rawResponseLog.innerHTML='(лог пуст)'; }); }
if (rawRequestInput){
    rawRequestInput.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendRawCustom(); }
    });
}

function resolveAuth(){
    // Prefer global authenticated state if available
    var usr = (typeof authUser !== 'undefined' && authUser) || (window.loginUserInput && loginUserInput.value) || '';
    var pwd = (typeof authPwd !== 'undefined' && authPwd) || (window.loginPasswordInput && loginPasswordInput.value) || '';
    var uid = (typeof authUid !== 'undefined' && authUid != null) ? authUid : null;
    return { usr: usr, pwd: pwd, uid: uid };
}

function ensureAuthOrWarn(){
    var a = resolveAuth();
    if(!a.usr || !a.pwd){
        alert('Отсутствуют учетные данные. Выполните вход.');
        return null;
    }
    return a;
}

sendMileageReportBtn.addEventListener('click', () => {
    const auth = ensureAuthOrWarn();
    if(!auth) return;
    const dateTo = new Date(dateToInput.value).toISOString();
    const dateFrom = new Date(dateFromInput.value).toISOString();
    const vehicleId = vehicleIdInput.value;
    const request = {
        name: 'Mileage Report', type: 'map', mid: 2, act: 'filter',
        filter: [
            { selectedvihicleid: [vehicleId] },
            { selectedpgdateto: [dateTo] },
            { selectedpgdatefrom: [dateFrom] }
        ],
        usr: auth.usr, pwd: auth.pwd, uid: auth.uid, lang: 'en'
    };
    sendRequest(request);
});

sendDeviceTrackBtn.addEventListener('click', () => {
    const auth = ensureAuthOrWarn();
    if(!auth) return;
    const dateTo = new Date(dateToInput.value).toISOString();
    const dateFrom = new Date(dateFromInput.value).toISOString();
    const deviceId = vehicleIdInput.value;
    const request = {
        name: 'Device Track', type: 'etbl', mid: 6, act: 'filter',
        filter: [
            { selectedpgdateto: [dateTo] },
            { selectedpgdatefrom: [dateFrom] },
            { selecteddeviceid: [deviceId] }
        ],
        usr: auth.usr, pwd: auth.pwd, uid: auth.uid, lang: 'en'
    };
    sendRequest(request);
});


// --- Initial Load ---
initMap();
setDefaultInputs();
connect();
