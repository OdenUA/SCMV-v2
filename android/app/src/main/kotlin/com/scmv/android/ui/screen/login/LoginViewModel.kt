package com.scmv.android.ui.screen.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.scmv.android.data.remote.ConnectionState
import com.scmv.android.data.remote.WsClient
import com.scmv.android.data.repository.AuthRepository
import com.scmv.android.data.session.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for the Login screen.
 * Handles authentication logic and UI state management.
 */
@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val sessionManager: SessionManager,
    private val wsClient: WsClient
) : ViewModel() {

    /**
     * UI state for the login screen.
     */
    data class LoginUiState(
        val username: String = "",
        val password: String = "",
        val rememberMe: Boolean = false,
        val isLoading: Boolean = false,
        val error: String? = null,
        val isLoggedIn: Boolean = false,
        val connectionStatus: String = "Disconnected"
    )

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    init {
        checkSavedSession()
        observeConnectionState()
    }
    
    /**
     * Observes WebSocket connection state and updates UI accordingly.
     */
    private fun observeConnectionState() {
        viewModelScope.launch {
            wsClient.connectionState.collect { state ->
                val status = when (state) {
                    is ConnectionState.Disconnected -> "Disconnected"
                    is ConnectionState.Connecting -> "Connecting..."
                    is ConnectionState.Connected -> "Connected"
                    is ConnectionState.Error -> "Error: ${state.message}"
                }
                _uiState.update { it.copy(connectionStatus = status) }
                
                // Show error in UI if connection fails
                if (state is ConnectionState.Error) {
                    _uiState.update { it.copy(error = state.message, isLoading = false) }
                }
            }
        }
    }

    /**
     * Checks for a saved session on initialization.
     * If remember me was enabled and a valid session exists, auto-populate credentials.
     */
    private fun checkSavedSession() {
        viewModelScope.launch {
            sessionManager.sessionFlow.collect { session ->
                if (session != null && session.rememberMe) {
                    _uiState.update { currentState ->
                        currentState.copy(
                            username = session.username,
                            password = session.password,
                            rememberMe = true
                        )
                    }
                }
            }
        }
    }

    /**
     * Updates the username field.
     */
    fun onUsernameChange(username: String) {
        _uiState.update { currentState ->
            currentState.copy(
                username = username,
                error = null
            )
        }
    }

    /**
     * Updates the password field.
     */
    fun onPasswordChange(password: String) {
        _uiState.update { currentState ->
            currentState.copy(
                password = password,
                error = null
            )
        }
    }

    /**
     * Updates the remember me checkbox state.
     */
    fun onRememberMeChange(checked: Boolean) {
        _uiState.update { currentState ->
            currentState.copy(rememberMe = checked)
        }
    }

    /**
     * Attempts to log in with the current credentials.
     */
    fun login() {
        val currentState = _uiState.value

        // Validate inputs
        if (currentState.username.isBlank()) {
            _uiState.update { it.copy(error = "Username is required") }
            return
        }
        if (currentState.password.isBlank()) {
            _uiState.update { it.copy(error = "Password is required") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = authRepository.login(
                username = currentState.username.trim(),
                password = currentState.password,
                rememberMe = currentState.rememberMe
            )

            result.fold(
                onSuccess = { user ->
                    _uiState.update { it.copy(
                        isLoading = false,
                        isLoggedIn = true,
                        error = null
                    )}
                },
                onFailure = { throwable ->
                    _uiState.update { it.copy(
                        isLoading = false,
                        error = throwable.message ?: "Login failed. Please try again."
                    )}
                }
            )
        }
    }

    /**
     * Clears the current error message.
     */
    fun clearError() {
        _uiState.update { currentState ->
            currentState.copy(error = null)
        }
    }
}
