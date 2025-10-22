// Separate data caches for Mileage and Track
window._mileageData = [];
window._trackData = [];
// Global variables & DOM references
var wsUrl = "wss://scmv.vpngps.com:4445";
// DOM elements (queried once since scripts loaded at end of body)
// Status div now inside filter panel footer; will be resolved lazily
var statusDiv = document.getElementById('status');
var sendMileageReportBtn = document.getElementById('sendMileageReport');
var sendDeviceTrackBtn = document.getElementById('sendDeviceTrack');
var dateFromInput = document.getElementById('dateFrom');
var dateToInput = document.getElementById('dateTo');
var deviceIdInput = document.getElementById('deviceId');
var toggleDirectionsButton = document.getElementById('toggleDirections');
var tableHead = document.querySelector('#resultTable thead');
var tableBody = document.querySelector('#resultTable tbody');
var currentIdDisplay = document.getElementById('currentIdDisplay');
var startstopAccumulationTbody = document.getElementById('startstopAccumulationTbody');
var startstopSumResultTbody = document.getElementById('startstopSumResultTbody');
var startstopAccumulationThead = document.querySelector('#startstopAccumulationTable thead');
var startstopSumResultThead = document.querySelector('#startstopSumResultTable thead');
// generateSqlBtn removed (button moved/removed from Device Track Details)
var sqlModal = document.getElementById('sqlModal');
var closeModalBtn = document.querySelector('.close-button');
var sqlOutput = document.getElementById('sql-output');
var boundsDebugContainer = document.getElementById('boundsDebugContainer');
var boundsDebugOutput = document.getElementById('boundsDebugOutput');
var toggleVehicleBtn = document.getElementById('toggleVehicleBtn');
var lineWidthSlider = document.getElementById('lineWidthSlider');
var lineWidthValue = document.getElementById('lineWidthValue');
var manualRouteInfoDiv = document.getElementById('manualRouteInfo');
// Device Log/Alarm elements
var sendDeviceLogBtn = document.getElementById('sendDeviceLog');
var deviceAlarmThead = document.getElementById('deviceAlarmThead');
var deviceAlarmTbody = document.getElementById('deviceAlarmTbody');
var deviceLogThead = document.getElementById('deviceLogThead');
var deviceLogTbody = document.getElementById('deviceLogTbody');
// Login controls
var loginUserInput = document.getElementById('loginUser');
var loginPasswordInput = document.getElementById('loginPassword');
var loginBtn = document.getElementById('loginBtn');
var loginInfo = document.getElementById('loginInfo');
var rememberCheckbox = document.getElementById('rememberCredentials');
// Auth state
var authLoggedIn = false;
var authUid = null;
var authUser = '';
var authPwd = '';
// Vehicle overlay data
var vehicleSelectMinData = null;
var vehicleFilteredData = null;
// Separate cache for Vehicle Show (Device List) to avoid replacing select-min data
var vehicleShowData = null;
// Current overlay mode: 'selectMin' (vehicle) or 'show' (Device List)
var vehicleOverlayMode = 'selectMin';
// vehicleShowMode indicates how vehicleShowData should be treated: 'list' (Device List) or 'edit' (Edit Vehicle)
var vehicleShowMode = 'list';
// Allow hiding the per-row 'Select' button when overlay is 'selectMin' (vehicle)
var hideVehicleSelectButton = false;
// Pending saves map: id -> { btn, tr, originalValues, newValues, timeoutId }
var pendingVehicleSaves = {};
var vehicleOverlay = document.getElementById('vehicleOverlay');
var closeVehicleOverlayBtn = document.getElementById('closeVehicleOverlayBtn');
var vehicleTableHead = document.getElementById('vehicleTableHead');
var vehicleTableBody = document.getElementById('vehicleTableBody');
var fleetKeyMap = null;
var vehicleColumns = null;
var vehicleColumnFilters = {};
var vehicleSortState = {column:null, dir:1};
// Device Track header
// Vehicle meta display (moved into side panel header)
var vehicleMetaDisplay = document.getElementById('vehicleMetaDisplay');
var deviceTrackHeaderEl = null; // legacy unused
var deviceTrackHeaderBaseText = '';
var selectedVehicleMeta = null;
// Route state
var routeModeActive = false;
var routePointsManual = [];
var routeClickCount = 0;
var routeTempMarkers = [];
var routeManualPolyline = null;
var routeBuilt = false;
var routeRoadPolyline = null;
var parkingMarkers = [];
var pendingParkingFdateFocus = null;
var ENABLE_DEVICE_TRACK_PARKINGS = false;
var routeDistanceKm = null;
var lastContextMenuEvent = 0;
var routeMapsUrl = null;
var routeControlRef = null;
// Start/Stop data
var startstopStops = [];
var mileageStopCoords = {};
var mileageAutoRequested = false;
var lastDeviceIdForMileage = null;
// Mileage / gaps
var lastMileageSegments = null;
var mileageGapLayers = [];
// Map & layers
var map = null;
var trackLayerGroup = null;
var parkingLayerGroup = null;
var directionDecorator = null;
var directionsVisible = true;
var parkingsVisible = true;
var outOfBoundsGroups = [];
var previouslySelectedLayer = null;
// Anomaly checkbox removed; anomalies always processed for Vehicle Track
// WebSocket
var socket = null;
// Resizing elements
var resizeHandle = document.getElementById('resizeHandle');
var mapContainer = document.getElementById('mapContainer');
var mapDiv = document.getElementById('map');
var isResizing = false;
var isDeviceLogInitialized = false;
// Bounds
var BOUNDS = {MIN_LAT:44.3, MAX_LAT:52.4, MIN_LON:22.1, MAX_LON:40.2};
// Helper: build local date param (keeps user-entered local wall time, adds seconds if missing)
function buildLocalDateParam(raw, isEnd){
	if(!raw) return '';
	if(raw.length === 16){ raw += isEnd?':59':':00'; }
	return raw;
}

// Global loading overlay helpers
try{
	// create overlay element if not present in HTML
	if(typeof document !== 'undefined' && !document.getElementById('globalLoadingOverlay')){
		var glo = document.createElement('div'); glo.id = 'globalLoadingOverlay';
		var inner = document.createElement('div'); inner.className = 'global-loading-inner';
		var spinner = document.createElement('div'); spinner.className = 'global-loading-spinner';
		var txt = document.createElement('div'); txt.className = 'global-loading-text'; txt.textContent = 'Загрузка...';
		inner.appendChild(spinner); inner.appendChild(txt); glo.appendChild(inner); document.body.appendChild(glo);
	}
}catch(e){ console.warn('Create global loading overlay failed', e); }

function showLoadingOverlay(msg){ try{ var el = document.getElementById('globalLoadingOverlay'); if(!el) return; if(msg){ var t = el.querySelector('.global-loading-text'); if(t) t.textContent = msg; } el.classList.add('visible'); }catch(e){} }
function hideLoadingOverlay(){ try{ var el = document.getElementById('globalLoadingOverlay'); if(!el) return; el.classList.remove('visible'); }catch(e){} }

// Helper: format date as DD.MM.YY HH:mm:ss (always local time, no timezone shift)
function formatAnomalyTime(date) {
	if (!date) return '';
	let d;
	if (typeof date === 'string') {
		// DD.MM.YY HH:mm:ss
		if (/^\d{2}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) {
			const [dmy, hms] = date.split(' ');
			const [day, month, year] = dmy.split('.').map(Number);
			const [hour, min, sec] = hms.split(':').map(Number);
			const fullYear = year < 70 ? 2000 + year : 1900 + year;
			d = new Date(fullYear, month - 1, day, hour, min, sec);
		}
		// YYYY-MM-DD HH:mm:ss
		else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) {
			const [ymd, hms] = date.split(' ');
			const [year, month, day] = ymd.split('-').map(Number);
			const [hour, min, sec] = hms.split(':').map(Number);
			d = new Date(year, month - 1, day, hour, min, sec);
		} else {
			// ISO, with timezone
			d = new Date(date);
		}
	} else {
		d = new Date(date);
	}
	const pad = n => n.toString().padStart(2, '0');
	return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear().toString().slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
