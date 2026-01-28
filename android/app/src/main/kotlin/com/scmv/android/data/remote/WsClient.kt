package com.scmv.android.data.remote

import android.util.Log
import com.scmv.android.util.Constants
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import javax.inject.Inject
import javax.inject.Singleton

/**
 * WebSocket connection states
 */
sealed class ConnectionState {
    data object Disconnected : ConnectionState()
    data object Connecting : ConnectionState()
    data object Connected : ConnectionState()
    data class Error(val message: String, val throwable: Throwable? = null) : ConnectionState()
}

/**
 * OkHttp WebSocket client for SCMV server communication.
 * Handles connection management, message sending/receiving, and automatic reconnection.
 */
@Singleton
class WsClient @Inject constructor(
    private val okHttpClient: OkHttpClient
) {
    companion object {
        private const val TAG = "WsClient"
        private const val NORMAL_CLOSURE_STATUS = 1000
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var webSocket: WebSocket? = null
    private var shouldReconnect = true
    private var isManualDisconnect = false

    // Keep URL mutable to allow safe auto-fixups (e.g. ws:// -> wss:// on HTTPS-only ports)
    @Volatile
    private var wsUrl: String = Constants.WS_URL

    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _incomingMessages = MutableSharedFlow<String>(
        replay = 0,
        extraBufferCapacity = 64
    )
    val incomingMessages: SharedFlow<String> = _incomingMessages.asSharedFlow()

    private val webSocketListener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            Log.i(TAG, "WebSocket connection opened: ${response.message}")
            _connectionState.value = ConnectionState.Connected
            isManualDisconnect = false
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            Log.d(TAG, "Received message: ${text.take(200)}${if (text.length > 200) "..." else ""}")
            scope.launch {
                _incomingMessages.emit(text)
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            Log.i(TAG, "WebSocket closing: code=$code, reason=$reason")
            webSocket.close(NORMAL_CLOSURE_STATUS, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            Log.i(TAG, "WebSocket closed: code=$code, reason=$reason")
            handleDisconnection()
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.e(TAG, "=== WebSocket Connection Failed ===")
            Log.e(TAG, "URL: $wsUrl")
            Log.e(TAG, "Response code: ${response?.code}")
            Log.e(TAG, "Response message: ${response?.message}")
            Log.e(TAG, "Response headers: ${response?.headers}")
            Log.e(TAG, "Exception: ${t.javaClass.simpleName} - ${t.message}", t)

            val responseBodyText = try {
                response?.body?.string()?.take(2000)
            } catch (_: Throwable) {
                null
            }
            if (!responseBodyText.isNullOrBlank()) {
                Log.e(TAG, "Response body (truncated): $responseBodyText")
            }

            val isPlainHttpSentToHttpsPort =
                response?.code == 400 && (responseBodyText?.contains("plain HTTP request was sent to HTTPS port", ignoreCase = true) == true)

            // If user configured ws:// to an HTTPS-only port (common on :4445), auto-upgrade and reconnect.
            if (isPlainHttpSentToHttpsPort && wsUrl.startsWith("ws://", ignoreCase = true)) {
                val upgraded = "wss://" + wsUrl.removePrefix("ws://")
                Log.w(TAG, "Server requires HTTPS/WSS. Auto-upgrading URL: $wsUrl -> $upgraded")
                wsUrl = upgraded
            }
            
            val errorMsg = when {
                isPlainHttpSentToHttpsPort -> "Этот порт принимает только HTTPS/WSS. Используйте wss:// (на :4445 ws:// не работает)."
                response?.code == 502 -> """Сервер недоступен (502 Bad Gateway).

Возможные причины:
1. Сервер scmv.vpngps.com выключен или перезагружается
2. Порт 4445 закрыт firewall
3. Nginx/прокси сервер не может подключиться к бэкенду
4. SSL сертификат настроен неправильно

Попробуйте:
• Проверить работу сервера через браузер
• Использовать ws:// вместо wss:// (без SSL)
• Обратиться к администратору сервера"""
                response?.code == 503 -> "Сервис временно недоступен (503). Сервер перегружен."
                response?.code == 404 -> "WebSocket endpoint не найден (404). Проверьте URL."
                response?.code == 401 -> "Требуется авторизация (401)"
                response != null -> "HTTP ${response.code}: ${response.message}"
                t.message?.contains("SSL", ignoreCase = true) == true -> """Ошибка SSL соединения.

Возможные причины:
1. Самоподписанный сертификат не принят
2. Истёк срок действия сертификата
3. Неверная конфигурация SSL на сервере

Попробуйте использовать ws:// вместо wss://"""
                t.message?.contains("Unable to resolve host", ignoreCase = true) == true -> 
                    "Не удаётся найти хост scmv.vpngps.com. Проверьте интернет-соединение."
                t.message?.contains("timeout", ignoreCase = true) == true -> 
                    "Превышено время ожидания соединения. Сервер не отвечает."
                t.message?.contains("failed to connect", ignoreCase = true) == true -> 
                    "Не удалось подключиться к серверу. Проверьте сеть и firewall."
                t is java.io.EOFException ->
                    "Соединение разорвано сервером/прокси (EOF). Обычно это означает, что сервер закрыл WebSocket без кадра Close."
                else -> "Неизвестная ошибка WebSocket: ${t.message}"
            }
            
            Log.e(TAG, "Error message: $errorMsg")
            
            _connectionState.value = ConnectionState.Error(
                message = errorMsg,
                throwable = t
            )
            handleDisconnection()
        }
    }

    /**
     * Establishes WebSocket connection to the server.
     * If already connected or connecting, this is a no-op.
     */
    fun connect() {
        val currentState = _connectionState.value
        if (currentState is ConnectionState.Connected || currentState is ConnectionState.Connecting) {
            Log.d(TAG, "Already connected or connecting, skipping connect request")
            return
        }

        shouldReconnect = true
        isManualDisconnect = false
        
        Log.i(TAG, "Connecting to WebSocket: $wsUrl")
        _connectionState.value = ConnectionState.Connecting

        val request = Request.Builder()
            .url(wsUrl)
            // Match browser-like handshake headers (some reverse proxies validate Origin)
            .header("Origin", "https://scmv.vpngps.com")
            .header("User-Agent", "SCMV-Android/1.0")
            .build()

        webSocket = okHttpClient.newWebSocket(request, webSocketListener)
    }

    /** Optional: allow changing URL at runtime (e.g. via settings). */
    fun setUrl(url: String) {
        wsUrl = url
    }

    /**
     * Closes the WebSocket connection gracefully.
     * Disables auto-reconnect until connect() is called again.
     */
    fun disconnect() {
        Log.i(TAG, "Disconnecting WebSocket")
        shouldReconnect = false
        isManualDisconnect = true
        
        webSocket?.close(NORMAL_CLOSURE_STATUS, "Client disconnect")
        webSocket = null
        _connectionState.value = ConnectionState.Disconnected
    }

    /**
     * Sends a message through the WebSocket connection.
     * 
     * @param message The message string to send
     * @return true if message was queued successfully, false if not connected
     */
    fun send(message: String): Boolean {
        val socket = webSocket
        if (socket == null || _connectionState.value !is ConnectionState.Connected) {
            Log.w(TAG, "Cannot send message: WebSocket not connected")
            return false
        }

        Log.d(TAG, "Sending message: ${message.take(200)}${if (message.length > 200) "..." else ""}")
        return socket.send(message)
    }

    /**
     * Handles disconnection by updating state and triggering reconnection if enabled.
     */
    private fun handleDisconnection() {
        webSocket = null
        
        if (isManualDisconnect) {
            _connectionState.value = ConnectionState.Disconnected
            return
        }

        if (_connectionState.value !is ConnectionState.Error) {
            _connectionState.value = ConnectionState.Disconnected
        }

        if (shouldReconnect) {
            scheduleReconnect()
        }
    }

    /**
     * Schedules a reconnection attempt after the configured delay.
     */
    private fun scheduleReconnect() {
        scope.launch {
            Log.i(TAG, "Scheduling reconnect in ${Constants.RECONNECT_DELAY_MS}ms")
            delay(Constants.RECONNECT_DELAY_MS)
            
            if (shouldReconnect && _connectionState.value !is ConnectionState.Connected) {
                Log.i(TAG, "Attempting reconnection...")
                connect()
            }
        }
    }

    /**
     * Returns whether the WebSocket is currently connected.
     */
    fun isConnected(): Boolean = _connectionState.value is ConnectionState.Connected
}
