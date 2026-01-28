package com.scmv.android.domain.analyzer

import com.scmv.android.domain.model.SegmentStats
import com.scmv.android.domain.model.TrackIssueType
import com.scmv.android.domain.model.TrackPoint
import com.scmv.android.domain.model.TrackSegment
import java.time.Duration
import kotlin.math.*

/**
 * Analyzes track points to detect anomalies and generate condensed event segments.
 */
object TrackAnalyzer {
    
    /**
     * Analyzes a list of track points and returns segments grouped by issue type.
     * Points should be sorted by timestamp (oldest first).
     * 
     * @param points List of track points to analyze (sorted by timestamp ascending)
     * @return List of track segments with detected issues
     */
    fun analyze(points: List<TrackPoint>): List<TrackSegment> {
        if (points.isEmpty()) return emptyList()
        if (points.size == 1) {
            val issues = detectIssuesForPoint(points[0], null)
            return listOf(
                TrackSegment(
                    startTime = points[0].timestamp,
                    endTime = points[0].timestamp,
                    issues = issues,
                    points = points,
                    duration = Duration.ZERO,
                    count = 1,
                    stats = calculateStats(points)
                )
            )
        }
        
        // Ensure points are sorted by timestamp (oldest first)
        val sortedPoints = points.sortedBy { it.timestamp }
        
        // Detect issues for each point
        val pointsWithIssues = mutableListOf<Pair<TrackPoint, Set<TrackIssueType>>>()
        
        for (i in sortedPoints.indices) {
            val prev = if (i > 0) sortedPoints[i - 1] else null
            val current = sortedPoints[i]
            val issues = detectIssuesForPoint(current, prev)
            pointsWithIssues.add(current to issues)
        }
        
        // Group consecutive points with same issues into segments
        return groupIntoSegments(pointsWithIssues)
    }
    
    /**
     * Detects issues for a single point, considering previous point for context.
     */
    private fun detectIssuesForPoint(current: TrackPoint, prev: TrackPoint?): Set<TrackIssueType> {
        val issues = mutableSetOf<TrackIssueType>()
        
        // 1. Low satellites
        current.satellites?.let { satellites ->
            if (satellites < TrackIssueType.LOW_SATELLITES_THRESHOLD) {
                issues.add(TrackIssueType.LOW_SATELLITES)
            }
        }
        
        // 2. Low voltage
        current.voltage?.let { voltage ->
            if (voltage < TrackIssueType.LOW_VOLTAGE_THRESHOLD) {
                issues.add(TrackIssueType.LOW_VOLTAGE)
            }
        }
        
        // Context-dependent checks (need previous point)
        if (prev != null) {
            val timeDelta = Duration.between(prev.timestamp, current.timestamp)
            
            // 3. Time gap
            if (timeDelta.toMinutes() > TrackIssueType.TIME_GAP_MINUTES) {
                issues.add(TrackIssueType.TIME_GAP)
            }
            
            // Calculate distance between points
            val distance = haversineDistance(
                prev.latitude, prev.longitude,
                current.latitude, current.longitude
            )
            
            // 4. Movement without power
            val ignition = current.ignition ?: true
            val isMoving = current.isMoving ?: false
            if (!ignition && (isMoving || distance > TrackIssueType.MOVEMENT_DISTANCE_THRESHOLD)) {
                issues.add(TrackIssueType.MOVEMENT_WITHOUT_POWER)
            }
            
            // 5. Speed spike (calculate actual speed from coordinates)
            val timeDeltaHours = timeDelta.toMillis() / 3600000.0
            if (timeDeltaHours > 0) {
                val calculatedSpeed = distance / 1000.0 / timeDeltaHours // km/h
                if (calculatedSpeed > TrackIssueType.SPEED_SPIKE_THRESHOLD) {
                    issues.add(TrackIssueType.SPEED_SPIKE)
                }
            }
            
            // 6. Altitude spike
            val prevAlt = prev.altitude
            val currAlt = current.altitude
            if (prevAlt != null && currAlt != null) {
                val altDelta = abs(currAlt - prevAlt)
                if (altDelta > TrackIssueType.ALTITUDE_SPIKE_THRESHOLD) {
                    issues.add(TrackIssueType.ALTITUDE_SPIKE)
                }
            }
            
            // 7. Static moving (speed == 0 but coordinates changed)
            if (current.speed == 0.0 && distance > TrackIssueType.STATIC_MOVING_DISTANCE_THRESHOLD) {
                issues.add(TrackIssueType.STATIC_MOVING)
            }
        }
        
        return issues
    }
    
    /**
     * Groups points with the same issue set into segments.
     */
    private fun groupIntoSegments(
        pointsWithIssues: List<Pair<TrackPoint, Set<TrackIssueType>>>
    ): List<TrackSegment> {
        if (pointsWithIssues.isEmpty()) return emptyList()
        
        val segments = mutableListOf<TrackSegment>()
        var currentSegmentPoints = mutableListOf(pointsWithIssues[0].first)
        var currentIssues = pointsWithIssues[0].second
        
        for (i in 1 until pointsWithIssues.size) {
            val (point, issues) = pointsWithIssues[i]
            
            if (issues == currentIssues) {
                // Same issues, add to current segment
                currentSegmentPoints.add(point)
            } else {
                // Issues changed, finalize current segment and start new one
                segments.add(createSegment(currentSegmentPoints, currentIssues))
                currentSegmentPoints = mutableListOf(point)
                currentIssues = issues
            }
        }
        
        // Add final segment
        segments.add(createSegment(currentSegmentPoints, currentIssues))
        
        return segments
    }
    
    /**
     * Creates a segment from a list of points.
     */
    private fun createSegment(
        points: List<TrackPoint>,
        issues: Set<TrackIssueType>
    ): TrackSegment {
        val startTime = points.first().timestamp
        val endTime = points.last().timestamp
        val duration = Duration.between(startTime, endTime)
        
        return TrackSegment(
            startTime = startTime,
            endTime = endTime,
            issues = issues,
            points = points,
            duration = duration,
            count = points.size,
            stats = calculateStats(points)
        )
    }
    
    /**
     * Calculates statistics for a segment.
     */
    private fun calculateStats(points: List<TrackPoint>): SegmentStats {
        val satellites = points.mapNotNull { it.satellites }
        val voltages = points.mapNotNull { it.voltage }
        val speeds = points.map { it.speed }
        
        // Calculate total distance
        var totalDistance = 0.0
        for (i in 1 until points.size) {
            totalDistance += haversineDistance(
                points[i - 1].latitude, points[i - 1].longitude,
                points[i].latitude, points[i].longitude
            )
        }
        
        return SegmentStats(
            avgSatellites = if (satellites.isNotEmpty()) satellites.average() else null,
            minSatellites = satellites.minOrNull(),
            maxSatellites = satellites.maxOrNull(),
            avgVoltage = if (voltages.isNotEmpty()) voltages.average() else null,
            minVoltage = voltages.minOrNull(),
            maxVoltage = voltages.maxOrNull(),
            avgSpeed = if (speeds.isNotEmpty()) speeds.average() else null,
            maxSpeed = speeds.maxOrNull(),
            distanceTraveled = totalDistance
        )
    }
    
    /**
     * Calculates distance between two coordinates using Haversine formula.
     * @return Distance in meters
     */
    private fun haversineDistance(
        lat1: Double, lon1: Double,
        lat2: Double, lon2: Double
    ): Double {
        val earthRadius = 6371000.0 // meters
        
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        
        val a = sin(dLat / 2).pow(2) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
                sin(dLon / 2).pow(2)
        val c = 2 * atan2(sqrt(a), sqrt(1 - a))
        
        return earthRadius * c
    }
    
    /**
     * Generates a summary of all segments for display.
     */
    fun generateSummary(segments: List<TrackSegment>): Map<TrackIssueType, Duration> {
        val summary = mutableMapOf<TrackIssueType, Duration>()
        
        for (segment in segments) {
            val issue = if (segment.issues.isEmpty()) TrackIssueType.NONE else segment.primaryIssue()
            summary[issue] = (summary[issue] ?: Duration.ZERO).plus(segment.duration)
        }
        
        return summary
    }
}
