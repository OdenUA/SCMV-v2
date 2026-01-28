package com.scmv.android.domain.model

import java.time.LocalDateTime

data class TrackPoint(
    val latitude: Double,
    val longitude: Double,
    val timestamp: LocalDateTime,
    val speed: Double,
    val satellites: Int? = null,
    val ignition: Boolean? = null,
    val isMoving: Boolean? = null,
    val voltage: Int? = null,
    val altitude: Double? = null
)
