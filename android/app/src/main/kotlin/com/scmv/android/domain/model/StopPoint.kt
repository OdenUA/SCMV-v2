package com.scmv.android.domain.model

import java.time.Duration
import java.time.LocalDateTime

/**
 * Represents a stop derived from the mileage report.
 */
data class StopPoint(
    val position: LatLng,
    val startTime: LocalDateTime,
    val duration: Duration,
    val markerCode: Int? = null
)
