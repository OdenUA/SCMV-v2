package com.scmv.android.ui.screen.map

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.scmv.android.data.repository.DeviceRepository
import com.scmv.android.data.repository.TrackRepository
import com.scmv.android.data.settings.AppSettings
import com.scmv.android.data.settings.AppSettingsData
import com.scmv.android.domain.model.Anomaly
import com.scmv.android.domain.model.Device
import com.scmv.android.domain.model.MileageSegment
import com.scmv.android.domain.model.StopPoint
import com.scmv.android.domain.model.TrackPoint
import com.scmv.android.domain.model.TrackSegment
import com.scmv.android.domain.analyzer.TrackAnalyzer
import com.scmv.android.util.AnomalyDetector
import com.scmv.android.util.Constants
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import javax.inject.Inject

/**
 * Track display mode.
 */
enum class TrackMode {
    /** Shows mileage segments with moving/stopped distinction */
    MILEAGE,
    /** Shows raw GPS track points */
    RAW,
    /** Shows analyzed track segments with issues */
    ANALYSIS
}

/**
 * UI state for the Map screen.
 */
data class MapUiState(
    val devices: List<Device> = emptyList(),
    val selectedDevice: Device? = null,
    val dateFrom: LocalDateTime = LocalDateTime.of(LocalDate.now(), LocalTime.of(0, 0)),
    val dateTo: LocalDateTime = LocalDateTime.of(LocalDate.now(), LocalTime.of(23, 59)),
    val mileageSegments: List<MileageSegment> = emptyList(),
    val stops: List<StopPoint> = emptyList(),
    val rawTrackPoints: List<TrackPoint> = emptyList(),
    val trackMode: TrackMode = TrackMode.MILEAGE,
    val isLoading: Boolean = false,
    val isLoadingDevices: Boolean = false,
    val error: String? = null,
    val anomalies: List<Anomaly> = emptyList(),
    val analysisSegments: List<TrackSegment> = emptyList(),
    val totalMileageKm: Double? = null,
    val showDirection: Boolean = false,
    val stopsVisible: Boolean = true,
    val trackLineWidth: Float = AppSettingsData.DEFAULT_TRACK_LINE_WIDTH,
    val stopMarkerSize: Int = AppSettingsData.DEFAULT_STOP_MARKER_SIZE,
    val arrowSize: Int = AppSettingsData.DEFAULT_ARROW_SIZE,
    val isAnalysisVisible: Boolean = false
)

/**
 * ViewModel for the Map screen.
 * Handles device selection, date range filtering, and track data loading.
 */
@HiltViewModel
class MapViewModel @Inject constructor(
    private val trackRepository: TrackRepository,
    private val deviceRepository: DeviceRepository,
    private val appSettings: AppSettings
) : ViewModel() {

    private val _uiState = MutableStateFlow(MapUiState())
    val uiState: StateFlow<MapUiState> = _uiState.asStateFlow()

    init {
        loadDevices()
        observeAppSettings()
    }

    /**
     * Observes app settings changes and updates UI state.
     */
    private fun observeAppSettings() {
        viewModelScope.launch {
            appSettings.settingsFlow.collect { settings ->
                _uiState.update {
                    it.copy(
                        trackLineWidth = settings.trackLineWidth,
                        stopMarkerSize = settings.stopMarkerSize,
                        arrowSize = settings.arrowSize
                    )
                }
            }
        }
    }

    /**
     * Loads the list of available devices.
     */
    private fun loadDevices() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingDevices = true) }

            deviceRepository.getDevices()
                .onSuccess { devices ->
                    _uiState.update { currentState ->
                        currentState.copy(
                            devices = devices,
                            isLoadingDevices = false
                        )
                    }
                }
                .onFailure { exception ->
                    _uiState.update { currentState ->
                        currentState.copy(
                            isLoadingDevices = false,
                            error = exception.message ?: "Failed to load devices"
                        )
                    }
                }
        }
    }

    /**
     * Sets the selected device and loads its track data.
     *
     * @param device The device to select
     */
    fun setDevice(device: Device?) {
        _uiState.update { it.copy(selectedDevice = device, totalMileageKm = null) }
        device?.let { loadTrackData() }
    }

    /**
     * Selects a device by its ID.
     * Finds the device in the current list and selects it.
     *
     * @param deviceId The device ID to select
     */
    fun selectDeviceById(deviceId: String) {
        val device = _uiState.value.devices.find { it.id.toString() == deviceId }
        if (device != null) {
            setDevice(device)
        }
    }

    /**
     * Sets the date range for track data and reloads.
     *
     * @param from Start date/time
     * @param to End date/time
     */
    fun setDateRange(from: LocalDateTime, to: LocalDateTime) {
        _uiState.update { it.copy(dateFrom = from, dateTo = to) }
    }

    /**
     * Sets the track display mode.
     *
     * @param mode The track mode to use (MILEAGE or RAW)
     */
    fun setTrackMode(mode: TrackMode) {
        _uiState.update { it.copy(trackMode = mode) }
        if (_uiState.value.selectedDevice != null) {
            loadTrackData()
        }
    }
    
    fun setShowDirection(show: Boolean) {
        _uiState.update { it.copy(showDirection = show) }
    }

    /**
     * Toggles the visibility of stop markers on the map.
     */
    fun toggleStopsVisibility() {
        _uiState.update { it.copy(stopsVisible = !it.stopsVisible) }
    }

    /**
     * Toggles the visibility of the analysis panel.
     */
    fun toggleAnalysisVisibility() {
        _uiState.update { it.copy(isAnalysisVisible = !it.isAnalysisVisible) }
    }

    /**
     * Sets stops visibility state.
     */
    fun setStopsVisible(visible: Boolean) {
        _uiState.update { it.copy(stopsVisible = visible) }
    }

    /**
     * Loads mileage segments for the selected device and date range.
     */
    fun loadMileage() {
        val state = _uiState.value
        val device = state.selectedDevice ?: return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null, totalMileageKm = null) }

            trackRepository.getMileage(
                deviceId = device.id,
                from = state.dateFrom,
                to = state.dateTo
            )
                .onSuccess { segments ->
                    android.util.Log.d("MapViewModel", "Mileage loaded: ${segments.size} segments")
                    segments.take(3).forEachIndexed { index, segment ->
                        android.util.Log.d("MapViewModel", "  Segment $index: ${segment.coordinates.size} coords, moving=${segment.isMoving}")
                    }
                    // DO NOT detect anomalies in Mileage mode - only in Raw Track mode
                    // Filter stops by minimum duration (matching web version threshold)
                    val minDuration = Duration.ofMinutes(Constants.STOP_MIN_DURATION_MINUTES.toLong())
                    val stops = segments.filter { !it.isMoving && it.coordinates.isNotEmpty() }
                        .mapNotNull { segment ->
                            val first = segment.coordinates.firstOrNull() ?: return@mapNotNull null
                            StopPoint(
                                position = first,
                                startTime = segment.startTime,
                                duration = segment.duration,
                                markerCode = segment.marker
                            )
                        }
                        .filter { it.duration >= minDuration }
                    _uiState.update { currentState ->
                        currentState.copy(
                            mileageSegments = segments,
                            stops = stops,
                            anomalies = emptyList(), // Clear anomalies in Mileage mode
                            isLoading = false,
                            error = null
                        )
                    }

                    // Load total mileage
                    trackRepository.getMileageTotal(
                        deviceId = device.id,
                        from = state.dateFrom,
                        to = state.dateTo
                    )
                        .onSuccess { totalKm ->
                            android.util.Log.d("MapViewModel", "Total mileage loaded: $totalKm km")
                            _uiState.update { currentState ->
                                currentState.copy(totalMileageKm = totalKm)
                            }
                        }
                        .onFailure { exception ->
                            android.util.Log.w("MapViewModel", "Failed to load total mileage: ${exception.message}")
                        }
                }
                .onFailure { exception ->
                    _uiState.update { currentState ->
                        currentState.copy(
                            isLoading = false,
                            error = exception.message ?: "Failed to load mileage"
                        )
                    }
                }
        }
    }

    /**
     * Loads raw track points for the selected device and date range.
     */
    fun loadRawTrack() {
        val state = _uiState.value
        val device = state.selectedDevice ?: return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            trackRepository.getRawTrack(
                deviceId = device.id,
                from = state.dateFrom,
                to = state.dateTo
            )
                .onSuccess { points ->
                    android.util.Log.d("MapViewModel", "Raw track loaded: ${points.size} points")
                    points.take(3).forEachIndexed { index, point ->
                        android.util.Log.d("MapViewModel", "  Point $index: lat=${point.latitude}, lon=${point.longitude}, speed=${point.speed}")
                    }
                    val anomalies = detectRawTrackAnomalies(points)
                    
                    _uiState.update { currentState ->
                        currentState.copy(
                            rawTrackPoints = points,
                            anomalies = anomalies,
                            isLoading = false,
                            error = null
                        )
                    }
                }
                .onFailure { exception ->
                    _uiState.update { currentState ->
                        currentState.copy(
                            isLoading = false,
                            error = exception.message ?: "Failed to load track"
                        )
                    }
                }
        }
    }

    /**
     * Loads analyzed track data.
     */
    fun loadAnalysisTrack() {
        val state = _uiState.value
        val device = state.selectedDevice ?: return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            trackRepository.getAnalysisTrack(
                deviceId = device.id,
                from = state.dateFrom,
                to = state.dateTo
            )
                .onSuccess { points ->
                    android.util.Log.d("MapViewModel", "Analysis track loaded: ${points.size} points")
                    
                    // Run route analysis on the fetched points
                    val analysisSegments = TrackAnalyzer.analyze(points)
                    android.util.Log.d("MapViewModel", "Analysis complete: ${analysisSegments.size} segments")
                    
                    _uiState.update { currentState ->
                        currentState.copy(
                            analysisSegments = analysisSegments,
                            isAnalysisVisible = true, // Force visible in Analysis mode
                            isLoading = false,
                            error = null
                        )
                    }
                }
                .onFailure { exception ->
                    _uiState.update { currentState ->
                        currentState.copy(
                            isLoading = false,
                            error = exception.message ?: "Failed to load analysis"
                        )
                    }
                }
        }
    }

    /**
     * Loads track data based on current mode.
     */
    private fun loadTrackData() {
        when (_uiState.value.trackMode) {
            TrackMode.MILEAGE -> loadMileage()
            TrackMode.RAW -> loadRawTrack()
            TrackMode.ANALYSIS -> loadAnalysisTrack()
        }
    }

    /**
     * Clears any current error.
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    /**
     * Refreshes the current data.
     */
    fun refresh() {
        loadDevices()
        if (_uiState.value.selectedDevice != null) {
            loadTrackData()
        }
    }

    /**
     * Detects anomalies in mileage segments.
     * Uses standard thresholds for mileage mode.
     */
    private fun detectAnomalies(segments: List<MileageSegment>): List<Anomaly> {
        // Convert mileage segments to track points for anomaly detection
        val allPoints = segments.flatMap { segment ->
            segment.coordinates.mapIndexed { index, latLng ->
                TrackPoint(
                    latitude = latLng.latitude,
                    longitude = latLng.longitude,
                    timestamp = segment.startTime.plusSeconds(index.toLong()),
                    speed = if (segment.isMoving) 30.0 else 0.0
                )
            }
        }
        return if (allPoints.size >= 2) {
            AnomalyDetector.detectAnomalies(allPoints)
        } else {
            emptyList()
        }
    }

    /**
     * Detects anomalies in raw track points.
     * Uses raw track specific thresholds (5 min gap, 150 km/h speed, 1200m jump).
     */
    private fun detectRawTrackAnomalies(points: List<TrackPoint>): List<Anomaly> {
        return AnomalyDetector.detectRawTrackAnomalies(points)
    }
}
