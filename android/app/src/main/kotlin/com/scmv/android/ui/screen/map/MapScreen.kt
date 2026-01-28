package com.scmv.android.ui.screen.map

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.Assessment
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.BottomSheetScaffold
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SheetValue
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberBottomSheetScaffoldState
import androidx.compose.material3.rememberStandardBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.scmv.android.R
import com.scmv.android.domain.model.Anomaly
import com.scmv.android.domain.model.AnomalyType
import com.scmv.android.domain.model.Device
import com.scmv.android.domain.model.LatLng
import com.scmv.android.domain.model.MileageSegment
import com.scmv.android.domain.model.TrackPoint
import com.scmv.android.domain.model.TrackSegment
import com.scmv.android.ui.components.DeviceSelectionSheet
import com.scmv.android.ui.screen.map.components.AnomalyDashPatterns
import com.scmv.android.ui.screen.map.components.AnomalyPanel
import com.scmv.android.ui.screen.map.components.AnalysisPanel
import com.scmv.android.ui.screen.map.components.MapPolyline
import com.scmv.android.ui.screen.map.components.OsmMapController
import com.scmv.android.ui.screen.map.components.OsmMapView
import com.scmv.android.ui.screen.map.components.TrackColors
import kotlinx.coroutines.launch
import org.osmdroid.util.GeoPoint
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import com.scmv.android.util.Constants

/**
 * Map screen composable.
 * Displays an OSMdroid map with track data and controls in a bottom sheet.
 *
 * @param selectedDeviceId Optional device ID passed back from devices screen
 * @param onNavigateToSettings Callback to navigate to settings screen
 * @param viewModel The MapViewModel instance
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MapScreen(
    selectedDeviceId: String? = null,
    onNavigateToSettings: () -> Unit = {},
    viewModel: MapViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var mapController by remember { mutableStateOf<OsmMapController?>(null) }
    var showDeviceSelector by remember { mutableStateOf(false) }
    var isAnalysisPanelExpanded by remember { mutableStateOf(false) }
    var selectedAnalysisSegment by remember { mutableStateOf<TrackSegment?>(null) }

    // Reset expansion when leaving Analysis mode
    LaunchedEffect(uiState.trackMode) {
        if (uiState.trackMode != TrackMode.ANALYSIS) {
            isAnalysisPanelExpanded = false
        }
    }

    val bottomSheetState = rememberStandardBottomSheetState(
        initialValue = SheetValue.PartiallyExpanded
    )
    val scaffoldState = rememberBottomSheetScaffoldState(
        bottomSheetState = bottomSheetState
    )

    // Handle selected device from navigation
    LaunchedEffect(selectedDeviceId) {
        selectedDeviceId?.let { deviceId ->
            viewModel.selectDeviceById(deviceId)
        }
    }

    // Show error in snackbar
    LaunchedEffect(uiState.error) {
        uiState.error?.let { error ->
            snackbarHostState.showSnackbar(error)
            viewModel.clearError()
        }
    }

    // Convert track data to polylines
    val trackPolylines = remember(uiState.mileageSegments, uiState.rawTrackPoints, uiState.trackMode, uiState.analysisSegments) {
        when (uiState.trackMode) {
            TrackMode.MILEAGE -> convertMileageToPolylines(uiState.mileageSegments)
            TrackMode.RAW -> convertRawTrackToPolylines(uiState.rawTrackPoints)
            TrackMode.ANALYSIS -> {
                if (uiState.analysisSegments.isNotEmpty()) {
                    convertAnalysisSegmentsToPolylines(uiState.analysisSegments)
                } else {
                    emptyList()
                }
            }
        }
    }

    // Convert anomalies to polylines
    val anomalyPolylines = remember(uiState.anomalies) {
        convertAnomaliesToPolylines(uiState.anomalies)
    }

    // Combine track and anomaly polylines
    val polylines = remember(trackPolylines, anomalyPolylines) {
        trackPolylines + anomalyPolylines
    }

    BottomSheetScaffold(
        scaffoldState = scaffoldState,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        sheetPeekHeight = 140.dp,
        sheetContent = {
            MapBottomSheetContent(
                selectedDevice = uiState.selectedDevice,
                dateFrom = uiState.dateFrom,
                dateTo = uiState.dateTo,
                trackMode = uiState.trackMode,
                isLoading = uiState.isLoading,
                totalMileageKm = uiState.totalMileageKm,
                showDirection = uiState.showDirection,
                onShowDeviceSelector = { showDeviceSelector = true },
                onDateRangeChanged = viewModel::setDateRange,
                onTrackModeChanged = viewModel::setTrackMode,
                onToggleDirection = viewModel::setShowDirection,
                onRefresh = viewModel::refresh
            )
        },
        sheetContainerColor = MaterialTheme.colorScheme.surface,
        sheetShadowElevation = 8.dp
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // OSMdroid Map
            OsmMapView(
                modifier = Modifier.fillMaxSize(),
                polylines = polylines,
                centerOnPoints = true,
                showDirection = uiState.showDirection,
                rawTrackPoints = uiState.rawTrackPoints,
                stops = if (uiState.stopsVisible) uiState.stops else emptyList(),
                trackMode = uiState.trackMode,
                trackLineWidth = uiState.trackLineWidth,
                stopMarkerSize = uiState.stopMarkerSize,
                arrowSize = uiState.arrowSize.toFloat(),
                onMapReady = { controller ->
                    mapController = controller
                    // Remove anomaly marker when map is clicked (matching web behavior)
                    controller.setOnMapClickListener {
                        controller.removeAnomalyMarker()
                    }
                },
                onSegmentClick = { selectedAnalysisSegment = it }
            )

            // Map control buttons column (top-right)
            Column(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Settings button
                SmallFloatingActionButton(
                    onClick = onNavigateToSettings,
                    containerColor = MaterialTheme.colorScheme.secondaryContainer
                ) {
                    Icon(
                        imageVector = Icons.Default.Settings,
                        contentDescription = stringResource(R.string.settings)
                    )
                }

                // Stops visibility toggle
                SmallFloatingActionButton(
                    onClick = { viewModel.toggleStopsVisibility() },
                    containerColor = if (uiState.stopsVisible) 
                        MaterialTheme.colorScheme.primaryContainer 
                    else 
                        MaterialTheme.colorScheme.surfaceVariant
                ) {
                    Icon(
                        imageVector = if (uiState.stopsVisible) 
                            Icons.Default.Visibility 
                        else 
                            Icons.Default.VisibilityOff,
                        contentDescription = if (uiState.stopsVisible) 
                            stringResource(R.string.map_hide_stops)
                        else 
                            stringResource(R.string.map_show_stops)
                    )
                }

                // Direction arrows toggle
                SmallFloatingActionButton(
                    onClick = { viewModel.setShowDirection(!uiState.showDirection) },
                    containerColor = if (uiState.showDirection) 
                        MaterialTheme.colorScheme.primaryContainer 
                    else 
                        MaterialTheme.colorScheme.surfaceVariant
                ) {
                    Icon(
                        imageVector = Icons.Default.Timeline,
                        contentDescription = if (uiState.showDirection) 
                            stringResource(R.string.map_hide_direction)
                        else 
                            stringResource(R.string.map_show_direction)
                    )
                }
            }

            // Zoom control buttons (bottom-right)
            // Positioned above the anomaly panel when it's visible
            Column(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(
                        end = 16.dp,
                        bottom = if (uiState.trackMode == TrackMode.RAW && uiState.anomalies.isNotEmpty()) 72.dp else 16.dp
                    ),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                SmallFloatingActionButton(
                    onClick = { mapController?.zoomIn() },
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                ) {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = stringResource(R.string.map_zoom_in)
                    )
                }
                SmallFloatingActionButton(
                    onClick = { mapController?.zoomOut() },
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                ) {
                    Icon(
                        imageVector = Icons.Default.Remove,
                        contentDescription = stringResource(R.string.map_zoom_out)
                    )
                }
            }

            // Anomaly panel at the bottom - only in RAW mode
            if (uiState.trackMode == TrackMode.RAW && uiState.anomalies.isNotEmpty()) {
                AnomalyPanel(
                    anomalies = uiState.anomalies,
                    onAnomalyClick = { anomaly ->
                        mapController?.focusOnAnomaly(anomaly, animated = true)
                    },
                    modifier = Modifier.align(Alignment.BottomCenter)
                )
            }
            


            // Analysis panel - only in ANALYSIS mode with active segments
            if (uiState.trackMode == TrackMode.ANALYSIS && uiState.analysisSegments.isNotEmpty()) {
                AnalysisPanel(
                    segments = uiState.analysisSegments,
                    isExpanded = isAnalysisPanelExpanded,
                    onToggleExpand = { isAnalysisPanelExpanded = !isAnalysisPanelExpanded },
                    onSegmentClick = { segment ->
                        // Focus on segment (center on first point)
                        segment.points.firstOrNull()?.let { point ->
                            mapController?.setCenter(
                                latitude = point.latitude,
                                longitude = point.longitude,
                                zoomLevel = 15.0,
                                animated = true
                            )
                        }
                    },
                    modifier = if (isAnalysisPanelExpanded) {
                        Modifier
                            .fillMaxSize()
                            .padding(top = 16.dp, start = 16.dp, end = 16.dp, bottom = 16.dp)
                            .background(Color.Transparent) // Surface handles background
                    } else {
                        Modifier
                            .align(Alignment.TopEnd)
                            .padding(top = 16.dp, end = 72.dp) // Left of settings button
                            .width(280.dp)
                    }
                )
            }

            // Loading overlay
            AnimatedVisibility(
                visible = uiState.isLoading,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier.fillMaxSize()
            ) {
                LoadingOverlay()
            }
        }
    }

    // Device selection sheet
    if (showDeviceSelector) {
        DeviceSelectionSheet(
            devices = uiState.devices,
            currentDeviceId = uiState.selectedDevice?.id,
            onDeviceSelected = { device ->
                viewModel.setDevice(device)
                showDeviceSelector = false
            },
            onDismiss = { showDeviceSelector = false }
        )
    }

    // Segment details dialog
    if (selectedAnalysisSegment != null) {
        AlertDialog(
            onDismissRequest = { selectedAnalysisSegment = null },
            title = { Text(text = "Інформація про сегмент") },
            text = {
                Column {
                    val timeFormatter = java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss")
                    Text("Час: ${selectedAnalysisSegment!!.startTime.format(timeFormatter)} - ${selectedAnalysisSegment!!.endTime.format(timeFormatter)}")
                    Spacer(Modifier.height(8.dp))
                    Text("Тривалість: ${selectedAnalysisSegment!!.formattedDuration()}")
                    Text("Точок: ${selectedAnalysisSegment!!.count}")
                    Spacer(Modifier.height(8.dp))
                    Text("Проблеми:", fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
                    Text(selectedAnalysisSegment!!.issuesLabel())
                    
                    // Detailed stats
                    selectedAnalysisSegment!!.stats?.let { stats ->
                        Spacer(Modifier.height(8.dp))
                        Text("Деталі:", fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
                        stats.avgSpeed?.let { Text("Сер. швидкість: ${String.format("%.1f", it)} км/год") }
                        stats.maxSpeed?.let { Text("Макс. швидкість: ${String.format("%.1f", it)} км/год") }
                        stats.avgVoltage?.let { Text("Сер. напруга: ${String.format("%.1f", it)} V") }
                        stats.avgSatellites?.let { Text("Сер. супутників: ${String.format("%.1f", it)}") }
                        stats.distanceTraveled?.let { Text("Відстань: ${String.format("%.1f", it)} м") }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { selectedAnalysisSegment = null }) {
                    Text("Закрити")
                }
            }
        )
    }
}

/**
 * Bottom sheet content with device selector, date pickers, and track mode toggle.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MapBottomSheetContent(
    selectedDevice: Device?,
    dateFrom: LocalDateTime,
    dateTo: LocalDateTime,
    trackMode: TrackMode,
    isLoading: Boolean,
    totalMileageKm: Double?,
    showDirection: Boolean,
    onShowDeviceSelector: () -> Unit,
    onDateRangeChanged: (LocalDateTime, LocalDateTime) -> Unit,
    onTrackModeChanged: (TrackMode) -> Unit,
    onToggleDirection: (Boolean) -> Unit,
    onRefresh: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
    ) {
        // Device selector
        Text(
            text = stringResource(R.string.map_device),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(4.dp))

        // Device selector card
        DeviceSelectorCard(
            selectedDevice = selectedDevice,
            onClick = onShowDeviceSelector
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Date range selectors
        Text(
            text = stringResource(R.string.map_date_range),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(4.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            DateTimeButton(
                label = stringResource(R.string.map_from_date),
                dateTime = dateFrom,
                onDateTimeSelected = { newFrom ->
                    onDateRangeChanged(newFrom, dateTo)
                },
                modifier = Modifier.weight(1f),
                isFromDate = true
            )

            DateTimeButton(
                label = stringResource(R.string.map_to_date),
                dateTime = dateTo,
                onDateTimeSelected = { newTo ->
                    onDateRangeChanged(dateFrom, newTo)
                },
                modifier = Modifier.weight(1f),
                isFromDate = false
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Track mode toggle
        Text(
            text = stringResource(R.string.map_track_mode),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(4.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            FilterChip(
                selected = trackMode == TrackMode.MILEAGE,
                onClick = { if (selectedDevice != null) onTrackModeChanged(TrackMode.MILEAGE) },
                label = { Text(stringResource(R.string.track_mode_mileage)) },
                enabled = selectedDevice != null,
                leadingIcon = if (trackMode == TrackMode.MILEAGE) {
                    { Icon(Icons.Default.Timeline, contentDescription = null, Modifier.size(16.dp)) }
                } else null,
                modifier = Modifier.weight(1f)
            )

            FilterChip(
                selected = trackMode == TrackMode.RAW,
                onClick = { if (selectedDevice != null) onTrackModeChanged(TrackMode.RAW) },
                label = { Text(stringResource(R.string.track_mode_raw)) },
                enabled = selectedDevice != null,
                leadingIcon = if (trackMode == TrackMode.RAW) {
                    { Icon(Icons.Default.Timeline, contentDescription = null, Modifier.size(16.dp)) }
                } else null,
                modifier = Modifier.weight(1f)
            )

            val analysisColor = if (trackMode == TrackMode.ANALYSIS) 
                MaterialTheme.colorScheme.primaryContainer 
            else 
                MaterialTheme.colorScheme.surface

            FilterChip(
                selected = trackMode == TrackMode.ANALYSIS,
                onClick = { if (selectedDevice != null) onTrackModeChanged(TrackMode.ANALYSIS) },
                label = { Text("Analysis") }, // TODO: Add string resource
                enabled = selectedDevice != null,
                leadingIcon = if (trackMode == TrackMode.ANALYSIS) {
                    { Icon(Icons.Default.Assessment, contentDescription = null, Modifier.size(16.dp)) }
                } else null,
                modifier = Modifier.weight(1f)
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Refresh button
        Button(
            onClick = onRefresh,
            enabled = selectedDevice != null && !isLoading,
            modifier = Modifier.fillMaxWidth()
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary
                )
                Spacer(modifier = Modifier.width(8.dp))
            } else {
                Icon(
                    imageVector = Icons.Default.Refresh,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
            }
            Text(stringResource(R.string.map_load_track))
        }

        // Mileage display
        if (totalMileageKm != null) {
            Spacer(modifier = Modifier.height(12.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        color = MaterialTheme.colorScheme.primaryContainer,
                        shape = RoundedCornerShape(8.dp)
                    )
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Timeline,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = stringResource(R.string.map_mileage).format(totalMileageKm),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }

        Spacer(modifier = Modifier.height(8.dp))
    }
}

/**
 * Clickable card for device selection.
 * Shows currently selected device info or placeholder text.
 */
@Composable
private fun DeviceSelectorCard(
    selectedDevice: Device?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .border(
                width = 1.dp,
                color = MaterialTheme.colorScheme.outline,
                shape = RoundedCornerShape(4.dp)
            )
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = Icons.Default.DirectionsCar,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(24.dp)
        )

        Spacer(modifier = Modifier.width(12.dp))

        Column(
            modifier = Modifier.weight(1f)
        ) {
            if (selectedDevice != null) {
                Text(
                    text = selectedDevice.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "${selectedDevice.fleetName} • ${selectedDevice.model ?: "No Model"} • ID: ${selectedDevice.id}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            } else {
                Text(
                    text = stringResource(R.string.map_select_device),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        Icon(
            imageVector = Icons.Default.KeyboardArrowDown,
            contentDescription = stringResource(R.string.map_select_device),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * Date and time picker button.
 * @param isFromDate If true, sets time to 00:00 when date changes. If false, sets to 23:59.
 */
@Composable
private fun DateTimeButton(
    label: String,
    dateTime: LocalDateTime,
    onDateTimeSelected: (LocalDateTime) -> Unit,
    modifier: Modifier = Modifier,
    isFromDate: Boolean = true
) {
    val context = LocalContext.current
    val dateFormatter = remember { DateTimeFormatter.ofPattern("dd.MM.yyyy") }
    val timeFormatter = remember { DateTimeFormatter.ofPattern("HH:mm") }

    OutlinedButton(
        onClick = {
            // Show date picker first
            DatePickerDialog(
                context,
                { _, year, month, dayOfMonth ->
                    val selectedDate = LocalDate.of(year, month + 1, dayOfMonth)
                    val currentDate = dateTime.toLocalDate()
                    
                    // If date changed, use default time (00:00 for "from", 23:59 for "to")
                    val defaultTime = if (selectedDate != currentDate) {
                        if (isFromDate) LocalTime.of(0, 0) else LocalTime.of(23, 59)
                    } else {
                        dateTime.toLocalTime()
                    }
                    
                    // Then show time picker with appropriate default
                    TimePickerDialog(
                        context,
                        { _, hourOfDay, minute ->
                            val newDateTime = LocalDateTime.of(year, month + 1, dayOfMonth, hourOfDay, minute)
                            onDateTimeSelected(newDateTime)
                        },
                        defaultTime.hour,
                        defaultTime.minute,
                        true
                    ).show()
                },
                dateTime.year,
                dateTime.monthValue - 1,
                dateTime.dayOfMonth
            ).show()
        },
        modifier = modifier
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = dateTime.format(dateFormatter),
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = dateTime.format(timeFormatter),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * Loading overlay with spinner.
 */
@Composable
private fun LoadingOverlay() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.7f)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(48.dp),
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = stringResource(R.string.map_loading_track),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }
}

/**
 * Converts mileage segments to map polylines.
 * Moving segments are blue, stopped/gaps are red.
 * Adds red gap lines between segments if distance > 10 meters.
 */
private fun convertMileageToPolylines(segments: List<MileageSegment>): List<MapPolyline> {
    android.util.Log.d("MapScreen", "Converting ${segments.size} mileage segments to polylines")
    
    val polylines = mutableListOf<MapPolyline>()
    
    for (i in segments.indices) {
        val segment = segments[i]
        
        // Add the normal segment polyline
        polylines.add(
            MapPolyline(
                points = segment.coordinates.map { latLng ->
                    GeoPoint(latLng.latitude, latLng.longitude)
                },
                color = if (segment.isMoving) TrackColors.MILEAGE else TrackColors.RAW_STOPPED,
                width = if (segment.isMoving) 6f else 4f,
                title = if (segment.isMoving) "Moving" else "Stopped"
            )
        )
        
        // If there's a next segment, check for gap
        if (i < segments.size - 1) {
            val nextSegment = segments[i + 1]
            if (segment.coordinates.isNotEmpty() && nextSegment.coordinates.isNotEmpty()) {
                val endPoint = segment.coordinates.last()
                val startPoint = nextSegment.coordinates.first()
                
                // Calculate distance in meters
                val distance = calculateDistanceMeters(endPoint, startPoint)
                
                // If gap > 10 meters, draw red dashed line
                if (distance > 10.0) {
                    polylines.add(
                        MapPolyline(
                            points = listOf(
                                GeoPoint(endPoint.latitude, endPoint.longitude),
                                GeoPoint(startPoint.latitude, startPoint.longitude)
                            ),
                            color = TrackColors.GAP,
                            width = 4f,
                            title = "Gap",
                            isDashed = true,
                            dashPattern = floatArrayOf(10f, 5f)
                        )
                    )
                }
            }
        }
    }

    // Add start/end markers to first and last non-empty polyline
    val firstIdx = polylines.indexOfFirst { it.points.isNotEmpty() }
    val lastIdx = polylines.indexOfLast { it.points.isNotEmpty() }
    if (firstIdx >= 0) {
        polylines[firstIdx] = polylines[firstIdx].copy(showStartMarker = true)
    }
    if (lastIdx >= 0) {
        polylines[lastIdx] = polylines[lastIdx].copy(showEndMarker = true)
    }
    
    val totalPoints = polylines.sumOf { it.points.size }
    val nonEmptyPolylines = polylines.count { it.points.isNotEmpty() }
    android.util.Log.d("MapScreen", "Created $nonEmptyPolylines non-empty polylines with $totalPoints total points")
    
    if (polylines.isNotEmpty() && totalPoints == 0) {
        android.util.Log.e("MapScreen", "WARNING: All mileage segments have empty coordinates!")
    }
    
    return polylines
}

/**
 * Calculates distance between two LatLng points in meters using Haversine formula.
 */
private fun calculateDistanceMeters(point1: LatLng, point2: LatLng): Double {
    val earthRadius = 6371000.0 // meters
    val dLat = Math.toRadians(point2.latitude - point1.latitude)
    val dLon = Math.toRadians(point2.longitude - point1.longitude)
    val lat1 = Math.toRadians(point1.latitude)
    val lat2 = Math.toRadians(point2.latitude)
    
    val a = kotlin.math.sin(dLat / 2) * kotlin.math.sin(dLat / 2) +
            kotlin.math.sin(dLon / 2) * kotlin.math.sin(dLon / 2) *
            kotlin.math.cos(lat1) * kotlin.math.cos(lat2)
    val c = 2 * kotlin.math.atan2(kotlin.math.sqrt(a), kotlin.math.sqrt(1 - a))
    return earthRadius * c
}

/**
 * Converts raw track points to map polylines.
 */
private fun convertRawTrackToPolylines(points: List<TrackPoint>): List<MapPolyline> {
    // In new design, Raw Track is displayed as points, not updateLines
    return emptyList()
}

/**
 * Converts analysis segments to map polylines.
 */
private fun convertAnalysisSegmentsToPolylines(segments: List<TrackSegment>): List<MapPolyline> {
    return segments.map { segment ->
        MapPolyline(
            points = segment.points.map { GeoPoint(it.latitude, it.longitude) },
            color = segment.primaryIssue().color,
            width = 6f,
            title = segment.primaryIssue().displayName,
            trackSegment = segment
        )
    }
}




/**
 * Converts anomalies to map polylines with appropriate styling.
 * 
 * Visual representation (from web anomalies.js):
 * | Type         | Color           | Style            |
 * |--------------|-----------------|------------------|
 * | Time Gap     | Red (#ff4136)   | Dashed (8,6)     |
 * | Speed Spike  | Yellow (#ffdc00)| Dashed (6,4)     |
 * | Position Jump| Red (#ff4136)   | Dashed (10,5)    |
 * | Out of Bounds| Purple (#800080)| Solid            |
 */
private fun convertAnomaliesToPolylines(anomalies: List<Anomaly>): List<MapPolyline> {
    if (anomalies.isEmpty()) return emptyList()
    
    android.util.Log.d("MapScreen", "Converting ${anomalies.size} anomalies to polylines")
    
    return anomalies.mapNotNull { anomaly ->
        val startPoint = GeoPoint(anomaly.startPoint.latitude, anomaly.startPoint.longitude)
        val endPoint = GeoPoint(anomaly.endPoint.latitude, anomaly.endPoint.longitude)
        
        // Skip if start and end are the same (single point anomaly like OUT_OF_BOUNDS)
        val points = if (startPoint.latitude == endPoint.latitude && 
                        startPoint.longitude == endPoint.longitude) {
            listOf(startPoint)
        } else {
            listOf(startPoint, endPoint)
        }
        
        // Don't create polyline for single-point anomalies
        if (points.size < 2) {
            android.util.Log.d("MapScreen", "Skipping single-point anomaly: ${anomaly.type}")
            return@mapNotNull null
        }
        
        val (color, isDashed, dashPattern) = when (anomaly.type) {
            AnomalyType.TIME_GAP -> Triple(
                TrackColors.ANOMALY_TIME_GAP,
                true,
                AnomalyDashPatterns.TIME_GAP
            )
            AnomalyType.SPEED_SPIKE -> Triple(
                TrackColors.ANOMALY_SPEED_SPIKE,
                true,
                AnomalyDashPatterns.SPEED_SPIKE
            )
            AnomalyType.POSITION_JUMP -> Triple(
                TrackColors.ANOMALY_POSITION_JUMP,
                true,
                AnomalyDashPatterns.POSITION_JUMP
            )
            AnomalyType.OUT_OF_BOUNDS -> Triple(
                TrackColors.ANOMALY_OUT_OF_BOUNDS,
                false,
                AnomalyDashPatterns.OUT_OF_BOUNDS
            )
        }
        
        MapPolyline(
            points = points,
            color = color,
            width = 5f,
            title = anomaly.description,
            isDashed = isDashed,
            dashPattern = dashPattern,
            anomalyType = anomaly.type,
            anomaly = anomaly
        )
    }
}
