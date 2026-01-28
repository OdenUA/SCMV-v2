package com.scmv.android.domain.model

data class Device(
    val id: Int,
    val name: String,
    val imei: String,
    val fleetId: Int,
    val fleetName: String,
    val type: String? = null,
    val model: String? = null,
    val phone: String? = null
)

data class Fleet(
    val id: Int,
    val name: String
)
