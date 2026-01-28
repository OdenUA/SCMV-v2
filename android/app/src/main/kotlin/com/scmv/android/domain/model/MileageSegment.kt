package com.scmv.android.domain.model

import java.time.LocalDateTime
import java.time.Duration

data class MileageSegment(
    val coordinates: List<LatLng>,
    val startTime: LocalDateTime,
    val endTime: LocalDateTime,
    val duration: Duration,
    val isMoving: Boolean,
    val distanceKm: Double = 0.0,
    val marker: Int? = null
)

data class LatLng(
    val latitude: Double,
    val longitude: Double
)
