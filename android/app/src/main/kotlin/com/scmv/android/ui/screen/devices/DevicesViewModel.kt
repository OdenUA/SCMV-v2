package com.scmv.android.ui.screen.devices

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.scmv.android.data.repository.DeviceRepository
import com.scmv.android.domain.model.Device
import com.scmv.android.domain.model.Fleet
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for the Devices screen.
 * Handles device list loading, searching, and fleet filtering.
 */
@HiltViewModel
class DevicesViewModel @Inject constructor(
    private val deviceRepository: DeviceRepository
) : ViewModel() {

    /**
     * UI state for the devices screen.
     */
    data class DevicesUiState(
        val devices: List<Device> = emptyList(),
        val filteredDevices: List<Device> = emptyList(),
        val fleets: List<Fleet> = emptyList(),
        val searchQuery: String = "",
        val selectedFleetId: Int? = null,
        val isLoading: Boolean = false,
        val isRefreshing: Boolean = false,
        val error: String? = null
    )

    private val _uiState = MutableStateFlow(DevicesUiState())
    val uiState: StateFlow<DevicesUiState> = _uiState.asStateFlow()

    init {
        loadDevices()
    }

    /**
     * Loads the list of devices from the repository.
     * 
     * @param isRefresh If true, shows refresh indicator instead of full loading
     */
    fun loadDevices(isRefresh: Boolean = false) {
        viewModelScope.launch {
            _uiState.update { currentState ->
                currentState.copy(
                    isLoading = !isRefresh,
                    isRefreshing = isRefresh,
                    error = null
                )
            }

            deviceRepository.getDevices()
                .onSuccess { devices ->
                    val fleets = extractFleets(devices)
                    _uiState.update { currentState ->
                        currentState.copy(
                            devices = devices,
                            fleets = fleets,
                            isLoading = false,
                            isRefreshing = false,
                            error = null
                        )
                    }
                    applyFilters()
                }
                .onFailure { exception ->
                    _uiState.update { currentState ->
                        currentState.copy(
                            isLoading = false,
                            isRefreshing = false,
                            error = exception.message ?: "Failed to load devices"
                        )
                    }
                }
        }
    }

    /**
     * Refreshes the device list (pull-to-refresh).
     */
    fun refresh() {
        loadDevices(isRefresh = true)
    }

    /**
     * Updates the search query and filters devices.
     * 
     * @param query The search query string
     */
    fun onSearchQueryChange(query: String) {
        _uiState.update { currentState ->
            currentState.copy(searchQuery = query)
        }
        applyFilters()
    }

    /**
     * Updates the selected fleet filter.
     * 
     * @param fleetId The fleet ID to filter by, or null for all fleets
     */
    fun onFleetFilterChange(fleetId: Int?) {
        _uiState.update { currentState ->
            currentState.copy(selectedFleetId = fleetId)
        }
        applyFilters()
    }

    /**
     * Clears the current error message.
     */
    fun clearError() {
        _uiState.update { currentState ->
            currentState.copy(error = null)
        }
    }

    /**
     * Applies search and fleet filters to the device list.
     */
    private fun applyFilters() {
        val currentState = _uiState.value
        var filtered = currentState.devices

        // Apply fleet filter first
        currentState.selectedFleetId?.let { fleetId ->
            filtered = filtered.filter { it.fleetId == fleetId }
        }

        // Apply search filter
        if (currentState.searchQuery.isNotBlank()) {
            filtered = deviceRepository.searchDevices(currentState.searchQuery, filtered)
        }

        _uiState.update { state ->
            state.copy(filteredDevices = filtered)
        }
    }

    /**
     * Extracts unique fleets from the device list.
     * 
     * @param devices The list of devices
     * @return Sorted list of unique fleets
     */
    private fun extractFleets(devices: List<Device>): List<Fleet> {
        return devices
            .map { Fleet(id = it.fleetId, name = it.fleetName) }
            .distinctBy { it.id }
            .sortedBy { it.name }
    }
}
