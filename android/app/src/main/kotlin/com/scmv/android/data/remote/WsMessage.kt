package com.scmv.android.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * WebSocket request message structure for SCMV protocol.
 */
@Serializable
data class WsRequest(
    val name: String,
    val type: String? = null,
    val mid: Int? = null,
    val act: String? = null,
    val filter: List<JsonObject>? = null,
    val nowait: Boolean? = null,
    val waitfor: List<String>? = null,
    val usr: String? = null,
    val pwd: String? = null,
    val uid: Int? = null,
    val lang: String? = null
)

/**
 * WebSocket response message structure from SCMV server.
 */
@Serializable
data class WsResponse(
    val name: String? = null,
    val res: List<WsResultSet>? = null,
    val filter: List<JsonObject>? = null,
    val msg: String? = null
)

/**
 * Result set containing columns metadata and data rows.
 */
@Serializable
data class WsResultSet(
    val cols: List<WsColumn>? = null,
    val f: List<JsonObject>? = null,
    // Login response includes uid directly in result
    val uid: Int? = null
)

/**
 * Column definition with field name and optional key-value mappings.
 */
@Serializable
data class WsColumn(
    val f: String? = null,
    val k: List<WsKeyVal>? = null
)

/**
 * Key-value pair for column lookups (e.g., fleet ID to fleet name).
 * Note: val_ can be null when fleet/category is not assigned.
 */
@Serializable
data class WsKeyVal(
    val key: Int,
    @SerialName("val")
    val val_: String? = null
)

/**
 * Helper object for building common WebSocket request messages.
 */
object WsRequestBuilder {
    
    private const val DEFAULT_LANG = "en"

    /**
     * Creates a login request.
     * 
     * @param usr Username
     * @param pwd Password
     * @return WsRequest configured for login
     */
    fun loginRequest(usr: String, pwd: String): WsRequest {
        return WsRequest(
            name = "login",
            type = "login",
            mid = 0,
            act = "setup",
            usr = usr,
            pwd = pwd,
            uid = 0,
            lang = DEFAULT_LANG
        )
    }

    /**
     * Creates a vehicle select min request (init phase).
     * This is used to fetch the list of authorized device IDs for the user.
     * 
     * @param usr Username
     * @param pwd Password
     * @param uid User ID from login response
     * @return WsRequest configured for vehicle select min init
     */
    fun vehicleSelectMinInitRequest(usr: String, pwd: String, uid: Int): WsRequest {
        return WsRequest(
            name = "Vehicle Select Min",
            type = "etbl",
            mid = 4,
            act = "init",
            usr = usr,
            pwd = pwd,
            uid = uid,
            lang = DEFAULT_LANG
        )
    }

    /**
     * Creates a vehicle select min request (setup phase).
     * 
     * @param usr Username
     * @param pwd Password
     * @param uid User ID from login response
     * @return WsRequest configured for vehicle select min setup
     */
    fun vehicleSelectMinRequest(usr: String, pwd: String, uid: Int): WsRequest {
        return WsRequest(
            name = "Vehicle Select Min",
            type = "etbl",
            mid = 4,
            act = "setup",
            filter = listOf(buildFilterObject("selecteduid", uid.toString())),
            nowait = true,
            waitfor = emptyList(),
            usr = usr,
            pwd = pwd,
            uid = uid,
            lang = DEFAULT_LANG
        )
    }

    /**
     * Creates a vehicle list request (init phase).
     * Note: A setup request should follow after ~150ms.
     * 
     * @param usr Username
     * @param pwd Password
     * @param uid User ID from login response
     * @return WsRequest configured for vehicle list init
     */
    fun vehicleListInitRequest(usr: String, pwd: String, uid: Int): WsRequest {
        return WsRequest(
            name = "Vehicle Show",
            type = "etbl",
            mid = 2,
            act = "init",
            usr = usr,
            pwd = pwd,
            uid = uid,
            lang = DEFAULT_LANG
        )
    }

    /**
     * Creates a vehicle list request (setup phase).
     * 
     * @param usr Username
     * @param pwd Password
     * @param uid User ID from login response
     * @return WsRequest configured for vehicle list setup
     */
    fun vehicleListRequest(usr: String, pwd: String, uid: Int): WsRequest {
        return WsRequest(
            name = "Vehicle Show",
            type = "etbl",
            mid = 2,
            act = "setup",
            filter = emptyList(),
            nowait = true,
            waitfor = emptyList(),
            usr = usr,
            pwd = pwd,
            uid = uid,
            lang = DEFAULT_LANG
        )
    }

    /**
     * Creates a mileage report request.
     * 
     * @param deviceId Vehicle/device ID
     * @param dateFrom Start date in format "YYYY-MM-DDTHH:mm:ss"
     * @param dateTo End date in format "YYYY-MM-DDTHH:mm:ss"
     * @param usr Username
     * @param pwd Password
     * @param uid User ID
     * @return WsRequest configured for mileage report
     */
    fun mileageRequest(
        deviceId: String,
        dateFrom: String,
        dateTo: String,
        usr: String,
        pwd: String,
        uid: Int
    ): WsRequest {
        return WsRequest(
            name = "Mileage Report",
            type = "map",
            mid = 2,
            act = "filter",
            filter = listOf(
                buildFilterObject("selectedvihicleid", deviceId),
                buildFilterObject("selectedpgdatefrom", dateFrom),
                buildFilterObject("selectedpgdateto", dateTo)
            ),
            usr = usr,
            pwd = pwd,
            uid = uid,
            lang = DEFAULT_LANG
        )
    }

    /**
     * Creates a vehicle track request for GPS points.
     * 
     * @param deviceId Vehicle ID
     * @param dateFrom Start date in format "YYYY-MM-DDTHH:mm:ss"
     * @param dateTo End date in format "YYYY-MM-DDTHH:mm:ss"
     * @param usr Username
     * @param pwd Password
     * @param uid User ID
     * @return WsRequest configured for vehicle track
     */
    fun vehicleTrackRequest(
        deviceId: String,
        dateFrom: String,
        dateTo: String,
        usr: String,
        pwd: String,
        uid: Int
    ): WsRequest {
        return WsRequest(
            name = "Vehicle Track",
            type = "map",
            mid = 2,
            act = "filter",
            filter = listOf(
                buildFilterObject("selectedvihicleid", deviceId),
                buildFilterObject("selectedpgdatefrom", dateFrom),
                buildFilterObject("selectedpgdateto", dateTo)
            ),
            usr = usr,
            pwd = pwd,
            uid = uid,
            lang = DEFAULT_LANG
        )
    }

    /**
     * Creates a device track request for raw GPS data.
     * Note: Uses selecteddeviceid instead of selectedvihicleid.
     * 
     * @param deviceId Device ID
     * @param dateFrom Start date in format "YYYY-MM-DDTHH:mm:ss"
     * @param dateTo End date in format "YYYY-MM-DDTHH:mm:ss"
     * @param usr Username
     * @param pwd Password
     * @param uid User ID
     * @return WsRequest configured for device track
     */
    fun deviceTrackRequest(
        deviceId: String,
        dateFrom: String,
        dateTo: String,
        usr: String,
        pwd: String,
        uid: Int
    ): WsRequest {
        return WsRequest(
            name = "Device Track",
            type = "etbl",
            mid = 6,
            act = "setup",
            filter = listOf(
                buildFilterObject("selecteddeviceid", deviceId),
                buildFilterObject("selectedpgdatefrom", dateFrom),
                buildFilterObject("selectedpgdateto", dateTo)
            ),
            nowait = false,
            waitfor = listOf("selectedpgdateto"),
            usr = usr,
            pwd = pwd,
            uid = uid,
            lang = DEFAULT_LANG
        )
    }

    /**
     * Creates a device track request for analysis (using filter action).
     * 
     * @param deviceId Device ID
     * @param dateFrom Start date in format "YYYY-MM-DDTHH:mm:ss"
     * @param dateTo End date in format "YYYY-MM-DDTHH:mm:ss"
     * @param usr Username
     * @param pwd Password
     * @param uid User ID
     * @return WsRequest configured for analysis
     */
    fun analyzeTrackRequest(
        deviceId: String,
        dateFrom: String,
        dateTo: String,
        usr: String,
        pwd: String,
        uid: Int
    ): WsRequest {
        return WsRequest(
            name = "Device Track",
            type = "etbl",
            mid = 6,
            act = "filter",
            filter = listOf(
                buildFilterObject("selectedpgdateto", dateTo),
                buildFilterObject("selectedpgdatefrom", dateFrom),
                buildFilterObject("selecteddeviceid", deviceId)
            ),
            usr = usr,
            pwd = pwd,
            uid = uid,
            lang = DEFAULT_LANG
        )
    }

    /**
     * Creates a Startstop accumulation request for total mileage.
     * 
     * @param deviceId Vehicle/device ID
     * @param dateFrom Start date in format "YYYY-MM-DDTHH:mm:ss"
     * @param dateTo End date in format "YYYY-MM-DDTHH:mm:ss"
     * @param usr Username
     * @param pwd Password
     * @param uid User ID
     * @return WsRequest configured for startstop accumulation
     */
    fun startstopAccumulationRequest(
        deviceId: String,
        dateFrom: String,
        dateTo: String,
        usr: String,
        pwd: String,
        uid: Int
    ): WsRequest {
        return WsRequest(
            name = "Startstop accumulation",
            type = "etbl",
            mid = 5,
            act = "filter",
            filter = listOf(
                buildFilterObject("selectedvihicleid", deviceId),
                buildFilterObject("selectedpgdatefrom", dateFrom),
                buildFilterObject("selectedpgdateto", dateTo)
            ),
            usr = usr,
            pwd = pwd,
            uid = uid,
            lang = DEFAULT_LANG
        )
    }

    /**
     * Builds a filter object with a single key-value pair.
     * Filter format: { "key": ["value"] }
     */
    private fun buildFilterObject(key: String, value: String): JsonObject {
        return kotlinx.serialization.json.buildJsonObject {
            put(key, kotlinx.serialization.json.buildJsonArray {
                add(kotlinx.serialization.json.JsonPrimitive(value))
            })
        }
    }
}
