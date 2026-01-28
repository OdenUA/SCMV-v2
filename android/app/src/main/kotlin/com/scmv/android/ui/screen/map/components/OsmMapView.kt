package com.scmv.android.ui.screen.map.components

import android.content.Context
import android.graphics.Color
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import org.osmdroid.config.Configuration
import org.osmdroid.events.MapListener
import org.osmdroid.events.ScrollEvent
import org.osmdroid.events.ZoomEvent
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.FolderOverlay
import org.osmdroid.views.overlay.Polyline
import org.osmdroid.views.overlay.Marker
import com.scmv.android.domain.model.Anomaly
import com.scmv.android.domain.model.AnomalyType
import com.scmv.android.domain.model.TrackPoint
import com.scmv.android.domain.model.StopPoint
import com.scmv.android.domain.model.TrackSegment
import com.scmv.android.ui.screen.map.TrackMode
import java.time.Duration
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Data class representing a polyline to be drawn on the map.
 *
 * @param points List of GeoPoints forming the polyline
 * @param color Color of the polyline (ARGB)
 * @param width Width of the polyline in pixels
 * @param title Optional title for the polyline
 * @param showStartMarker Show green marker at start point
 * @param showEndMarker Show red marker at end point
 * @param isDashed Whether to draw the polyline as dashed
 * @param dashPattern Float array for dash pattern [dash, gap], null for solid
 * @param anomalyType Optional anomaly type for styling
 * @param anomaly Optional anomaly reference for click handling
 * @param trackSegment Optional track segment reference for click handling
 */
data class MapPolyline(
    val points: List<GeoPoint>,
    val color: Int,
    val width: Float = 6f,
    val title: String? = null,
    val showStartMarker: Boolean = false,
    val showEndMarker: Boolean = false,
    val showDirection: Boolean = false,
    val isDashed: Boolean = false,
    val dashPattern: FloatArray? = null,
    val anomalyType: AnomalyType? = null,
    val anomaly: Anomaly? = null,
    val trackSegment: TrackSegment? = null
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as MapPolyline
        if (points != other.points) return false
        if (color != other.color) return false
        if (width != other.width) return false
        if (title != other.title) return false
        if (showStartMarker != other.showStartMarker) return false
        if (showEndMarker != other.showEndMarker) return false
        if (showDirection != other.showDirection) return false
        if (isDashed != other.isDashed) return false
        if (dashPattern != null) {
            if (other.dashPattern == null) return false
            if (!dashPattern.contentEquals(other.dashPattern)) return false
        } else if (other.dashPattern != null) return false
        if (anomalyType != other.anomalyType) return false
        if (anomaly != other.anomaly) return false
        if (trackSegment != other.trackSegment) return false
        return true
    }

    override fun hashCode(): Int {
        var result = points.hashCode()
        result = 31 * result + color
        result = 31 * result + width.hashCode()
        result = 31 * result + (title?.hashCode() ?: 0)
        result = 31 * result + showStartMarker.hashCode()
        result = 31 * result + showEndMarker.hashCode()
        result = 31 * result + showDirection.hashCode()
        result = 31 * result + isDashed.hashCode()
        result = 31 * result + (dashPattern?.contentHashCode() ?: 0)
        result = 31 * result + (anomalyType?.hashCode() ?: 0)
        result = 31 * result + (anomaly?.hashCode() ?: 0)
        result = 31 * result + (trackSegment?.hashCode() ?: 0)
        return result
    }
}

/**
 * Controller class for managing OSMdroid MapView operations.
 * Provides functions to control the map programmatically.
 * 
 * Direction arrows are drawn at fixed pixel intervals along polylines,
 * matching the web version's Leaflet polylineDecorator behavior.
 */
class OsmMapController(private val mapView: MapView) {
    
    /** Folder overlay for direction arrows - allows quick clear and redraw */
    private val arrowOverlay = FolderOverlay()
    
    /** Cached polylines for arrow recalculation on map events */
    private var cachedPolylines: List<MapPolyline> = emptyList()
    
    /** Cached raw track points for arrow calculation in RAW mode */
    private var cachedRawTrackPoints: List<TrackPoint> = emptyList()
    
    /** Whether direction arrows should be shown */
    private var showDirectionArrows: Boolean = false
    
    /** Cached arrow bitmap to avoid recreation */
    private var arrowBitmap: Bitmap? = null
    
    /** Current arrow size in pixels */
    private var currentArrowSize: Float = DirectionArrowUtils.Config.DEFAULT_ARROW_SIZE_PX
    
    /** Debounce handler for arrow updates */
    private var arrowUpdateRunnable: Runnable? = null
    
    /** Coroutine scope for background arrow calculation */
    private val arrowScope = CoroutineScope(Dispatchers.Default)
    
    /** Current arrow calculation job (for cancellation) */
    private var arrowCalculationJob: Job? = null
    
    /** Persistent anomaly marker (similar to web's _trackNearestMarker) */
    private var anomalyMarker: Marker? = null
    
    /** Cache for detecting if polylines have changed (to skip redundant redraws) */
    private var lastPolylinesHashCode: Int = 0
    private var lastStopsHashCode: Int = 0
    private var lastTrackLineWidth: Float = 0f
    private var lastStopMarkerSize: Int = 0
    
    /** Map listener for scroll/zoom events to update arrows */
    private val mapListener = object : MapListener {
        override fun onScroll(event: ScrollEvent?): Boolean {
            if (showDirectionArrows && (cachedPolylines.isNotEmpty() || cachedRawTrackPoints.isNotEmpty())) {
                scheduleArrowUpdate()
            }
            return false
        }
        
        override fun onZoom(event: ZoomEvent?): Boolean {
            if (showDirectionArrows && (cachedPolylines.isNotEmpty() || cachedRawTrackPoints.isNotEmpty())) {
                scheduleArrowUpdate()
            }
            return false
        }
    }
    
    init {
        mapView.addMapListener(mapListener)
    }
    
    /**
     * Schedules an arrow update with debouncing to avoid excessive redraws.
     * Uses a longer debounce during rapid zoom/scroll gestures.
     */
    private fun scheduleArrowUpdate() {
        arrowUpdateRunnable?.let { mapView.removeCallbacks(it) }
        // Cancel any in-progress calculation
        arrowCalculationJob?.cancel()
        arrowUpdateRunnable = Runnable {
            updateDirectionArrows()
        }
        mapView.postDelayed(arrowUpdateRunnable, DirectionArrowUtils.Config.DEBOUNCE_DELAY_MS)
    }
    
    /**
     * Cancels any pending arrow updates.
     * Called when pausing to prevent updates during navigation.
     */
    fun cancelPendingUpdates() {
        arrowUpdateRunnable?.let { mapView.removeCallbacks(it) }
        arrowUpdateRunnable = null
        arrowCalculationJob?.cancel()
        arrowCalculationJob = null
    }
    
    /**
     * Updates direction arrows based on current map projection.
     * Called when map is scrolled or zoomed.
     * 
     * Arrow calculation is performed on a background thread to prevent UI freezing.
     * Only processes visible segments to optimize performance.
     */
    private fun updateDirectionArrows() {
        if (!showDirectionArrows) return
        
        // Check if we have data for arrows (polylines or raw track points)
        val hasPolylineData = cachedPolylines.isNotEmpty()
        val hasRawData = cachedRawTrackPoints.isNotEmpty()
        
        if (!hasPolylineData && !hasRawData) return
        
        // Get current viewport bounding box for filtering
        val boundingBox = mapView.boundingBox ?: return
        
        // For RAW mode, create a virtual polyline from raw track points
        val eligiblePolylines: List<List<GeoPoint>> = if (hasRawData && !hasPolylineData) {
            // Convert raw track points to GeoPoints
            val geoPoints = cachedRawTrackPoints.map { GeoPoint(it.latitude, it.longitude) }
            if (geoPoints.size >= 2) listOf(geoPoints) else emptyList()
        } else {
            // Filter eligible polylines (skip gaps and anomalies)
            cachedPolylines.filter { polylineData ->
                !shouldSkipArrows(polylineData) && polylineData.points.size >= 2
            }.map { it.points }
        }
        
        // Early exit if no eligible polylines
        if (eligiblePolylines.isEmpty()) {
            arrowOverlay.items?.clear()
            mapView.invalidate()
            return
        }
        
        // Ensure arrow bitmap is created with current size
        if (arrowBitmap == null) {
            arrowBitmap = DirectionArrowUtils.createArrowBitmap(
                sizePx = currentArrowSize,
                color = Color.BLACK
            )
        }
        
        val bitmap = arrowBitmap ?: return
        val totalBudget = DirectionArrowUtils.Config.MAX_TOTAL_ARROWS
        
        // Cancel previous calculation if still running
        arrowCalculationJob?.cancel()
        
        // Calculate arrows on background thread
        arrowCalculationJob = arrowScope.launch {
            val allArrowPositions = mutableListOf<DirectionArrowUtils.ArrowPosition>()
            var remainingBudget = totalBudget
            
            // Filter each polyline to only visible segments first
            val visiblePolylines = eligiblePolylines.mapNotNull { points ->
                val visiblePoints = DirectionArrowUtils.filterVisibleSegments(
                    points = points,
                    boundingBox = boundingBox
                )
                if (visiblePoints.size >= 2) visiblePoints else null
            }
            
            if (visiblePolylines.isEmpty()) {
                withContext(Dispatchers.Main) {
                    arrowOverlay.items?.clear()
                    mapView.invalidate()
                }
                return@launch
            }
            
            val budgetPerPolyline = (totalBudget / visiblePolylines.size).coerceAtLeast(50)
            
            for (visiblePoints in visiblePolylines) {
                if (remainingBudget <= 0) break
                
                val maxForThisPolyline = minOf(budgetPerPolyline, remainingBudget)
                
                // Calculate arrows for visible segments only
                val arrowPositions = withContext(Dispatchers.Main) {
                    // Projection must be accessed on main thread
                    DirectionArrowUtils.calculateArrowPositions(
                        points = visiblePoints,
                        mapView = mapView,
                        intervalPx = DirectionArrowUtils.Config.REPEAT_PX,
                        offsetPx = DirectionArrowUtils.Config.OFFSET_PX,
                        maxArrows = maxForThisPolyline
                    )
                }
                
                allArrowPositions.addAll(arrowPositions)
                remainingBudget -= arrowPositions.size
            }
            
            // Update UI on main thread
            withContext(Dispatchers.Main) {
                // Check if still valid (not cancelled, arrows still enabled)
                if (!showDirectionArrows) return@withContext
                
                arrowOverlay.items?.clear()
                
                val arrowDrawable = BitmapDrawable(mapView.resources, bitmap)
                
                allArrowPositions.forEach { (geoPoint, bearing) ->
                    val arrowMarker = Marker(mapView).apply {
                        position = geoPoint
                        setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                        rotation = bearing
                        icon = arrowDrawable
                        setInfoWindow(null) // No info window for arrow markers
                    }
                    arrowOverlay.add(arrowMarker)
                }
                
                mapView.invalidate()
            }
        }
    }
    
    /**
     * Determines if arrows should be skipped for a polyline.
     * Arrows are skipped for gap polylines and anomaly polylines.
     */
    private fun shouldSkipArrows(polyline: MapPolyline): Boolean {
        // Skip if it's an anomaly polyline
        if (polyline.anomalyType != null || polyline.anomaly != null) return true
        
        // Skip gap polylines (check by color)
        if (polyline.color == TrackColors.GAP || 
            polyline.color == TrackColors.RAW_GAP) return true
        
        return false
    }

    /**
     * Sets the center of the map to the specified location.
     *
     * @param latitude Latitude coordinate
     * @param longitude Longitude coordinate
     * @param zoomLevel Zoom level (1-20)
     * @param animated Whether to animate the transition
     */
    fun setCenter(
        latitude: Double,
        longitude: Double,
        zoomLevel: Double = 15.0,
        animated: Boolean = true
    ) {
        val geoPoint = GeoPoint(latitude, longitude)
        mapView.controller.apply {
            if (animated) {
                animateTo(geoPoint, zoomLevel, 500L)
            } else {
                setCenter(geoPoint)
                setZoom(zoomLevel)
            }
        }
    }

    /**
     * Sets the center of the map to the specified GeoPoint.
     *
     * @param point GeoPoint to center on
     * @param zoomLevel Zoom level (1-20)
     * @param animated Whether to animate the transition
     */
    fun setCenter(point: GeoPoint, zoomLevel: Double = 15.0, animated: Boolean = true) {
        setCenter(point.latitude, point.longitude, zoomLevel, animated)
    }

    /**
     * Adds a polyline overlay to the map.
     *
     * @param polylineData The polyline data to add
     * @return The created Polyline overlay
     */
    fun addPolyline(polylineData: MapPolyline): Polyline {
        val polyline = Polyline().apply {
            setPoints(polylineData.points)
            outlinePaint.color = polylineData.color
            outlinePaint.strokeWidth = polylineData.width
            polylineData.title?.let { title = it }
        }
        mapView.overlays.add(polyline)
        mapView.invalidate()
        return polyline
    }

    /**
     * Checks if a full overlay redraw is needed or if only settings changed.
     * Returns true if polylines/stops data changed and full redraw is needed.
     * Returns false if only visual settings changed (can skip heavy redraw).
     */
    fun needsFullRedraw(
        polylines: List<MapPolyline>,
        stops: List<StopPoint>,
        trackLineWidth: Float,
        stopMarkerSize: Int
    ): Boolean {
        val polylinesHash = polylines.hashCode()
        val stopsHash = stops.hashCode()
        
        val dataChanged = polylinesHash != lastPolylinesHashCode || stopsHash != lastStopsHashCode
        val settingsChanged = trackLineWidth != lastTrackLineWidth || stopMarkerSize != lastStopMarkerSize
        
        // Update cached values
        lastPolylinesHashCode = polylinesHash
        lastStopsHashCode = stopsHash
        lastTrackLineWidth = trackLineWidth
        lastStopMarkerSize = stopMarkerSize
        
        // If data changed, full redraw is needed
        // If only settings changed but no data, we can skip (settings will apply on next data load)
        return dataChanged || (settingsChanged && cachedPolylines.isEmpty())
    }

    /**
     * Adds multiple polylines to the map.
     * Also adds start (green) and end (red) markers if requested.
     *
     * @param polylines List of polyline data to add
     * @param trackLineWidth Width of track polylines in pixels
     * @param stopMarkerSize Size of stop markers in pixels
     * @param arrowSize Size of direction arrows in pixels
     */
    /** Overlay for drawing high-performance raw track points */
    private var rawTrackPointsOverlay: RawTrackPointsOverlay? = null

    /**
     * Adds raw track points using a custom high-performance overlay.
     */
    private fun addRawTrackPoints(points: List<TrackPoint>, trackLineWidth: Float) {
        if (points.isEmpty()) return

        if (rawTrackPointsOverlay == null) {
            rawTrackPointsOverlay = RawTrackPointsOverlay(mapView)
            mapView.overlays.add(rawTrackPointsOverlay)
        }
        
        rawTrackPointsOverlay?.setPoints(points, trackLineWidth)
        mapView.invalidate()
    }

    /**
     * Adds multiple polylines to the map.
     * Also adds start (green) and end (red) markers if requested.
     *
     * @param polylines List of polyline data to add
     * @param trackLineWidth Width of track polylines in pixels
     * @param stopMarkerSize Size of stop markers in pixels
     * @param arrowSize Size of direction arrows in pixels
     */
    fun addPolylines(
        polylines: List<MapPolyline>,
        showDirection: Boolean,
        rawTrackPoints: List<TrackPoint>,
        trackMode: TrackMode,
        stops: List<StopPoint>,
        trackLineWidth: Float = 6f,
        stopMarkerSize: Int = 24,
        arrowSize: Float = DirectionArrowUtils.Config.DEFAULT_ARROW_SIZE_PX,
        onSegmentClick: ((TrackSegment) -> Unit)? = null
    ) {
        // If in RAW mode, add points
        if (trackMode == TrackMode.RAW && rawTrackPoints.isNotEmpty()) {
            addRawTrackPoints(rawTrackPoints, trackLineWidth)
        }

        var infoMarker: Marker? = null
        val stopDateFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")

        polylines.forEach { polylineData ->
            // Add polyline with custom line width
            val lineWidth = if (polylineData.anomalyType != null) {
                polylineData.width // Use original width for anomalies
            } else {
                trackLineWidth // Use settings width for regular track
            }
            
            val polyline = Polyline().apply {
                setPoints(polylineData.points)
                outlinePaint.color = polylineData.color
                outlinePaint.strokeWidth = lineWidth
                polylineData.title?.let { title = it }
                
                // Apply dash pattern if specified
                if (polylineData.isDashed && polylineData.dashPattern != null) {
                    outlinePaint.pathEffect = DashPathEffect(polylineData.dashPattern, 0f)
                }

                // Handle regular segment click
                if (polylineData.trackSegment != null && onSegmentClick != null) {
                    setOnClickListener { _, _, _ ->
                        onSegmentClick.invoke(polylineData.trackSegment)
                        true
                    }
                }
            }

            // Handle anomaly polyline click
            if (polylineData.anomaly != null) {
                polyline.setOnClickListener { _, _, _ ->
                    val anomaly = polylineData.anomaly
                    val centerLat = (anomaly.startPoint.latitude + anomaly.endPoint.latitude) / 2
                    val centerLon = (anomaly.startPoint.longitude + anomaly.endPoint.longitude) / 2
                    
                    infoMarker?.let { mapView.overlays.remove(it) }
                    infoMarker = Marker(mapView).apply {
                        position = GeoPoint(centerLat, centerLon)
                        setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                        title = when (anomaly.type) {
                            AnomalyType.TIME_GAP -> "Розрив часу"
                            AnomalyType.SPEED_SPIKE -> "Перевищення швидкості"
                            AnomalyType.POSITION_JUMP -> "Стрибок позиції"
                            AnomalyType.OUT_OF_BOUNDS -> "За межами"
                        }
                        snippet = anomaly.description
                        showInfoWindow()
                    }
                    mapView.overlays.add(infoMarker)
                    mapView.invalidate()
                    true
                }
            }
            mapView.overlays.add(polyline)
            
            // Add start marker (green) - use 24px circle to match stop markers
            if (polylineData.showStartMarker && polylineData.points.isNotEmpty()) {
                val startMarker = Marker(mapView).apply {
                    position = polylineData.points.first()
                    setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                    title = "Початок"
                    icon = BitmapDrawable(mapView.resources, createStartEndCircleBitmap(isStart = true, sizeDp = 24))
                }
                mapView.overlays.add(startMarker)
            }
            
            // Add end marker (red) - use 24px circle to match stop markers
            if (polylineData.showEndMarker && polylineData.points.isNotEmpty()) {
                val endMarker = Marker(mapView).apply {
                    position = polylineData.points.last()
                    setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                    title = "Кінець"
                    icon = BitmapDrawable(mapView.resources, createStartEndCircleBitmap(isStart = false, sizeDp = 24))
                }
                mapView.overlays.add(endMarker)
            }
        }

        // Store polylines and raw track points for arrow recalculation
        cachedPolylines = polylines
        cachedRawTrackPoints = rawTrackPoints
        showDirectionArrows = showDirection
        
        // If arrow size changed, invalidate cached bitmap
        if (currentArrowSize != arrowSize) {
            currentArrowSize = arrowSize
            arrowBitmap = null  // Force recreation with new size
        }
        
        // Add arrow overlay (must be added after polylines for proper z-order)
        if (!mapView.overlays.contains(arrowOverlay)) {
            mapView.overlays.add(arrowOverlay)
        }
        
        // Draw direction arrows if enabled
        // Arrows are drawn at fixed pixel intervals matching web version behavior
        if (showDirection) {
            // Post arrow update to ensure map projection is ready
            mapView.post { updateDirectionArrows() }
        } else {
            arrowOverlay.items?.clear()
        }

        // Add stop markers from mileage response
        stops.forEachIndexed { index, stop ->
            val marker = Marker(mapView).apply {
                position = GeoPoint(stop.position.latitude, stop.position.longitude)
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                title = "Стоянка"
                snippet = buildString {
                    append(stop.startTime.format(stopDateFormatter))
                    append("\nТривалість: ")
                    append(formatDuration(stop.duration))
                }
                icon = BitmapDrawable(mapView.resources, createNumberedCircleBitmap(index + 1, stopMarkerSize))
            }
            mapView.overlays.add(marker)
        }
        mapView.invalidate()
    }

    /**
     * Clears all overlays from the map.
     * Also clears cached polylines and arrow state.
     */
    fun clearOverlays() {
        // Cancel any pending arrow updates
        arrowUpdateRunnable?.let { mapView.removeCallbacks(it) }
        arrowUpdateRunnable = null
        
        // Clear arrow overlay
        arrowOverlay.items?.clear()
        
        // Clear cached state
        cachedPolylines = emptyList()
        cachedRawTrackPoints = emptyList()
        showDirectionArrows = false
        
        // Clear custom overlays
        rawTrackPointsOverlay?.setPoints(emptyList(), 4f)
        rawTrackPointsOverlay = null
        
        // Clear all overlays
        mapView.overlays?.clear()
        mapView.invalidate()
    }

    /**
     * Zooms the map to fit the specified bounding box.
     *
     * @param boundingBox The bounding box to fit
     * @param animated Whether to animate the transition
     */
    fun zoomToBoundingBox(boundingBox: BoundingBox, animated: Boolean = true) {
        mapView.zoomToBoundingBox(boundingBox, animated, 50)
    }

    /**
     * Zooms the map to fit all the given points.
     *
     * @param points List of GeoPoints to fit
     * @param animated Whether to animate the transition
     */
    fun zoomToFitPoints(points: List<GeoPoint>, animated: Boolean = true) {
        if (points.isEmpty()) return

        val latitudes = points.map { it.latitude }
        val longitudes = points.map { it.longitude }

        val boundingBox = BoundingBox(
            latitudes.maxOrNull() ?: 0.0,
            longitudes.maxOrNull() ?: 0.0,
            latitudes.minOrNull() ?: 0.0,
            longitudes.minOrNull() ?: 0.0
        )

        zoomToBoundingBox(boundingBox, animated)
    }

    /**
     * Sets the zoom level of the map.
     *
     * @param zoomLevel Zoom level (1-20)
     */
    fun setZoom(zoomLevel: Double) {
        mapView.controller.setZoom(zoomLevel)
    }

    /**
     * Zooms in the map by one level.
     */
    fun zoomIn() {
        mapView.controller.zoomIn()
    }

    /**
     * Zooms out the map by one level.
     */
    fun zoomOut() {
        mapView.controller.zoomOut()
    }

    /**
     * Focuses on an anomaly and shows a popup with details.
     * Reuses a single persistent marker (moves it to new location).
     *
     * @param anomaly The anomaly to focus on
     * @param animated Whether to animate the transition
     */
    fun focusOnAnomaly(anomaly: Anomaly, animated: Boolean = true) {
        val startPoint = GeoPoint(anomaly.startPoint.latitude, anomaly.startPoint.longitude)
        val endPoint = GeoPoint(anomaly.endPoint.latitude, anomaly.endPoint.longitude)
        
        // Calculate bounding box for the anomaly with padding
        val latMin = minOf(startPoint.latitude, endPoint.latitude)
        val latMax = maxOf(startPoint.latitude, endPoint.latitude)
        val lonMin = minOf(startPoint.longitude, endPoint.longitude)
        val lonMax = maxOf(startPoint.longitude, endPoint.longitude)
        
        // Add padding (20% of span, minimum 0.001 degrees to avoid too close zoom)
        val latPadding = maxOf((latMax - latMin) * 0.2, 0.001)
        val lonPadding = maxOf((lonMax - lonMin) * 0.2, 0.001)
        
        val boundingBox = BoundingBox(
            latMax + latPadding,
            lonMax + lonPadding,
            latMin - latPadding,
            lonMin - lonPadding
        )
        
        // Zoom to fit the anomaly bounds
        zoomToBoundingBox(boundingBox, animated)
        
        val centerLat = (anomaly.startPoint.latitude + anomaly.endPoint.latitude) / 2
        val centerLon = (anomaly.startPoint.longitude + anomaly.endPoint.longitude) / 2
        val centerPoint = GeoPoint(centerLat, centerLon)
        
        // Reuse or create anomaly marker (similar to web's _trackNearestMarker)
        if (anomalyMarker == null) {
            anomalyMarker = Marker(mapView).apply {
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                // Close popup on map click but keep marker visible
                setOnMarkerClickListener { marker, _ ->
                    if (marker.isInfoWindowShown) {
                        marker.closeInfoWindow()
                    } else {
                        marker.showInfoWindow()
                    }
                    true
                }
            }
            mapView.overlays.add(anomalyMarker)
        }
        
        // Update marker position and info
        anomalyMarker?.apply {
            position = centerPoint
            title = when (anomaly.type) {
                AnomalyType.TIME_GAP -> "Розрив часу"
                AnomalyType.SPEED_SPIKE -> "Перевищення швидкості"
                AnomalyType.POSITION_JUMP -> "Стрибок позиції"
                AnomalyType.OUT_OF_BOUNDS -> "За межами"
            }
            snippet = anomaly.description
            closeInfoWindow() // Close previous popup if any
        }
        
        mapView.invalidate()
        
        // Show popup after a short delay to allow animation to complete
        mapView.postDelayed({
            anomalyMarker?.showInfoWindow()
        }, if (animated) 600L else 0L)
    }

    /**
     * Removes the anomaly marker from the map.
     * Similar to web version's behavior when clicking on map outside marker.
     */
    fun removeAnomalyMarker() {
        anomalyMarker?.let { marker ->
            marker.closeInfoWindow()
            mapView.overlays.remove(marker)
            anomalyMarker = null
            mapView.invalidate()
        }
    }

    /**
     * Sets a callback for map click events.
     * Used to remove anomaly marker when user clicks on the map.
     *
     * @param onClick Callback invoked when map is clicked
     */
    fun setOnMapClickListener(onClick: () -> Unit) {
        mapView.setOnClickListener {
            onClick()
            true
        }
    }

    /**
     * Gets the underlying MapView instance.
     */
    fun getMapView(): MapView = mapView
    
    /**
     * Cleans up resources and removes listeners.
     * Should be called when the controller is no longer needed.
     */
    fun cleanup() {
        arrowUpdateRunnable?.let { mapView.removeCallbacks(it) }
        arrowUpdateRunnable = null
        arrowCalculationJob?.cancel()
        arrowCalculationJob = null
        mapView.removeMapListener(mapListener)
        arrowBitmap?.recycle()
        arrowBitmap = null
        cachedPolylines = emptyList()
        arrowOverlay.items?.clear()
    }
}

/**
 * Creates and remembers an OsmMapController.
 *
 * @param context Android context
 * @return Remembered OsmMapController instance
 */
@Composable
fun rememberOsmMapController(context: Context): OsmMapController {
    val mapView = remember {
        MapView(context).apply {
            setTileSource(TileSourceFactory.MAPNIK)
            setMultiTouchControls(true)
            zoomController.setVisibility(org.osmdroid.views.CustomZoomButtonsController.Visibility.NEVER)
            controller.setZoom(10.0)
        }
    }

    return remember(mapView) {
        OsmMapController(mapView)
    }
}

/**
 * Composable wrapper for OSMdroid MapView.
 * Handles lifecycle management and Compose interop.
 *
 * @param modifier Modifier for the map view
 * @param onMapReady Callback when the map is ready with the controller
 * @param polylines List of polylines to draw on the map
 * @param centerOnPoints If true, centers the map on the polyline points
 * @param trackLineWidth Width of track polylines in pixels (2-12)
 * @param stopMarkerSize Size of stop markers in pixels (12-32)
 * @param arrowSize Size of direction arrows in pixels (2-16)
 */
@Composable
fun OsmMapView(
    modifier: Modifier = Modifier,
    onMapReady: ((OsmMapController) -> Unit)? = null,
    polylines: List<MapPolyline> = emptyList(),
    centerOnPoints: Boolean = true,
    showDirection: Boolean = false,
    rawTrackPoints: List<TrackPoint> = emptyList(),
    trackMode: TrackMode = TrackMode.MILEAGE,
    stops: List<StopPoint> = emptyList(),
    trackLineWidth: Float = 6f,
    stopMarkerSize: Int = 24,
    arrowSize: Float = DirectionArrowUtils.Config.DEFAULT_ARROW_SIZE_PX,
    onSegmentClick: ((TrackSegment) -> Unit)? = null
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // Initialize OSMdroid configuration
    DisposableEffect(Unit) {
        Configuration.getInstance().apply {
            userAgentValue = context.packageName
        }
        onDispose { }
    }

    // Create and remember the MapView
    val mapView = remember {
        MapView(context).apply {
            setTileSource(TileSourceFactory.MAPNIK)
            setMultiTouchControls(true)
            zoomController.setVisibility(org.osmdroid.views.CustomZoomButtonsController.Visibility.NEVER)
            controller.setZoom(6.0)
            // Default center: Ukraine
            controller.setCenter(GeoPoint(48.4, 31.2))
        }
    }

    val controller = remember(mapView) { OsmMapController(mapView) }

    // Handle lifecycle with proper cleanup to prevent freezes
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> {
                    try {
                        mapView.onResume()
                    } catch (e: Exception) {
                        android.util.Log.e("OsmMapView", "Error on resume: ${e.message}")
                    }
                }
                Lifecycle.Event.ON_PAUSE -> {
                    try {
                        // Cancel pending arrow updates before pause
                        controller.cancelPendingUpdates()
                        mapView.onPause()
                    } catch (e: Exception) {
                        android.util.Log.e("OsmMapView", "Error on pause: ${e.message}")
                    }
                }
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            try {
                lifecycleOwner.lifecycle.removeObserver(observer)
                // Cleanup must happen before detach
                controller.cleanup()
                mapView.onDetach()
            } catch (e: Exception) {
                android.util.Log.e("OsmMapView", "Error on dispose: ${e.message}")
            }
        }
    }

    // Track data changes separately from settings to avoid redundant redraws
    // Using remember to cache previous values and detect actual changes
    var lastPolylines by remember { mutableStateOf<List<MapPolyline>>(emptyList()) }
    var lastStops by remember { mutableStateOf<List<StopPoint>>(emptyList()) }
    var lastShowDirection by remember { mutableStateOf(false) }
    var lastRawTrackPoints by remember { mutableStateOf<List<TrackPoint>>(emptyList()) }
    var lastTrackMode by remember { mutableStateOf(TrackMode.MILEAGE) }
    var lastTrackLineWidth by remember { mutableStateOf(trackLineWidth) }
    var lastStopMarkerSize by remember { mutableStateOf(stopMarkerSize) }
    var lastArrowSize by remember { mutableStateOf(arrowSize) }
    
    // Determine what changed - separate track data from display options
    val trackDataChanged = polylines != lastPolylines || 
                          rawTrackPoints != lastRawTrackPoints ||
                          trackMode != lastTrackMode
    
    // These don't affect zoom - only visual display
    val displayOptionsChanged = stops != lastStops || 
                               showDirection != lastShowDirection
    
    val settingsChanged = trackLineWidth != lastTrackLineWidth ||
                          stopMarkerSize != lastStopMarkerSize ||
                          arrowSize != lastArrowSize

    // Update polylines when data changes OR when settings change with data loaded
    LaunchedEffect(polylines, showDirection, rawTrackPoints, trackMode, stops, trackLineWidth, stopMarkerSize, arrowSize, onSegmentClick) {
        // Only do full redraw if data changed, or if it's the first load, 
        // or if settings changed AND we have data to redraw
        val needsRedraw = trackDataChanged || displayOptionsChanged || lastPolylines.isEmpty() || (settingsChanged && polylines.isNotEmpty())
        
        if (needsRedraw) {
            // Update cached values
            lastPolylines = polylines
            lastStops = stops
            lastShowDirection = showDirection
            lastRawTrackPoints = rawTrackPoints
            lastTrackMode = trackMode
            lastTrackLineWidth = trackLineWidth
            lastStopMarkerSize = stopMarkerSize
            lastArrowSize = arrowSize
            
            // Skip redraw if returning from settings with no data to show
            // This is the key fix - don't do heavy operations if there's nothing to draw
            if (polylines.isEmpty() && stops.isEmpty() && rawTrackPoints.isEmpty()) {
                android.util.Log.d("OsmMapView", "No data to draw, skipping redraw")
                return@LaunchedEffect
            }
            
             // Perform full redraw
            controller.clearOverlays()
            controller.addPolylines(
                polylines, showDirection, rawTrackPoints, trackMode, stops, 
                trackLineWidth, stopMarkerSize, arrowSize, onSegmentClick
            )

            // Center on points ONLY when actual track data changed (not stops/direction toggle)
            if (centerOnPoints && trackDataChanged) {
                // For RAW mode, use raw track points for centering
                if (trackMode == TrackMode.RAW && rawTrackPoints.isNotEmpty()) {
                    val allPoints = rawTrackPoints.map { GeoPoint(it.latitude, it.longitude) }
                    controller.zoomToFitPoints(allPoints, animated = false)
                } else if (polylines.isNotEmpty()) {
                    val allPoints = polylines.flatMap { it.points }
                    if (allPoints.isNotEmpty()) {
                        controller.zoomToFitPoints(allPoints, animated = false)
                    }
                }
            }
        }
    }

    // Notify when map is ready
    DisposableEffect(controller) {
        onMapReady?.invoke(controller)
        onDispose { }
    }

    AndroidView(
        factory = { mapView },
        modifier = modifier
    )
}

/**
 * Color constants for track visualization.
 */
object TrackColors {
    /** Blue color for mileage track segments (moving) */
    val MILEAGE = Color.BLACK

    /** Red color for gaps in track (stopped/breaks) */
    val GAP = Color.argb(255, 244, 67, 54)

    /** Green color for raw track moving segments */
    val RAW_MOVING = Color.argb(255, 76, 175, 80)

    /** Orange color for raw track stopped segments */
    val RAW_STOPPED = Color.argb(255, 255, 152, 0)

    /** Red color for raw gaps */
    val RAW_GAP = Color.argb(255, 244, 67, 54)

    /** Purple color for anomalies */
    val ANOMALY = Color.argb(255, 156, 39, 176)
    
    // Anomaly colors from web version (anomalies.js)
    /** Red color for time gaps (#ff4136) */
    val ANOMALY_TIME_GAP = Color.argb(255, 255, 65, 54)
    
    /** Yellow color for speed spikes (#ffdc00) */
    val ANOMALY_SPEED_SPIKE = Color.argb(255, 255, 220, 0)
    
    /** Red color for position jumps (#ff4136) */
    val ANOMALY_POSITION_JUMP = Color.argb(255, 255, 65, 54)
    
    /** Purple color for out of bounds (#800080) */
    val ANOMALY_OUT_OF_BOUNDS = Color.argb(255, 128, 0, 128)

    /** Custom blue color for raw track points (#187fda) */
    val RAW_POINT = Color.parseColor("#187fda")
}

/**
 * Dash patterns for anomaly polylines (matching web version).
 */
object AnomalyDashPatterns {
    /** Time Gap: dashed (8,6) */
    val TIME_GAP = floatArrayOf(24f, 18f)  // Scaled for screen density
    
    /** Speed Spike: dashed (6,4) */
    val SPEED_SPIKE = floatArrayOf(18f, 12f)
    
    /** Position Jump: dashed (10,5) */
    val POSITION_JUMP = floatArrayOf(30f, 15f)
    
    /** Out of Bounds: solid (no dash) */
    val OUT_OF_BOUNDS: FloatArray? = null
}

private fun formatDuration(duration: Duration): String {
    val hours = duration.toHours()
    val minutes = duration.toMinutes() % 60
    val seconds = duration.seconds % 60
    return String.format("%02d:%02d:%02d", hours, minutes, seconds)
}

private fun createNumberedCircleBitmap(number: Int, sizeDp: Int = 24): Bitmap {
    // Convert dp to pixels (use 4x scale for crisp rendering)
    val size = sizeDp * 4
    val radius = size / 2f
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)

    val circlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.RED
        style = Paint.Style.FILL
    }
    canvas.drawCircle(radius, radius, radius, circlePaint)

    val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = size * 0.375f  // Scale text relative to circle size
        style = Paint.Style.FILL
    }

    val text = number.toString()
    val bounds = Rect()
    textPaint.getTextBounds(text, 0, text.length, bounds)
    val x = radius - bounds.exactCenterX()
    val y = radius - bounds.exactCenterY()
    canvas.drawText(text, x, y, textPaint)

    return bitmap
}

/**
 * Creates a bitmap for start/end markers.
 * Start marker: Green circle
 * End marker: Red circle
 */
private fun createStartEndCircleBitmap(isStart: Boolean, sizeDp: Int = 24): Bitmap {
    // Convert dp to pixels (use 4x scale for crisp rendering)
    val size = sizeDp * 4
    val radius = size / 2f
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)

    val circlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = if (isStart) Color.GREEN else Color.RED
        style = Paint.Style.FILL
    }
    canvas.drawCircle(radius, radius, radius, circlePaint)

    // Add white border for visibility
    val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = size * 0.08f
    }
    canvas.drawCircle(radius, radius, radius - (size * 0.04f), borderPaint)

    return bitmap
}

/**
 * Custom OSMdroid Overlay for high-performance drawing of thousands of track points.
 * 
 * Performance features:
 * - Uses Canvas.drawCircle directly instead of Marker objects
 * - Viewport filtering (only draws points visible on screen)
 * - Minimum distance filtering (skips points that would overlap at current zoom)
 * - Efficient nearest-neighbor click detection
 */
private class RawTrackPointsOverlay(private val mapView: org.osmdroid.views.MapView) : org.osmdroid.views.overlay.Overlay() {
    private var points: List<TrackPoint> = emptyList()
    private val pointPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = TrackColors.RAW_POINT
        style = Paint.Style.FILL
    }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 2f
    }
    private val clickMarker = Marker(mapView).apply {
        setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
        setInfoWindow(null)
    }
    private val dateTimeFormatter = DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm:ss")
    private var infoMarker: Marker? = null

    private var pointRadius: Float = 4f

    fun setPoints(newPoints: List<TrackPoint>, trackLineWidth: Float) {
        this.points = newPoints
        this.pointRadius = (trackLineWidth * 0.7f).coerceIn(2f, 12f)
        infoMarker?.closeInfoWindow()
        infoMarker = null
    }

    override fun draw(canvas: Canvas, projection: org.osmdroid.views.Projection) {
        if (points.isEmpty()) return

        val screenPoint = android.graphics.Point()
        val boundingBox = mapView.boundingBox
        
        // Draw points with basic thinning optimization
        // Only draw points that are at least 'minDistPixels' apart on screen
        val minDistPixels = 4f
        var lastX = -100f
        var lastY = -100f

        points.forEach { point ->
            // Skip points outside viewport
            if (point.latitude < boundingBox.latSouth || point.latitude > boundingBox.latNorth ||
                point.longitude < boundingBox.lonWest || point.longitude > boundingBox.lonEast) {
                return@forEach
            }

            projection.toPixels(GeoPoint(point.latitude, point.longitude), screenPoint)
            
            val dx = screenPoint.x - lastX
            val dy = screenPoint.y - lastY
            
            // Thinning: skip if too close to last drawn point
            if (dx * dx + dy * dy < minDistPixels * minDistPixels) {
                return@forEach
            }

            canvas.drawCircle(screenPoint.x.toFloat(), screenPoint.y.toFloat(), pointRadius, pointPaint)
            canvas.drawCircle(screenPoint.x.toFloat(), screenPoint.y.toFloat(), pointRadius, borderPaint)
            
            lastX = screenPoint.x.toFloat()
            lastY = screenPoint.y.toFloat()
        }
    }

    override fun onSingleTapConfirmed(e: android.view.MotionEvent, mapView: org.osmdroid.views.MapView): Boolean {
        if (points.isEmpty()) return false

        val projection = mapView.projection
        val tapPoint = projection.fromPixels(e.x.toInt(), e.y.toInt()) as GeoPoint
        
        // Find nearest point within radius (approx 15 pixels)
        val clickRadiusPixels = 20f
        var nearest: TrackPoint? = null
        var minDistanceSq = Double.MAX_VALUE

        val curPoint = android.graphics.Point()
        points.forEach { point ->
            projection.toPixels(GeoPoint(point.latitude, point.longitude), curPoint)
            val dx = e.x - curPoint.x
            val dy = e.y - curPoint.y
            val distSq = (dx * dx + dy * dy).toDouble()
            
            if (distSq < clickRadiusPixels * clickRadiusPixels && distSq < minDistanceSq) {
                minDistanceSq = distSq
                nearest = point
            }
        }

        nearest?.let { point ->
            if (infoMarker == null) {
                infoMarker = Marker(mapView).apply {
                    setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                    // Use a transparent or tiny icon so we don't hide the dot
                    icon = BitmapDrawable(mapView.resources, Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888))
                }
                mapView.overlays.add(infoMarker)
            }
            
            infoMarker?.apply {
                position = GeoPoint(point.latitude, point.longitude)
                title = point.timestamp.format(dateTimeFormatter)
                snippet = "Швидкість: ${String.format("%.1f", point.speed)} км/год"
                showInfoWindow()
            }
            mapView.invalidate()
            return true
        }

        infoMarker?.closeInfoWindow()
        return false
    }
}
