package com.scmv.android.util

import com.scmv.android.domain.model.Anomaly
import com.scmv.android.domain.model.AnomalyType
import com.scmv.android.domain.model.GroupedAnomaly
import com.scmv.android.domain.model.TrackPoint
import java.time.Duration
import kotlin.math.*

object AnomalyDetector {

    /**
     * Detect anomalies in track points
     * Checks for: time gaps, speed spikes, position jumps, out of bounds
     */
    fun detectAnomalies(points: List<TrackPoint>): List<Anomaly> {
        if (points.size < 2) return emptyList()

        val anomalies = mutableListOf<Anomaly>()
        val sortedPoints = points.sortedBy { it.timestamp }

        for (i in 0 until sortedPoints.size - 1) {
            val p1 = sortedPoints[i]
            val p2 = sortedPoints[i + 1]

            // Check out of bounds for each point
            if (i == 0 && isOutOfBounds(p1.latitude, p1.longitude)) {
                anomalies.add(
                    Anomaly(
                        type = AnomalyType.OUT_OF_BOUNDS,
                        startPoint = p1,
                        endPoint = p1,
                        description = "Точка за межами України: ${p1.latitude}, ${p1.longitude}",
                        value = null,
                        pointIndex = i
                    )
                )
            }
            if (isOutOfBounds(p2.latitude, p2.longitude)) {
                anomalies.add(
                    Anomaly(
                        type = AnomalyType.OUT_OF_BOUNDS,
                        startPoint = p2,
                        endPoint = p2,
                        description = "Точка за межами України: ${p2.latitude}, ${p2.longitude}",
                        value = null,
                        pointIndex = i + 1
                    )
                )
            }

            // Check time gap
            val timeDiffMs = Duration.between(p1.timestamp, p2.timestamp).toMillis()
            if (timeDiffMs > Constants.GAP_THRESHOLD_MS) {
                val gapMinutes = timeDiffMs / 60_000.0
                anomalies.add(
                    Anomaly(
                        type = AnomalyType.TIME_GAP,
                        startPoint = p1,
                        endPoint = p2,
                        description = "Розрив часу: %.1f хв".format(gapMinutes),
                        value = gapMinutes,
                        pointIndex = i
                    )
                )
            }

            // Calculate distance and speed between points
            val distance = calculateDistance(p1, p2)
            val calculatedSpeed = calculateSpeed(p1, p2)

            // Check speed spike
            if (calculatedSpeed > Constants.SPEED_THRESHOLD_KPH) {
                anomalies.add(
                    Anomaly(
                        type = AnomalyType.SPEED_SPIKE,
                        startPoint = p1,
                        endPoint = p2,
                        description = "Перевищення швидкості: %.1f км/год".format(calculatedSpeed),
                        value = calculatedSpeed,
                        pointIndex = i
                    )
                )
            }

            // Check position jump - large distance with low reported speed
            if (distance > Constants.POSITION_JUMP_M && 
                p1.speed < Constants.JUMP_SPEED_KPH && 
                p2.speed < Constants.JUMP_SPEED_KPH &&
                calculatedSpeed > Constants.REAL_SPEED_KPH) {
                anomalies.add(
                    Anomaly(
                        type = AnomalyType.POSITION_JUMP,
                        startPoint = p1,
                        endPoint = p2,
                        description = "Стрибок позиції: %.0f м".format(distance),
                        value = distance,
                        pointIndex = i
                    )
                )
            }
        }

        return anomalies
    }

    /**
     * Check if coordinates are outside Ukraine bounds
     */
    private fun isOutOfBounds(lat: Double, lon: Double): Boolean {
        return lat < Constants.MIN_LAT || lat > Constants.MAX_LAT ||
               lon < Constants.MIN_LON || lon > Constants.MAX_LON
    }

    /**
     * Calculate distance between two points using Haversine formula
     * @return distance in meters
     */
    private fun calculateDistance(p1: TrackPoint, p2: TrackPoint): Double {
        val earthRadiusM = 6_371_000.0 // Earth radius in meters

        val lat1Rad = Math.toRadians(p1.latitude)
        val lat2Rad = Math.toRadians(p2.latitude)
        val deltaLatRad = Math.toRadians(p2.latitude - p1.latitude)
        val deltaLonRad = Math.toRadians(p2.longitude - p1.longitude)

        val a = sin(deltaLatRad / 2).pow(2) +
                cos(lat1Rad) * cos(lat2Rad) * sin(deltaLonRad / 2).pow(2)
        val c = 2 * atan2(sqrt(a), sqrt(1 - a))

        return earthRadiusM * c
    }

    /**
     * Calculate speed between two points
     * @return speed in km/h
     */
    private fun calculateSpeed(p1: TrackPoint, p2: TrackPoint): Double {
        val distanceM = calculateDistance(p1, p2)
        val timeDiffMs = Duration.between(p1.timestamp, p2.timestamp).toMillis()

        if (timeDiffMs <= 0) return 0.0

        val timeDiffHours = timeDiffMs / 3_600_000.0
        val distanceKm = distanceM / 1000.0

        return distanceKm / timeDiffHours
    }

    /**
     * Detect anomalies in raw track points with thresholds matching web version.
     * Uses: 5 min gap, 150 km/h speed, 1200m position jump, Ukraine bounds.
     * 
     * Visual representation (from web):
     * | Type         | Color         | Style            |
     * |--------------|---------------|------------------|
     * | Time Gap     | Red (#ff4136) | Dashed (8,6)     |
     * | Speed Spike  | Yellow (#ffdc00) | Dashed (6,4)  |
     * | Position Jump| Red (#ff4136) | Dashed (10,5)    |
     * | Out of Bounds| Purple (#800080) | Solid         |
     */
    fun detectRawTrackAnomalies(points: List<TrackPoint>): List<Anomaly> {
        if (points.size < 2) return emptyList()

        val anomalies = mutableListOf<Anomaly>()
        val sortedPoints = points.sortedBy { it.timestamp }

        for (i in 0 until sortedPoints.size - 1) {
            val p1 = sortedPoints[i]
            val p2 = sortedPoints[i + 1]

            // Check out of bounds for each point
            if (i == 0 && isOutOfBounds(p1.latitude, p1.longitude)) {
                anomalies.add(
                    Anomaly(
                        type = AnomalyType.OUT_OF_BOUNDS,
                        startPoint = p1,
                        endPoint = p1,
                        description = "Точка за межами України: ${String.format("%.4f", p1.latitude)}, ${String.format("%.4f", p1.longitude)}",
                        value = null,
                        pointIndex = i
                    )
                )
            }
            if (isOutOfBounds(p2.latitude, p2.longitude)) {
                anomalies.add(
                    Anomaly(
                        type = AnomalyType.OUT_OF_BOUNDS,
                        startPoint = p2,
                        endPoint = p2,
                        description = "Точка за межами України: ${String.format("%.4f", p2.latitude)}, ${String.format("%.4f", p2.longitude)}",
                        value = null,
                        pointIndex = i + 1
                    )
                )
            }

            // Calculate time difference
            val timeDiffMs = Duration.between(p1.timestamp, p2.timestamp).toMillis()

            // Check time gap (5 minutes for raw track)
            if (timeDiffMs > Constants.RAW_GAP_THRESHOLD_MS) {
                val gapMinutes = timeDiffMs / 60_000.0
                anomalies.add(
                    Anomaly(
                        type = AnomalyType.TIME_GAP,
                        startPoint = p1,
                        endPoint = p2,
                        description = "Розрив часу: %.1f хв".format(gapMinutes),
                        value = gapMinutes,
                        pointIndex = i
                    )
                )
            }

            // Calculate distance and speed between points
            val distance = calculateDistance(p1, p2)
            val calculatedSpeed = calculateSpeed(p1, p2)

            // Check speed spike (150 km/h for raw track)
            if (timeDiffMs > 0 && calculatedSpeed > Constants.RAW_SPEED_THRESHOLD_KPH) {
                anomalies.add(
                    Anomaly(
                        type = AnomalyType.SPEED_SPIKE,
                        startPoint = p1,
                        endPoint = p2,
                        description = "Перевищення швидкості: %.1f км/год".format(calculatedSpeed),
                        value = calculatedSpeed,
                        pointIndex = i
                    )
                )
            }

            // Check position jump (1200m for raw track)
            if (distance >= Constants.RAW_POSITION_JUMP_M) {
                anomalies.add(
                    Anomaly(
                        type = AnomalyType.POSITION_JUMP,
                        startPoint = p1,
                        endPoint = p2,
                        description = "Стрибок позиції: %.0f м".format(distance),
                        value = distance,
                        pointIndex = i
                    )
                )
            }
        }

        return anomalies
    }

    /**
     * Groups consecutive anomalies of the same type into GroupedAnomaly objects.
     * Consecutive means: same type AND adjacent point indices (difference = 1).
     * 
     * @param anomalies List of detected anomalies (should be sorted by pointIndex)
     * @return List of grouped anomalies
     */
    fun groupConsecutiveAnomalies(anomalies: List<Anomaly>): List<GroupedAnomaly> {
        if (anomalies.isEmpty()) return emptyList()
        
        // Sort by point index to ensure proper grouping
        val sortedAnomalies = anomalies.sortedBy { it.pointIndex }
        
        val groups = mutableListOf<GroupedAnomaly>()
        var currentGroup = mutableListOf<Anomaly>()
        
        for (anomaly in sortedAnomalies) {
            if (currentGroup.isEmpty()) {
                currentGroup.add(anomaly)
            } else {
                val lastAnomaly = currentGroup.last()
                // Check if same type AND consecutive (index difference = 1)
                val isConsecutive = anomaly.type == lastAnomaly.type &&
                                   (anomaly.pointIndex - lastAnomaly.pointIndex) == 1
                
                if (isConsecutive) {
                    currentGroup.add(anomaly)
                } else {
                    // Close current group and start new one
                    groups.add(createGroupedAnomaly(currentGroup))
                    currentGroup = mutableListOf(anomaly)
                }
            }
        }
        
        // Don't forget the last group
        if (currentGroup.isNotEmpty()) {
            groups.add(createGroupedAnomaly(currentGroup))
        }
        
        return groups
    }
    
    private fun createGroupedAnomaly(anomalies: List<Anomaly>): GroupedAnomaly {
        return GroupedAnomaly(
            type = anomalies.first().type,
            anomalies = anomalies,
            startPoint = anomalies.first().startPoint,
            endPoint = anomalies.last().endPoint
        )
    }
}
