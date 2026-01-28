package com.scmv.android.ui.screen.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.scmv.android.data.remote.ConnectionState
import com.scmv.android.data.remote.WsClient
import com.scmv.android.data.session.SessionManager
import com.scmv.android.data.settings.AppSettings
import com.scmv.android.data.settings.AppSettingsData
import com.scmv.android.util.Constants
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    val useSsl: Boolean = true,
    val wsUrl: String = Constants.WS_URL,
    val connectionStatus: String = "Отключен",
    val showDebugInfo: Boolean = false,
    val debugMessage: String = "",
    val trackLineWidth: Float = AppSettingsData.DEFAULT_TRACK_LINE_WIDTH,
    val stopMarkerSize: Int = AppSettingsData.DEFAULT_STOP_MARKER_SIZE,
    val arrowSize: Int = AppSettingsData.DEFAULT_ARROW_SIZE,
    val appLanguage: String = AppSettingsData.DEFAULT_APP_LANGUAGE,
    val isLoggingOut: Boolean = false
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val wsClient: WsClient,
    private val sessionManager: SessionManager,
    private val appSettings: AppSettings
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        observeConnectionState()
        observeAppSettings()
    }

    private fun observeConnectionState() {
        viewModelScope.launch {
            wsClient.connectionState.collect { state ->
                val status = when (state) {
                    is ConnectionState.Connected -> "Подключен"
                    is ConnectionState.Connecting -> "Подключение..."
                    is ConnectionState.Error -> {
                        _uiState.update { 
                            it.copy(
                                showDebugInfo = true,
                                debugMessage = state.message
                            )
                        }
                        "Ошибка подключения"
                    }
                    else -> "Отключен"
                }
                _uiState.update { it.copy(connectionStatus = status) }
            }
        }
    }

    private fun observeAppSettings() {
        viewModelScope.launch {
            appSettings.settingsFlow.collect { settings ->
                _uiState.update {
                    it.copy(
                        trackLineWidth = settings.trackLineWidth,
                        stopMarkerSize = settings.stopMarkerSize,
                        arrowSize = settings.arrowSize,
                        appLanguage = settings.appLanguage
                    )
                }
            }
        }
    }

    fun toggleSsl() {
        val newUseSsl = !_uiState.value.useSsl
        val newUrl = if (newUseSsl) {
            Constants.WS_URL  // wss://
        } else {
            Constants.WS_URL_FALLBACK  // ws://
        }
        
        _uiState.update { 
            it.copy(
                useSsl = newUseSsl,
                wsUrl = newUrl
            )
        }
    }

    fun reconnect() {
        wsClient.disconnect()
        viewModelScope.launch {
            kotlinx.coroutines.delay(500)
            wsClient.connect()
        }
    }

    /**
     * Sets the track line width.
     * @param width The new width (2-12)
     */
    fun setTrackLineWidth(width: Float) {
        viewModelScope.launch {
            appSettings.setTrackLineWidth(width)
        }
    }

    /**
     * Sets the stop marker size.
     * @param size The new size (12-32)
     */
    fun setStopMarkerSize(size: Int) {
        viewModelScope.launch {
            appSettings.setStopMarkerSize(size)
        }
    }

    /**
     * Sets the arrow size.
     * @param size The new size (2-16)
     */
    fun setArrowSize(size: Int) {
        viewModelScope.launch {
            appSettings.setArrowSize(size)
        }
    }

    /**
     * Sets the app language.
     * @param languageCode The language code ("uk" or "ru")
     */
    fun setAppLanguage(languageCode: String) {
        viewModelScope.launch {
            appSettings.setAppLanguage(languageCode)
        }
    }

    /**
     * Logs out the current user and clears the session.
     * @param onLogoutComplete Callback invoked when logout is complete
     */
    fun logout(onLogoutComplete: () -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoggingOut = true) }
            
            // Disconnect WebSocket
            wsClient.disconnect()
            
            // Clear session data
            sessionManager.clearSession()
            
            _uiState.update { it.copy(isLoggingOut = false) }
            
            // Notify caller to navigate to login
            onLogoutComplete()
        }
    }
}
