package com.scmv.android.domain.model

import android.graphics.Color
import java.time.Duration
import java.time.LocalDateTime

/**
 * Types of track issues that can be detected during route analysis.
 */
enum class TrackIssueType(
    val displayName: String,
    val color: Int,
    val emoji: String
) {
    /** No issues - normal operation */
    NONE("Без помилок", Color.parseColor("#4CAF50"), "✅"),
    
    /** Low satellite count (< 8) - unreliable GPS */
    LOW_SATELLITES("Мало супутників", Color.parseColor("#FFC107"), "🟡"),
    
    /** Low voltage (< 12V) - power issues */
    LOW_VOLTAGE("Низька напруга", Color.parseColor("#FF9800"), "🟠"),
    
    /** Movement detected without ignition */
    MOVEMENT_WITHOUT_POWER("Рух без живлення", Color.parseColor("#F44336"), "🔴"),
    
    /** Time gap between points > 10 minutes */
    TIME_GAP("Розрив даних", Color.parseColor("#9E9E9E"), "⚫"),
    
    /** Impossible speed (> 200 km/h) based on coordinates */
    SPEED_SPIKE("Стрибок швидкості", Color.parseColor("#9C27B0"), "🟣"),
    
    /** Large altitude change (> 500m) in one sample */
    ALTITUDE_SPIKE("Аномалія висоти", Color.parseColor("#795548"), "🟤"),
    
    /** Speed == 0 but coordinates changed significantly */
    STATIC_MOVING("Статичний рух", Color.parseColor("#607D8B"), "🔵");
    
    companion object {
        /** Threshold for low satellite count */
        const val LOW_SATELLITES_THRESHOLD = 8
        
        /** Threshold for low voltage (volts) */
        const val LOW_VOLTAGE_THRESHOLD = 12
        
        /** Threshold for time gap (minutes) */
        const val TIME_GAP_MINUTES = 10
        
        /** Threshold for impossible speed (km/h) */
        const val SPEED_SPIKE_THRESHOLD = 200.0
        
        /** Threshold for altitude anomaly (meters) */
        const val ALTITUDE_SPIKE_THRESHOLD = 500.0
        
        /** Threshold for static moving detection (meters) */
        const val STATIC_MOVING_DISTANCE_THRESHOLD = 50.0
        
        /** Threshold for movement detection (meters) */
        const val MOVEMENT_DISTANCE_THRESHOLD = 20.0
    }
}

/**
 * Represents a segment of track with a consistent set of issues.
 * Used for displaying condensed event logs.
 */
data class TrackSegment(
    /** Start time of the segment */
    val startTime: LocalDateTime,
    
    /** End time of the segment */
    val endTime: LocalDateTime,
    
    /** Set of issues present in this segment */
    val issues: Set<TrackIssueType>,
    
    /** Track points in this segment */
    val points: List<TrackPoint>,
    
    /** Duration of the segment */
    val duration: Duration,
    
    /** Number of points in the segment */
    val count: Int,
    
    /** Additional stats for display */
    val stats: SegmentStats? = null
) {
    /**
     * Returns the primary (most severe) issue for color selection.
     */
    fun primaryIssue(): TrackIssueType {
        if (issues.isEmpty()) return TrackIssueType.NONE
        
        // Priority order for color selection
        val priority = listOf(
            TrackIssueType.MOVEMENT_WITHOUT_POWER,
            TrackIssueType.LOW_VOLTAGE,
            TrackIssueType.SPEED_SPIKE,
            TrackIssueType.LOW_SATELLITES,
            TrackIssueType.TIME_GAP,
            TrackIssueType.ALTITUDE_SPIKE,
            TrackIssueType.STATIC_MOVING
        )
        
        return priority.firstOrNull { it in issues } ?: TrackIssueType.NONE
    }
    
    /**
     * Returns a formatted duration string.
     */
    fun formattedDuration(): String {
        val hours = duration.toHours()
        val minutes = duration.toMinutes() % 60
        return when {
            hours > 0 -> "${hours} год ${minutes} хв"
            else -> "${minutes} хв"
        }
    }
    
    /**
     * Returns a formatted display label for issues.
     */
    fun issuesLabel(): String {
        if (issues.isEmpty()) return TrackIssueType.NONE.displayName
        
        return issues.joinToString(" + ") { issue ->
            when (issue) {
                TrackIssueType.LOW_VOLTAGE -> {
                    val voltage = stats?.avgVoltage?.let { String.format("%.1fV", it) } ?: ""
                    "${issue.displayName} $voltage".trim()
                }
                TrackIssueType.LOW_SATELLITES -> {
                    val sats = stats?.avgSatellites?.let { String.format("%.1f", it) } ?: ""
                    "${issue.displayName} $sats".trim()
                }
                else -> issue.displayName
            }
        }
    }
}

/**
 * Additional statistics for a segment.
 */
data class SegmentStats(
    val avgSatellites: Double? = null,
    val minSatellites: Int? = null,
    val maxSatellites: Int? = null,
    val avgVoltage: Double? = null,
    val minVoltage: Int? = null,
    val maxVoltage: Int? = null,
    val avgSpeed: Double? = null,
    val maxSpeed: Double? = null,
    val distanceTraveled: Double? = null
)
