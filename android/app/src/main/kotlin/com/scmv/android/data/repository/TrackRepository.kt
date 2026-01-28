package com.scmv.android.data.repository

import com.scmv.android.data.remote.ConnectionState
import com.scmv.android.data.remote.WsClient
import com.scmv.android.data.remote.WsRequestBuilder
import com.scmv.android.data.remote.WsResponse
import com.scmv.android.data.session.SessionManager
import com.scmv.android.domain.model.LatLng
import com.scmv.android.domain.model.MileageSegment
import com.scmv.android.domain.model.TrackPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import java.time.Duration
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * Repository interface for track and mileage operations.
 */
interface TrackRepository {
    /**
     * Fetches mileage segments for a device within a time range.
     * 
     * @param deviceId The vehicle/device ID
     * @param from Start of the time range
     * @param to End of the time range
     * @return Result containing a list of mileage segments, or an error on failure
     */
    suspend fun getMileage(
        deviceId: Int,
        from: LocalDateTime,
        to: LocalDateTime
    ): Result<List<MileageSegment>>

    /**
     * Fetches raw GPS track points from the device.
     * Uses "Device Track" endpoint which provides more detailed data.
     * 
     * @param deviceId The device ID
     * @param from Start of the time range
     * @param to End of the time range
     * @return Result containing a list of track points, or an error on failure
     */
    suspend fun getRawTrack(
        deviceId: Int,
        from: LocalDateTime,
        to: LocalDateTime
    ): Result<List<TrackPoint>>

    /**
     * Fetches track points for analysis using the special filter request.
     * 
     * @param deviceId The device ID
     * @param from Start of the time range
     * @param to End of the time range
     * @return Result containing a list of track points
     */
    suspend fun getAnalysisTrack(
        deviceId: Int,
        from: LocalDateTime,
        to: LocalDateTime
    ): Result<List<TrackPoint>>

    /**
     * Fetches processed GPS track points for a vehicle.
     * Uses "Vehicle Track" endpoint.
     * 
     * @param deviceId The vehicle ID
     * @param from Start of the time range
     * @param to End of the time range
     * @return Result containing a list of track points, or an error on failure
     */
    suspend fun getVehicleTrack(
        deviceId: Int,
        from: LocalDateTime,
        to: LocalDateTime
    ): Result<List<TrackPoint>>

    /**
     * Fetches total mileage for a device within a time range.
     * Uses "Startstop accumulation" endpoint.
     * 
     * @param deviceId The vehicle/device ID
     * @param from Start of the time range
     * @param to End of the time range
     * @return Result containing total kilometers traveled, or an error on failure
     */
    suspend fun getMileageTotal(
        deviceId: Int,
        from: LocalDateTime,
        to: LocalDateTime
    ): Result<Double>
}

/**
 * Implementation of [TrackRepository] using WebSocket for data retrieval.
 */
@Singleton
class TrackRepositoryImpl @Inject constructor(
    private val wsClient: WsClient,
    private val sessionManager: SessionManager,
    private val json: Json
) : TrackRepository {

    companion object {
        private const val REQUEST_TIMEOUT_MS = 30_000L
        private const val MILEAGE_REPORT_NAME = "Mileage Report"
        private const val VEHICLE_TRACK_NAME = "Vehicle Track"
        private const val DEVICE_TRACK_NAME = "Device Track"
        private const val STARTSTOP_ACCUMULATION_NAME = "Startstop accumulation"
        
        // Date format patterns used by the server
        private val DATE_FORMATTER_REQUEST = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")
        private val DATE_FORMATTER_RESPONSE = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
        private val DATE_FORMATTER_ISO = DateTimeFormatter.ISO_LOCAL_DATE_TIME
        // Raw Track short format: 12.01.26T15:30:46
        private val DATE_FORMATTER_SHORT_T = DateTimeFormatter.ofPattern("dd.MM.yy'T'HH:mm:ss")
        private val DATE_FORMATTER_SHORT_SPACE = DateTimeFormatter.ofPattern("dd.MM.yy HH:mm:ss")
        private val DATE_FORMATTER_FULL_T = DateTimeFormatter.ofPattern("dd.MM.yyyy'T'HH:mm:ss")
    }

    override suspend fun getMileage(
        deviceId: Int,
        from: LocalDateTime,
        to: LocalDateTime
    ): Result<List<MileageSegment>> {
        return try {
            val session = sessionManager.getSession()
                ?: return Result.failure(TrackException("Not logged in"))

            ensureConnected()

            val request = WsRequestBuilder.mileageRequest(
                deviceId = deviceId.toString(),
                dateFrom = from.format(DATE_FORMATTER_REQUEST),
                dateTo = to.format(DATE_FORMATTER_REQUEST),
                usr = session.username,
                pwd = session.password,
                uid = session.uid
            )

            val response = sendAndAwaitResponse(
                requestJson = json.encodeToString(request),
                expectedName = MILEAGE_REPORT_NAME,
                timeoutMs = REQUEST_TIMEOUT_MS
            )

            val segments = parseMileageResponse(response)
            Result.success(segments)
        } catch (e: TimeoutCancellationException) {
            Result.failure(TrackException("Mileage request timeout - server did not respond"))
        } catch (e: Exception) {
            Result.failure(TrackException("Failed to fetch mileage: ${e.message}", e))
        }
    }

    override suspend fun getRawTrack(
        deviceId: Int,
        from: LocalDateTime,
        to: LocalDateTime
    ): Result<List<TrackPoint>> {
        return try {
            val session = sessionManager.getSession()
                ?: return Result.failure(TrackException("Not logged in"))

            ensureConnected()

            val request = WsRequestBuilder.deviceTrackRequest(
                deviceId = deviceId.toString(),
                dateFrom = from.format(DATE_FORMATTER_REQUEST),
                dateTo = to.format(DATE_FORMATTER_REQUEST),
                usr = session.username,
                pwd = session.password,
                uid = session.uid
            )

            val response = sendAndAwaitResponse(
                requestJson = json.encodeToString(request),
                expectedName = DEVICE_TRACK_NAME,
                timeoutMs = REQUEST_TIMEOUT_MS
            )

            val points = parseTrackResponse(response, isRawTrack = true)
            Result.success(points)
        } catch (e: TimeoutCancellationException) {
            Result.failure(TrackException("Raw track request timeout - server did not respond"))
        } catch (e: Exception) {
            Result.failure(TrackException("Failed to fetch raw track: ${e.message}", e))
        }
    }

    override suspend fun getAnalysisTrack(
        deviceId: Int,
        from: LocalDateTime,
        to: LocalDateTime
    ): Result<List<TrackPoint>> {
        return try {
            val session = sessionManager.getSession()
                ?: return Result.failure(TrackException("Not logged in"))

            ensureConnected()

            val request = WsRequestBuilder.analyzeTrackRequest(
                deviceId = deviceId.toString(),
                dateFrom = from.format(DATE_FORMATTER_REQUEST),
                dateTo = to.format(DATE_FORMATTER_REQUEST),
                usr = session.username,
                pwd = session.password,
                uid = session.uid
            )

            val response = sendAndAwaitResponse(
                requestJson = json.encodeToString(request),
                expectedName = DEVICE_TRACK_NAME,
                timeoutMs = REQUEST_TIMEOUT_MS
            )

            val points = parseTrackResponse(response, isRawTrack = true)
            Result.success(points)
        } catch (e: TimeoutCancellationException) {
            Result.failure(TrackException("Analysis track request timeout - server did not respond"))
        } catch (e: Exception) {
            Result.failure(TrackException("Failed to fetch analysis track: ${e.message}", e))
        }
    }

    override suspend fun getVehicleTrack(
        deviceId: Int,
        from: LocalDateTime,
        to: LocalDateTime
    ): Result<List<TrackPoint>> {
        return try {
            val session = sessionManager.getSession()
                ?: return Result.failure(TrackException("Not logged in"))

            ensureConnected()

            val request = WsRequestBuilder.vehicleTrackRequest(
                deviceId = deviceId.toString(),
                dateFrom = from.format(DATE_FORMATTER_REQUEST),
                dateTo = to.format(DATE_FORMATTER_REQUEST),
                usr = session.username,
                pwd = session.password,
                uid = session.uid
            )

            val response = sendAndAwaitResponse(
                requestJson = json.encodeToString(request),
                expectedName = VEHICLE_TRACK_NAME,
                timeoutMs = REQUEST_TIMEOUT_MS
            )

            val points = parseTrackResponse(response, isRawTrack = false)
            Result.success(points)
        } catch (e: TimeoutCancellationException) {
            Result.failure(TrackException("Vehicle track request timeout - server did not respond"))
        } catch (e: Exception) {
            Result.failure(TrackException("Failed to fetch vehicle track: ${e.message}", e))
        }
    }

    override suspend fun getMileageTotal(
        deviceId: Int,
        from: LocalDateTime,
        to: LocalDateTime
    ): Result<Double> {
        return try {
            val session = sessionManager.getSession()
                ?: return Result.failure(TrackException("Not logged in"))

            ensureConnected()

            val request = WsRequestBuilder.startstopAccumulationRequest(
                deviceId = deviceId.toString(),
                dateFrom = from.format(DATE_FORMATTER_REQUEST),
                dateTo = to.format(DATE_FORMATTER_REQUEST),
                usr = session.username,
                pwd = session.password,
                uid = session.uid
            )

            val response = sendAndAwaitResponse(
                requestJson = json.encodeToString(request),
                expectedName = STARTSTOP_ACCUMULATION_NAME,
                timeoutMs = REQUEST_TIMEOUT_MS
            )

            val totalKm = parseStartstopAccumulationResponse(response)
            Result.success(totalKm)
        } catch (e: TimeoutCancellationException) {
            Result.failure(TrackException("Mileage total request timeout - server did not respond"))
        } catch (e: Exception) {
            Result.failure(TrackException("Failed to fetch mileage total: ${e.message}", e))
        }
    }

    /**
     * Parses mileage response into MileageSegment list.
     * 
     * Response structure per segment:
     * - coordinates: [[lat, lon], [lat, lon], ...] (lat first!)
     * - fdate: start time
     * - period: duration as "HH:mm:ss"
     * - dest: distance in meters (integer)
     * - ismoved: boolean for movement state
     * 
     * Note: There is NO tdate field - endTime must be calculated as fdate + period
     */
    private fun parseMileageResponse(response: WsResponse): List<MileageSegment> {
        val resultSet = response.res?.firstOrNull()
            ?: throw TrackException("Empty mileage response from server")

        val segments = resultSet.f
        if (segments.isNullOrEmpty()) {
            android.util.Log.w("TrackRepository", "Mileage response has no segments (f is null or empty)")
            return emptyList()
        }

        android.util.Log.d("TrackRepository", "Parsing ${segments.size} mileage segments")

        return segments.mapNotNull { segmentJson ->
            try {
                // Parse coordinates array: [[lat, lon], [lat, lon], ...]
                val coordinatesArray = segmentJson["coordinates"]?.jsonArray
                val coordinates = coordinatesArray?.map { coordElement ->
                    val coord = coordElement.jsonArray
                    LatLng(
                        latitude = coord[0].jsonPrimitive.double,
                        longitude = coord[1].jsonPrimitive.double
                    )
                } ?: emptyList()

                // Parse start time
                val startTimeStr = segmentJson["fdate"]?.jsonPrimitive?.content ?: return@mapNotNull null
                val startTime = parseDateTime(startTimeStr)

                // Parse duration (format: HH:mm:ss)
                val periodStr = segmentJson["period"]?.jsonPrimitive?.content ?: "00:00:00"
                val duration = parseDuration(periodStr)

                // Calculate end time from start time + duration (no tdate field exists)
                val endTime = startTime.plus(duration)

                // Parse distance from dest field (integer meters -> convert to km)
                val distanceMeters = segmentJson["dest"]?.jsonPrimitive?.intOrNull ?: 0
                val distanceKm = distanceMeters / 1000.0

                // Parse movement state
                val isMoving = segmentJson["ismoved"]?.jsonPrimitive?.booleanOrNull ?: false

                // Optional marker code (used for stops rendering)
                val marker = segmentJson["marker"]?.jsonPrimitive?.intOrNull

                if (coordinates.isEmpty()) {
                    android.util.Log.w("TrackRepository", "Mileage segment has empty coordinates, fdate=$startTimeStr")
                }

                MileageSegment(
                    coordinates = coordinates,
                    startTime = startTime,
                    endTime = endTime,
                    duration = duration,
                    isMoving = isMoving,
                    distanceKm = distanceKm,
                    marker = marker
                )
            } catch (e: Exception) {
                android.util.Log.e("TrackRepository", "Failed to parse mileage segment: ${e.message}, json keys: ${segmentJson.keys}")
                null // Skip malformed segments
            }
        }.also {
            android.util.Log.d("TrackRepository", "Successfully parsed ${it.size} mileage segments with ${it.sumOf { s -> s.coordinates.size }} total coordinates, total distance: ${it.sumOf { s -> s.distanceKm }} km")
        }
    }

    /**
     * Parses Startstop accumulation response and returns total kilometers.
     * 
     * Response structure per entry:
     * - stopnum: 0 for movement segments, 1+ for stops
     * - dest: distance as STRING like "72.87" representing kilometers
     * - fdate: timestamp
     * - period: duration (null for movement, "HH:mm:ss" for stops)
     * 
     * Only entries with stopnum == 0 are movement segments and should be summed.
     */
    private fun parseStartstopAccumulationResponse(response: WsResponse): Double {
        val resultSet = response.res?.firstOrNull()
            ?: throw TrackException("Empty startstop accumulation response from server")

        val entries = resultSet.f
        if (entries.isNullOrEmpty()) {
            android.util.Log.w("TrackRepository", "Startstop accumulation response has no entries (f is null or empty)")
            return 0.0
        }

        android.util.Log.d("TrackRepository", "Parsing ${entries.size} startstop accumulation entries")

        var totalKm = 0.0
        var movementCount = 0

        for (entryJson in entries) {
            try {
                // Only sum movement segments (stopnum == 0)
                val stopNum = entryJson["stopnum"]?.jsonPrimitive?.intOrNull ?: continue
                if (stopNum != 0) continue

                // Parse distance from dest field (string representing km, e.g., "72.87")
                val destStr = entryJson["dest"]?.jsonPrimitive?.content ?: "0"
                val distanceKm = destStr.toDoubleOrNull() ?: 0.0
                
                totalKm += distanceKm
                movementCount++
            } catch (e: Exception) {
                android.util.Log.e("TrackRepository", "Failed to parse startstop entry: ${e.message}")
                // Continue processing other entries
            }
        }

        android.util.Log.d("TrackRepository", "Startstop accumulation: $movementCount movement segments, total: $totalKm km")
        return totalKm
    }

    /**
     * Parses track response into TrackPoint list.
     * 
     * Response fields:
     * - latitude, longitude: coordinates
     * - wdate: timestamp
     * - speed: km/h
     * - satelites (raw track only): satellite count
     * - ignition (raw track only): ignition state
     * - ismoves (raw track only): movement sensor
     */
    private fun parseTrackResponse(response: WsResponse, isRawTrack: Boolean): List<TrackPoint> {
        val resultSet = response.res?.firstOrNull()
            ?: throw TrackException("Empty track response from server")

        val points = resultSet.f
        if (points.isNullOrEmpty()) {
            android.util.Log.w("TrackRepository", "Track response has no points (f is null or empty)")
            return emptyList()
        }

        android.util.Log.d("TrackRepository", "Parsing ${points.size} track points (isRawTrack=$isRawTrack)")
        
        // Log first point's keys to help debug field name issues
        points.firstOrNull()?.let { firstPoint ->
            android.util.Log.d("TrackRepository", "First track point keys: ${firstPoint.keys}")
        }

        return points.mapNotNull { pointJson ->
            try {
                val latitude = pointJson["latitude"]?.jsonPrimitive?.doubleOrNull
                    ?: return@mapNotNull null
                val longitude = pointJson["longitude"]?.jsonPrimitive?.doubleOrNull
                    ?: return@mapNotNull null
                val timestampStr = pointJson["wdate"]?.jsonPrimitive?.content
                    ?: return@mapNotNull null
                val timestamp = parseDateTime(timestampStr)
                val speed = pointJson["speed"]?.jsonPrimitive?.doubleOrNull ?: 0.0

                // Additional fields for raw track
                val satellites = if (isRawTrack) {
                    pointJson["satelites"]?.jsonPrimitive?.intOrNull
                } else null
                
                val ignition = if (isRawTrack) {
                    pointJson["ignition"]?.jsonPrimitive?.booleanOrNull
                } else null
                
                val isMoving = if (isRawTrack) {
                    pointJson["ismoves"]?.jsonPrimitive?.booleanOrNull
                } else null
                
                val voltage = if (isRawTrack) {
                    pointJson["batvoltage"]?.jsonPrimitive?.intOrNull
                } else null
                
                val altitude = if (isRawTrack) {
                    pointJson["altitude"]?.jsonPrimitive?.doubleOrNull
                } else null

                TrackPoint(
                    latitude = latitude,
                    longitude = longitude,
                    timestamp = timestamp,
                    speed = speed,
                    satellites = satellites,
                    ignition = ignition,
                    isMoving = isMoving,
                    voltage = voltage,
                    altitude = altitude
                )
            } catch (e: Exception) {
                android.util.Log.e("TrackRepository", "Failed to parse track point: ${e.message}, json keys: ${pointJson.keys}")
                null // Skip malformed points
            }
        }.also { parsedPoints ->
            android.util.Log.d("TrackRepository", "Successfully parsed ${parsedPoints.size} track points")
            if (parsedPoints.isEmpty() && points.isNotEmpty()) {
                android.util.Log.e("TrackRepository", "WARNING: All ${points.size} points failed to parse! Check field names.")
            }
        }
    }

    /**
     * Parses a datetime string, trying multiple formats.
     */
    private fun parseDateTime(dateStr: String): LocalDateTime {
        // Vehicle Track: ISO-like "2026-01-13T14:47:15" or "yyyy-MM-dd HH:mm:ss"
        if (dateStr.contains('-')) {
            return try {
                LocalDateTime.parse(dateStr, DATE_FORMATTER_ISO)
            } catch (_: DateTimeParseException) {
                LocalDateTime.parse(dateStr.replace('T', ' '), DATE_FORMATTER_RESPONSE)
            }
        }

        // Raw Track: short dotted formats
        return try {
            LocalDateTime.parse(dateStr, DATE_FORMATTER_SHORT_T)
        } catch (_: DateTimeParseException) {
            try {
                LocalDateTime.parse(dateStr, DATE_FORMATTER_SHORT_SPACE)
            } catch (_: DateTimeParseException) {
                LocalDateTime.parse(dateStr, DATE_FORMATTER_FULL_T)
            }
        }
    }

    /**
     * Parses a duration string in "HH:mm:ss" format.
     */
    private fun parseDuration(periodStr: String): Duration {
        return try {
            val parts = periodStr.split(":")
            if (parts.size == 3) {
                val hours = parts[0].toLongOrNull() ?: 0
                val minutes = parts[1].toLongOrNull() ?: 0
                val seconds = parts[2].toLongOrNull() ?: 0
                Duration.ofHours(hours).plusMinutes(minutes).plusSeconds(seconds)
            } else {
                Duration.ZERO
            }
        } catch (e: Exception) {
            Duration.ZERO
        }
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
                    is ConnectionState.Error -> throw TrackException("Connection failed: ${state.message}")
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
            val job = CoroutineScope(continuation.context).launch {
                wsClient.incomingMessages.collect { message ->
                    try {
                        val response = json.decodeFromString<WsResponse>(message)
                        if (response.name == expectedName) {
                            if (continuation.isActive) {
                                continuation.resume(response)
                            }
                            cancel("Received expected response: $expectedName")
                        }
                    } catch (e: Exception) {
                        // Ignore non-matching or invalid messages
                    }
                }
            }

            val sent = wsClient.send(requestJson)
            if (!sent) {
                job.cancel()
                if (continuation.isActive) {
                    continuation.resumeWith(
                        Result.failure(TrackException("Failed to send request - not connected"))
                    )
                }
            }

            continuation.invokeOnCancellation {
                job.cancel()
            }
        }
    }

}

/**
 * Exception thrown for track-related errors.
 */
class TrackException(message: String, cause: Throwable? = null) : Exception(message, cause)
