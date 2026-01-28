package com.scmv.android.domain.model

import java.time.LocalDateTime

enum class AnomalyType {
    TIME_GAP,
    SPEED_SPIKE,
    POSITION_JUMP,
    OUT_OF_BOUNDS
}

data class Anomaly(
    val type: AnomalyType,
    val startPoint: TrackPoint,
    val endPoint: TrackPoint,
    val description: String,
    val value: Double? = null,  // distance in meters or speed in km/h
    val pointIndex: Int = -1    // index of the point in the original track list
)

/**
 * Represents a group of consecutive anomalies of the same type.
 * Used for UI display to avoid showing 100+ individual anomalies.
 */
data class GroupedAnomaly(
    val type: AnomalyType,
    val anomalies: List<Anomaly>,
    val startPoint: TrackPoint,
    val endPoint: TrackPoint
) {
    val count: Int get() = anomalies.size
    val isGrouped: Boolean get() = anomalies.size > 1
    val firstAnomaly: Anomaly get() = anomalies.first()
    val lastAnomaly: Anomaly get() = anomalies.last()
    
    /**
     * Get aggregated description for the group.
     */
    fun getGroupDescription(): String {
        return when {
            anomalies.size == 1 -> anomalies.first().description
            else -> {
                // Calculate total/average value based on type
                val values = anomalies.mapNotNull { it.value }
                when (type) {
                    AnomalyType.TIME_GAP -> {
                        val total = values.sum()
                        "Розрив часу: %.1f хв (сума)".format(total)
                    }
                    AnomalyType.SPEED_SPIKE -> {
                        val max = values.maxOrNull() ?: 0.0
                        "Макс. швидкість: %.1f км/год".format(max)
                    }
                    AnomalyType.POSITION_JUMP -> {
                        val total = values.sum()
                        "Стрибок позиції: %.0f м (сума)".format(total)
                    }
                    AnomalyType.OUT_OF_BOUNDS -> {
                        "Точки за межами: ${anomalies.size}"
                    }
                }
            }
        }
    }
}
