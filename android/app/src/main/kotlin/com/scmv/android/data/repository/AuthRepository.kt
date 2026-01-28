package com.scmv.android.data.repository

import com.scmv.android.data.remote.ConnectionState
import com.scmv.android.data.remote.WsClient
import com.scmv.android.data.remote.WsRequest
import com.scmv.android.data.remote.WsRequestBuilder
import com.scmv.android.data.remote.WsResponse
import com.scmv.android.data.session.SessionManager
import com.scmv.android.domain.model.User
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * Repository interface for authentication operations.
 */
interface AuthRepository {
    /**
     * Attempts to log in with the provided credentials.
     * 
     * @param username The user's username
     * @param password The user's password
     * @param rememberMe Whether to persist the session
     * @return Result containing the User on success, or an error on failure
     */
    suspend fun login(username: String, password: String, rememberMe: Boolean = false): Result<User>
    
    /**
     * Logs out the current user and clears the session.
     */
    suspend fun logout()
    
    /**
     * Returns a Flow that emits the current login status.
     */
    fun isLoggedIn(): Flow<Boolean>
    
    /**
     * Returns a Flow that emits the current user, or null if not logged in.
     */
    fun getCurrentUser(): Flow<User?>
}

/**
 * Implementation of [AuthRepository] using WebSocket for authentication.
 */
@Singleton
class AuthRepositoryImpl @Inject constructor(
    private val wsClient: WsClient,
    private val sessionManager: SessionManager,
    private val json: Json
) : AuthRepository {

    companion object {
        private const val LOGIN_TIMEOUT_MS = 30_000L
        private const val LOGIN_RESPONSE_NAME = "login"
    }

    override suspend fun login(username: String, password: String, rememberMe: Boolean): Result<User> {
        return try {
            // Ensure WebSocket is connected
            ensureConnected()

            // Build and send login request
            val request = WsRequestBuilder.loginRequest(username, password)
            val requestJson = json.encodeToString(request)

            // Send request and wait for response with timeout
            val response = sendAndAwaitResponse(
                requestJson = requestJson,
                expectedName = LOGIN_RESPONSE_NAME,
                timeoutMs = LOGIN_TIMEOUT_MS
            )

            // Parse login response
            val uid = response.res?.firstOrNull()?.uid
            
            if (uid != null && uid > 0) {
                // Login successful - save session
                sessionManager.saveSession(
                    username = username,
                    password = password,
                    uid = uid,
                    rememberMe = rememberMe
                )
                
                val user = User(uid = uid, username = username)
                Result.success(user)
            } else {
                // Login failed - check for error message
                val errorMessage = response.msg ?: "Invalid credentials"
                Result.failure(AuthException(errorMessage))
            }
        } catch (e: TimeoutCancellationException) {
            Result.failure(AuthException("Login timeout - server did not respond"))
        } catch (e: Exception) {
            Result.failure(AuthException("Login failed: ${e.message}", e))
        }
    }

    override suspend fun logout() {
        sessionManager.clearSession()
        wsClient.disconnect()
    }

    override fun isLoggedIn(): Flow<Boolean> {
        return sessionManager.sessionFlow.map { session -> session != null }
    }

    override fun getCurrentUser(): Flow<User?> {
        return sessionManager.sessionFlow.map { session ->
            session?.let { 
                User(uid = it.uid, username = it.username) 
            }
        }
    }

    /**
     * Ensures WebSocket is connected before sending requests.
     * Throws an exception if connection fails.
     */
    private suspend fun ensureConnected() {
        val currentState = wsClient.connectionState.value
        
        if (currentState is ConnectionState.Connected) {
            return
        }

        wsClient.connect()

        // Wait for connection with timeout
        withTimeout(LOGIN_TIMEOUT_MS) {
            wsClient.connectionState.first { state ->
                when (state) {
                    is ConnectionState.Connected -> true
                    is ConnectionState.Error -> throw AuthException("Connection failed: ${state.message}")
                    else -> false
                }
            }
        }
    }

    /**
     * Sends a WebSocket request and waits for a matching response.
     * 
     * @param requestJson The JSON string to send
     * @param expectedName The expected response name to match
     * @param timeoutMs Timeout in milliseconds
     * @return The parsed WsResponse
     */
    private suspend fun sendAndAwaitResponse(
        requestJson: String,
        expectedName: String,
        timeoutMs: Long
    ): WsResponse = withTimeout(timeoutMs) {
        suspendCancellableCoroutine { continuation ->
            // Collect incoming messages until we get our response
            val job = CoroutineScope(continuation.context).launch {
                wsClient.incomingMessages.collect { message ->
                    try {
                        val response = json.decodeFromString<WsResponse>(message)
                        if (response.name == expectedName) {
                            if (continuation.isActive) {
                                continuation.resume(response)
                            }
                            // Stop collecting once we've delivered the response.
                            cancel("Received expected response: $expectedName")
                        }
                    } catch (e: Exception) {
                        // Ignore non-matching or invalid messages
                    }
                }
            }

            // Send the request
            val sent = wsClient.send(requestJson)
            if (!sent) {
                job.cancel()
                if (continuation.isActive) {
                    continuation.resumeWith(
                        Result.failure(AuthException("Failed to send login request - not connected"))
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
 * Exception thrown for authentication-related errors.
 */
class AuthException(message: String, cause: Throwable? = null) : Exception(message, cause)
