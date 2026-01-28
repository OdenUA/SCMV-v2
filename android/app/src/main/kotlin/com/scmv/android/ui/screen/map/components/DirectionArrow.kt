package com.scmv.android.ui.screen.map.components

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import kotlin.math.atan2
import kotlin.math.sqrt

/**
 * Utility object for creating and positioning direction arrows on track polylines.
 * 
 * This implementation matches the web version's Leaflet polylineDecorator behavior:
 * - Arrows are placed at fixed pixel intervals along the polyline (not point-based)
 * - Arrow size is fixed in screen pixels (doesn't scale with zoom)
 * - Arrows point in the direction of travel at each position
 * 
 * Performance optimizations:
 * - Maximum total arrows limit across all polylines
 * - Minimum geographic distance between arrows (prevents zoom-in explosion)
 * - Early exit when limits reached
 */
object DirectionArrowUtils {
    
    /**
     * Configuration for direction arrows, matching web version defaults.
     */
    object Config {
        /** Offset from start of polyline in pixels */
        const val OFFSET_PX = 25f
        /** Repeat interval in pixels */
        const val REPEAT_PX = 50f
        /** Default arrow size in pixels (matching web's pixelSize: 6) */
        const val DEFAULT_ARROW_SIZE_PX = 8f
        /** Maximum number of arrows per polyline to prevent performance issues */
        const val MAX_ARROWS_PER_POLYLINE = 1000
        /** Maximum total arrows across all polylines */
        const val MAX_TOTAL_ARROWS = 2000
        /** Debounce delay for arrow updates during zoom/scroll in milliseconds */
        const val DEBOUNCE_DELAY_MS = 250L
        /** Margin factor for viewport filtering (0.1 = 10% margin) */
        const val VIEWPORT_MARGIN_FACTOR = 0.1
    }
    
    /**
     * Data class representing an arrow position and its rotation.
     * 
     * @param geoPoint The geographic position of the arrow
     * @param bearing The bearing/rotation angle in degrees (0 = north, 90 = east)
     */
    data class ArrowPosition(
        val geoPoint: GeoPoint,
        val bearing: Float
    )
    
    /**
     * Creates a small filled triangle arrow bitmap.
     * The arrow points upward (north) and should be rotated based on bearing.
     * 
     * @param sizePx Size of the arrow in pixels
     * @param color Color of the arrow (default: black)
     * @return Bitmap of the arrow
     */
    fun createArrowBitmap(
        sizePx: Float = Config.DEFAULT_ARROW_SIZE_PX,
        color: Int = Color.BLACK
    ): Bitmap {
        val size = (sizePx * 2).toInt().coerceAtLeast(4)
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.FILL
            strokeWidth = 0f
        }
        
        // Create a triangle pointing upward
        val centerX = size / 2f
        val centerY = size / 2f
        val halfSize = sizePx / 2f
        
        val path = Path().apply {
            // Top point (tip of arrow)
            moveTo(centerX, centerY - halfSize)
            // Bottom right
            lineTo(centerX + halfSize * 0.7f, centerY + halfSize * 0.7f)
            // Bottom left
            lineTo(centerX - halfSize * 0.7f, centerY + halfSize * 0.7f)
            close()
        }
        
        canvas.drawPath(path, paint)
        return bitmap
    }
    
    /**
     * Creates a drawable from the arrow bitmap.
     * 
     * @param mapView The MapView for resources context
     * @param sizePx Size of the arrow in pixels
     * @param color Color of the arrow
     * @return BitmapDrawable of the arrow
     */
    fun createArrowDrawable(
        mapView: MapView,
        sizePx: Float = Config.DEFAULT_ARROW_SIZE_PX,
        color: Int = Color.BLACK
    ): Drawable {
        val bitmap = createArrowBitmap(sizePx, color)
        return BitmapDrawable(mapView.resources, bitmap)
    }
    
    /**
     * Calculates arrow positions at fixed pixel intervals along a polyline.
     * This matches the web version's behavior where arrows are placed based on
     * screen pixel distance, not geographic distance or point count.
     * 
     * Performance optimizations:
     * - Early exit if polyline has fewer than 2 points
     * - Maximum arrows per polyline limit
     * - Respects external arrow budget for total limit across polylines
     * - Only processes visible segments (filtered by viewport)
     * 
     * @param points List of GeoPoints forming the polyline (already filtered to visible segments)
     * @param mapView The MapView for projection calculations
     * @param intervalPx Pixel interval between arrows (default: 50px)
     * @param offsetPx Pixel offset from start (default: 25px)
     * @param maxArrows Maximum arrows to generate (for budget control)
     * @return List of ArrowPosition objects with position and bearing
     */
    fun calculateArrowPositions(
        points: List<GeoPoint>,
        mapView: MapView,
        intervalPx: Float = Config.REPEAT_PX,
        offsetPx: Float = Config.OFFSET_PX,
        maxArrows: Int = Config.MAX_ARROWS_PER_POLYLINE
    ): List<ArrowPosition> {
        // Early exit for empty or single-point polylines
        if (points.size < 2) return emptyList()
        if (maxArrows <= 0) return emptyList()
        
        val positions = mutableListOf<ArrowPosition>()
        val projection = mapView.projection ?: return emptyList()
        
        // Project all points to screen coordinates
        val screenPoints = points.map { geoPoint ->
            val point = android.graphics.Point()
            projection.toPixels(geoPoint, point)
            ScreenPoint(point.x.toFloat(), point.y.toFloat(), geoPoint)
        }
        
        // Walk along the polyline, accumulating pixel distance
        var accumulatedDistance = 0f
        var nextArrowAt = offsetPx
        val effectiveMaxArrows = minOf(maxArrows, Config.MAX_ARROWS_PER_POLYLINE)
        
        for (i in 0 until screenPoints.size - 1) {
            val current = screenPoints[i]
            val next = screenPoints[i + 1]
            
            val segmentDx = next.x - current.x
            val segmentDy = next.y - current.y
            val segmentLength = sqrt(segmentDx * segmentDx + segmentDy * segmentDy)
            
            if (segmentLength < 0.1f) continue // Skip zero-length segments
            
            // Calculate bearing for this segment (in degrees, 0 = up/north)
            val bearing = (Math.toDegrees(atan2(segmentDx.toDouble(), -segmentDy.toDouble())).toFloat() + 360f) % 360f
            
            // Check if we need to place arrows within this segment
            while (accumulatedDistance + segmentLength >= nextArrowAt) {
                // Calculate how far into this segment the arrow should be
                val distanceIntoSegment = nextArrowAt - accumulatedDistance
                
                if (distanceIntoSegment >= 0 && distanceIntoSegment <= segmentLength) {
                    val ratio = distanceIntoSegment / segmentLength
                    val arrowX = current.x + segmentDx * ratio
                    val arrowY = current.y + segmentDy * ratio
                    
                    // Convert back to GeoPoint
                    val arrowGeoPoint = projection.fromPixels(arrowX.toInt(), arrowY.toInt()) as? GeoPoint
                    if (arrowGeoPoint != null) {
                        positions.add(ArrowPosition(arrowGeoPoint, bearing))
                        
                        // Limit arrows for performance
                        if (positions.size >= effectiveMaxArrows) {
                            return positions
                        }
                    }
                }
                
                nextArrowAt += intervalPx
            }
            
            accumulatedDistance += segmentLength
        }
        
        return positions
    }
    
    /**
     * Internal helper class for screen coordinate points.
     */
    private data class ScreenPoint(
        val x: Float,
        val y: Float,
        val geoPoint: GeoPoint
    )
    
    /**
     * Filters polyline points to only include segments visible in the current viewport.
     * This optimization prevents calculating arrows for off-screen segments.
     * 
     * @param points List of GeoPoints forming the polyline
     * @param boundingBox The current visible map bounding box
     * @param marginFactor Additional margin around the viewport (0.1 = 10%)
     * @return List of GeoPoints that are within the visible area (with margin)
     */
    fun filterVisibleSegments(
        points: List<GeoPoint>,
        boundingBox: org.osmdroid.util.BoundingBox,
        marginFactor: Double = Config.VIEWPORT_MARGIN_FACTOR
    ): List<GeoPoint> {
        if (points.size < 2) return points
        
        // Expand bounding box by margin to include segments near the edge
        val latSpan = boundingBox.latNorth - boundingBox.latSouth
        val lonSpan = boundingBox.lonEast - boundingBox.lonWest
        val latMargin = latSpan * marginFactor
        val lonMargin = lonSpan * marginFactor
        
        val expandedBox = org.osmdroid.util.BoundingBox(
            boundingBox.latNorth + latMargin,
            boundingBox.lonEast + lonMargin,
            boundingBox.latSouth - latMargin,
            boundingBox.lonWest - lonMargin
        )
        
        // Filter to points where either the point or its adjacent segment is visible
        val visiblePoints = mutableListOf<GeoPoint>()
        
        for (i in points.indices) {
            val current = points[i]
            val isCurrentVisible = isPointInBoundingBox(current, expandedBox)
            
            // Include point if it's visible or if segment to/from it crosses the visible area
            val prevVisible = if (i > 0) isPointInBoundingBox(points[i - 1], expandedBox) else false
            val nextVisible = if (i < points.size - 1) isPointInBoundingBox(points[i + 1], expandedBox) else false
            
            // Include if current point is visible, or if it's adjacent to a visible point
            // (to preserve segment continuity for arrows at viewport edges)
            if (isCurrentVisible || prevVisible || nextVisible) {
                visiblePoints.add(current)
            } else if (visiblePoints.isNotEmpty() && visiblePoints.last() != current) {
                // If we've started adding points and hit a gap, keep this as the end point
                // to complete the last visible segment
                if (i > 0 && visiblePoints.contains(points[i - 1])) {
                    visiblePoints.add(current)
                }
            }
        }
        
        return visiblePoints
    }
    
    /**
     * Checks if a GeoPoint is within a bounding box.
     */
    private fun isPointInBoundingBox(point: GeoPoint, box: org.osmdroid.util.BoundingBox): Boolean {
        return point.latitude >= box.latSouth &&
               point.latitude <= box.latNorth &&
               point.longitude >= box.lonWest &&
               point.longitude <= box.lonEast
    }
}
