package com.scmv.android.data.repository

import com.scmv.android.data.remote.ConnectionState
import com.scmv.android.data.remote.WsClient
import com.scmv.android.data.remote.WsColumn
import com.scmv.android.data.remote.WsRequestBuilder
import com.scmv.android.data.remote.WsResponse
import com.scmv.android.data.session.SessionManager
import com.scmv.android.domain.model.Device
import com.scmv.android.domain.model.Fleet
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * Repository interface for device/vehicle operations.
 */
interface DeviceRepository {
    /**
     * Fetches the list of all devices accessible by the current user.
     * 
     * @return Result containing a list of devices, or an error on failure
     */
    suspend fun getDevices(): Result<List<Device>>
    
    /**
     * Filters devices by search query matching name, IMEI, or fleet name.
     * 
     * @param query The search query string
     * @param devices The list of devices to filter
     * @return Filtered list of devices matching the query
     */
    fun searchDevices(query: String, devices: List<Device>): List<Device>
}

/**
 * Implementation of [DeviceRepository] using WebSocket for data retrieval.
 * 
 * Protocol flow for fetching devices:
 * 1. Send init request → receive response with cols (contains fleet mappings)
 * 2. Send setup request → receive response with device data (f array)
 * 3. Use fleet map from init response to resolve fleet names in device data
 */
@Singleton
class DeviceRepositoryImpl @Inject constructor(
    private val wsClient: WsClient,
    private val sessionManager: SessionManager,
    private val json: Json
) : DeviceRepository {

    companion object {
        private const val TAG = "DeviceRepository"
        private const val REQUEST_TIMEOUT_MS = 30_000L
        private const val VEHICLE_SHOW_NAME = "Vehicle Show"
    }

    override suspend fun getDevices(): Result<List<Device>> {
        return try {
            val session = sessionManager.getSession()
                ?: return Result.failure(DeviceException("Not logged in"))

            // Ensure WebSocket is connected
            ensureConnected()

            // Step 1: Get Authorized Device IDs via "Vehicle Select Min"
            // This is crucial to limit the list to only what the user is allowed to see
            Log.d(TAG, "Step 1: Fetching authorized device IDs via 'Vehicle Select Min'...")
            
            // 1.1: Send init request for Select Min
            val selectMinInitRequest = WsRequestBuilder.vehicleSelectMinInitRequest(
                usr = session.username,
                pwd = session.password,
                uid = session.uid
            )
            val selectMinInitJson = json.encodeToString(selectMinInitRequest)
            sendAndAwaitResponse(
                requestJson = selectMinInitJson,
                expectedName = "Vehicle Select Min",
                timeoutMs = REQUEST_TIMEOUT_MS
            )
            
            // 1.2: Send setup request for Select Min
            val selectMinRequest = WsRequestBuilder.vehicleSelectMinRequest(
                usr = session.username,
                pwd = session.password,
                uid = session.uid
            )
            val selectMinJson = json.encodeToString(selectMinRequest)
            val selectMinResponse = sendAndAwaitResponse(
                requestJson = selectMinJson,
                expectedName = "Vehicle Select Min",
                timeoutMs = REQUEST_TIMEOUT_MS
            )
            
            // 1.3: Extract authorized IDs
            val authorizedIds = extractIdsFromResponse(selectMinResponse)
            Log.d(TAG, "Authorized device IDs: $authorizedIds")

            // Step 2: Fetch detailed device info via "Vehicle Show"
            Log.d(TAG, "Step 2: Fetching detailed device info via 'Vehicle Show'...")
            
            // 2.1: Send init request and wait for response to get fleet mappings
            val initRequest = WsRequestBuilder.vehicleListInitRequest(
                usr = session.username,
                pwd = session.password,
                uid = session.uid
            )
            val initRequestJson = json.encodeToString(initRequest)
            val initResponse = sendAndAwaitResponse(
                requestJson = initRequestJson,
                expectedName = VEHICLE_SHOW_NAME,
                timeoutMs = REQUEST_TIMEOUT_MS
            )

            // 2.2: Extract fleet map from init response cols
            val fleetMap = buildFleetMapFromResponse(initResponse)

            // 2.3: Send setup request and wait for response with device data
            val setupRequest = WsRequestBuilder.vehicleListRequest(
                usr = session.username,
                pwd = session.password,
                uid = session.uid
            )
            val setupRequestJson = json.encodeToString(setupRequest)
            val setupResponse = sendAndAwaitResponse(
                requestJson = setupRequestJson,
                expectedName = VEHICLE_SHOW_NAME,
                timeoutMs = REQUEST_TIMEOUT_MS
            )

            // Step 3: Parse devices and filter by authorized IDs
            val allDevices = parseDevicesResponse(setupResponse, fleetMap)
            val filteredDevices = allDevices.filter { device ->
                authorizedIds.isEmpty() || authorizedIds.contains(device.id)
            }
            
            Log.d(TAG, "Total devices: ${allDevices.size}, Filtered devices: ${filteredDevices.size}")
            Result.success(filteredDevices)
        } catch (e: TimeoutCancellationException) {
            Result.failure(DeviceException("Request timeout - server did not respond"))
        } catch (e: Exception) {
            Result.failure(DeviceException("Failed to fetch devices: ${e.message}", e))
        }
    }

    /**
     * Extracts device IDs from a WebSocket response.
     */
    private fun extractIdsFromResponse(response: WsResponse): Set<Int> {
        val resultSet = response.res?.firstOrNull() ?: return emptySet()
        return resultSet.f?.mapNotNull { it["id"]?.jsonPrimitive?.int }?.toSet() ?: emptySet()
    }

    override fun searchDevices(query: String, devices: List<Device>): List<Device> {
        if (query.isBlank()) {
            return devices
        }

        val lowerQuery = query.lowercase().trim()
        
        return devices.filter { device ->
            device.name.lowercase().contains(lowerQuery) ||
            device.imei.lowercase().contains(lowerQuery) ||
            device.fleetName.lowercase().contains(lowerQuery)
        }
    }

    /**
     * Extracts fleet map from init response.
     * 
     * Init response structure:
     * - res[0].cols array contains column definitions
     * - Find column where f == "fleet"
     * - That column's k array contains fleet mappings: [{key: 1, val: "Fleet Name"}, ...]
     */
    private fun buildFleetMapFromResponse(response: WsResponse): Map<Int, Fleet> {
        val resultSet = response.res?.firstOrNull()
        if (resultSet == null) {
            Log.w(TAG, "buildFleetMapFromResponse: resultSet is null")
            return emptyMap()
        }
        Log.d(TAG, "buildFleetMapFromResponse: cols array size: ${resultSet.cols?.size}")
        Log.d(TAG, "buildFleetMapFromResponse: cols structure: ${resultSet.cols}")
        val fleetMap = buildFleetMap(resultSet.cols)
        Log.d(TAG, "buildFleetMapFromResponse: built ${fleetMap.size} fleet entries")
        if (fleetMap.isNotEmpty()) {
            Log.d(TAG, "buildFleetMapFromResponse: sample entry: ${fleetMap.entries.first()}")
        }
        return fleetMap
    }

    /**
     * Parses the setup WebSocket response into a list of Device objects.
     * 
     * Setup response structure (Vehicle Show):
     * - f contains device data: [{id, fleet, number, imei}, ...]
     *   - id: device ID
     *   - number: device name/vehicle number
     *   - imei: device IMEI
     *   - fleet: fleet ID (lookup using fleetMap from init response)
     * 
     * @param response The setup response containing device data
     * @param fleetMap Fleet ID to Fleet mapping obtained from init response
     */
    private fun parseDevicesResponse(response: WsResponse, fleetMap: Map<Int, Fleet>): List<Device> {
        val resultSet = response.res?.firstOrNull()
            ?: throw DeviceException("Empty response from server")

        Log.d(TAG, "parseDevicesResponse: f array size: ${resultSet.f?.size ?: 0}")
        if (resultSet.f?.isNotEmpty() == true) {
            Log.d(TAG, "parseDevicesResponse: first device JSON: ${resultSet.f.first()}")
        }

        // Parse devices from f array
        // Vehicle Show response uses: id, number (name), imei, fleet, type, phone
        var successCount = 0
        var filteredCount = 0
        val devices = resultSet.f?.mapNotNull { deviceJson ->
            try {
                val id = deviceJson["id"]?.jsonPrimitive?.int
                if (id == null) {
                    filteredCount++
                    return@mapNotNull null
                }
                val fleetId = deviceJson["fleet"]?.jsonPrimitive?.int ?: 0
                val name = deviceJson["number"]?.jsonPrimitive?.content ?: ""
                val imei = deviceJson["imei"]?.jsonPrimitive?.content ?: ""
                val fleetName = fleetMap[fleetId]?.name ?: ""
                val type = deviceJson["type"]?.jsonPrimitive?.contentOrNull
                val model = deviceJson["model"]?.jsonPrimitive?.contentOrNull
                val phone = deviceJson["phone"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }

                successCount++
                Device(
                    id = id,
                    name = name,
                    imei = imei,
                    fleetId = fleetId,
                    fleetName = fleetName,
                    type = type,
                    model = model,
                    phone = phone
                )
            } catch (e: Exception) {
                filteredCount++
                Log.w(TAG, "parseDevicesResponse: Failed to parse device: ${e.message}")
                null // Skip malformed devices
            }
        } ?: emptyList()

        Log.d(TAG, "parseDevicesResponse: Successfully parsed $successCount devices, filtered out $filteredCount")
        return devices
    }

    /**
     * Builds a map of fleet ID to Fleet from the cols array.
     * Handles cases where val_ is null (unassigned fleet).
     */
    private fun buildFleetMap(cols: List<WsColumn>?): Map<Int, Fleet> {
        val fleetColumn = cols?.find { it.f == "fleet" }
            ?: return emptyMap()

        return fleetColumn.k?.associate { keyVal ->
            keyVal.key to Fleet(id = keyVal.key, name = keyVal.val_ ?: "Не указан")
        } ?: emptyMap()
    }

    /**
     * Ensures WebSocket is connected before sending requests.
     */
    private suspend fun ensureConnected() {
        val currentState = wsClient.connectionState.value

        if (currentState is ConnectionState.Connected) {
            return
        }

        wsClient.connect()

        withTimeout(REQUEST_TIMEOUT_MS) {
            wsClient.connectionState.first { state ->
                when (state) {
                    is ConnectionState.Connected -> true
                    is ConnectionState.Error -> throw DeviceException("Connection failed: ${state.message}")
                    else -> false
                }
            }
        }
    }

    /**
     * Sends a WebSocket request and waits for a matching response.
     */
    private suspend fun sendAndAwaitResponse(
        requestJson: String,
        expectedName: String,
        timeoutMs: Long
    ): WsResponse = withTimeout(timeoutMs) {
        suspendCancellableCoroutine { continuation ->
            Log.d(TAG, "sendAndAwaitResponse: Setting up collector for '$expectedName'")
            
            // CRITICAL: Start collecting BEFORE sending to avoid missing fast responses
            // SharedFlow with replay=0 doesn't buffer past messages
            val job = CoroutineScope(continuation.context).launch {
                Log.d(TAG, "sendAndAwaitResponse: Collector job started, waiting for messages...")
                var messageCount = 0
                wsClient.incomingMessages.collect { message ->
                    messageCount++
                    Log.d(TAG, "sendAndAwaitResponse: Received message #$messageCount (${message.length} chars)")
                    Log.d(TAG, "sendAndAwaitResponse: Message preview: ${message.take(300)}")
                    
                    try {
                        val response = json.decodeFromString<WsResponse>(message)
                        Log.d(TAG, "sendAndAwaitResponse: Parsed response - name='${response.name}', expecting='$expectedName'")
                        
                        if (response.name == expectedName) {
                            Log.d(TAG, "sendAndAwaitResponse: ✓ MATCH! Resuming continuation with response")
                            if (continuation.isActive) {
                                continuation.resume(response)
                            }
                            cancel("Received expected response: $expectedName")
                        } else {
                            Log.d(TAG, "sendAndAwaitResponse: ✗ No match (got '${response.name}', expected '$expectedName')")
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "sendAndAwaitResponse: Failed to parse message: ${e.message}")
                    }
                }
                Log.d(TAG, "sendAndAwaitResponse: Collector job finished")
            }

            // Send AFTER starting to collect
            Log.d(TAG, "sendAndAwaitResponse: Sending request...")
            val sent = wsClient.send(requestJson)
            if (!sent) {
                Log.e(TAG, "sendAndAwaitResponse: Failed to send - not connected")
                job.cancel()
                if (continuation.isActive) {
                    continuation.resumeWith(
                        Result.failure(DeviceException("Failed to send request - not connected"))
                    )
                }
                return@suspendCancellableCoroutine
            }
            Log.d(TAG, "sendAndAwaitResponse: Request sent successfully")

            continuation.invokeOnCancellation {
                Log.d(TAG, "sendAndAwaitResponse: Continuation cancelled")
                job.cancel()
            }
        }
    }

}

/**
 * Exception thrown for device-related errors.
 */
class DeviceException(message: String, cause: Throwable? = null) : Exception(message, cause)
