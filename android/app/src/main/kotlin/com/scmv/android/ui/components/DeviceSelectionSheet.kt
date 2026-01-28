package com.scmv.android.ui.components

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sms
import androidx.compose.ui.platform.LocalContext
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.scmv.android.R
import com.scmv.android.domain.model.Device
import com.scmv.android.domain.model.Fleet
import com.scmv.android.ui.theme.ScmvTheme

/**
 * Formats a phone number for display.
 * Examples:
 * - "678479332" → "067-847-93-32"
 * - "0678479332" → "067-847-93-32"
 * - "+380678479332" → "067-847-93-32"
 */
private fun formatPhoneForDisplay(phone: String): String {
    // Remove all non-digit characters
    val digits = phone.replace(Regex("[^0-9]"), "")
    
    // Get last 9 digits (Ukrainian mobile number without country code)
    val last9 = if (digits.length >= 9) digits.takeLast(9) else digits
    
    // Format as 0XX-XXX-XX-XX
    return when {
        last9.length == 9 -> "0${last9.substring(0, 2)}-${last9.substring(2, 5)}-${last9.substring(5, 7)}-${last9.substring(7, 9)}"
        else -> phone // Return original if can't format
    }
}

/**
 * Converts a phone number to full Ukrainian format for calls/SMS.
 * Examples:
 * - "678479332" → "+380678479332"
 * - "0678479332" → "+380678479332"
 * - "+380678479332" → "+380678479332"
 */
private fun formatPhoneForCall(phone: String): String {
    // Remove all non-digit characters except leading +
    val cleaned = phone.replace(Regex("[^0-9+]"), "")
    
    // If already starts with +380, return as is
    if (cleaned.startsWith("+380")) return cleaned
    
    // Remove leading + if any
    val digits = cleaned.removePrefix("+")
    
    // If starts with 380, add +
    if (digits.startsWith("380") && digits.length >= 12) {
        return "+$digits"
    }
    
    // If starts with 0, remove it and add +380
    if (digits.startsWith("0") && digits.length >= 10) {
        return "+380${digits.substring(1)}"
    }
    
    // If 9 digits (without country code and leading 0), add +380
    if (digits.length == 9) {
        return "+380$digits"
    }
    
    // Fallback: just add +380 prefix
    return "+380$digits"
}

/**
 * Full-screen modal bottom sheet for device selection.
 * Provides search functionality, fleet filtering, and displays a scrollable list of devices.
 *
 * @param devices List of all available devices
 * @param currentDeviceId Currently selected device ID (will be highlighted)
 * @param onDeviceSelected Callback invoked when a device is selected
 * @param onDismiss Callback invoked when the sheet is dismissed
 * @param sheetState Optional sheet state for controlling the bottom sheet
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceSelectionSheet(
    devices: List<Device>,
    currentDeviceId: Int? = null,
    onDeviceSelected: (Device) -> Unit,
    onDismiss: () -> Unit,
    sheetState: SheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
) {
    // State management
    var searchQuery by remember { mutableStateOf("") }
    var selectedFleetId by remember { mutableStateOf<Int?>(null) }

    // Extract unique fleets from devices
    val fleets by remember(devices) {
        derivedStateOf {
            devices
                .map { Fleet(id = it.fleetId, name = it.fleetName) }
                .distinctBy { it.id }
                .sortedBy { it.name }
        }
    }

    // Filter devices based on search query and selected fleet
    val filteredDevices by remember(devices, searchQuery, selectedFleetId) {
        derivedStateOf {
            devices.filter { device ->
                val matchesSearch = if (searchQuery.isBlank()) {
                    true
                } else {
                    val query = searchQuery.lowercase().trim()
                    device.name.lowercase().contains(query) ||
                    device.fleetName.lowercase().contains(query) ||
                    device.imei.lowercase().contains(query) ||
                    device.id.toString().contains(query)
                }

                val matchesFleet = selectedFleetId == null || device.fleetId == selectedFleetId

                matchesSearch && matchesFleet
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        dragHandle = null, // Custom header instead
        windowInsets = WindowInsets(0) // Handle insets manually for full control
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.statusBars)
        ) {
            // Header
            DeviceSelectionHeader(
                onClose = onDismiss
            )

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // Search field
            SearchField(
                searchQuery = searchQuery,
                onSearchQueryChange = { searchQuery = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            )

            // Fleet filter chips
            if (fleets.isNotEmpty()) {
                FleetFilterChips(
                    fleets = fleets,
                    selectedFleetId = selectedFleetId,
                    onFleetSelected = { selectedFleetId = it }
                )
            }

            // Devices list
            if (filteredDevices.isEmpty()) {
                EmptyDevicesContent(
                    hasFilters = searchQuery.isNotBlank() || selectedFleetId != null
                )
            } else {
                DevicesList(
                    devices = filteredDevices,
                    currentDeviceId = currentDeviceId,
                    onDeviceClick = { device ->
                        onDeviceSelected(device)
                    },
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

/**
 * Header with title and close button.
 */
@Composable
private fun DeviceSelectionHeader(
    onClose: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Spacer(modifier = Modifier.width(48.dp)) // Balance for close button

        Text(
            text = stringResource(R.string.device_selection_title),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center
        )

        IconButton(
            onClick = onClose,
            modifier = Modifier.size(48.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Close,
                contentDescription = stringResource(R.string.close),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * Search input field.
 */
@Composable
private fun SearchField(
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = searchQuery,
        onValueChange = onSearchQueryChange,
        placeholder = {
            Text(
                text = stringResource(R.string.device_search_hint),
                style = MaterialTheme.typography.bodyLarge
            )
        },
        leadingIcon = {
            Icon(
                imageVector = Icons.Default.Search,
                contentDescription = stringResource(R.string.device_search),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        },
        trailingIcon = {
            AnimatedVisibility(
                visible = searchQuery.isNotEmpty(),
                enter = fadeIn(),
                exit = fadeOut()
            ) {
                IconButton(onClick = { onSearchQueryChange("") }) {
                    Icon(
                        imageVector = Icons.Default.Clear,
                        contentDescription = stringResource(R.string.close),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        },
        singleLine = true,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MaterialTheme.colorScheme.primary,
            unfocusedBorderColor = MaterialTheme.colorScheme.outline,
            focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant
        ),
        shape = MaterialTheme.shapes.medium,
        modifier = modifier
    )
}

/**
 * Horizontal scrollable fleet filter chips.
 */
@Composable
private fun FleetFilterChips(
    fleets: List<Fleet>,
    selectedFleetId: Int?,
    onFleetSelected: (Int?) -> Unit
) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // "All" chip
        item {
            FilterChip(
                selected = selectedFleetId == null,
                onClick = { onFleetSelected(null) },
                label = { Text(stringResource(R.string.device_all_fleets)) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = MaterialTheme.colorScheme.primary,
                    selectedLabelColor = MaterialTheme.colorScheme.onPrimary
                )
            )
        }

        // Fleet chips
        items(fleets) { fleet ->
            FilterChip(
                selected = selectedFleetId == fleet.id,
                onClick = { onFleetSelected(fleet.id) },
                label = { Text(fleet.name) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = MaterialTheme.colorScheme.primary,
                    selectedLabelColor = MaterialTheme.colorScheme.onPrimary
                )
            )
        }
    }
}

/**
 * Scrollable list of device cards.
 */
@Composable
private fun DevicesList(
    devices: List<Device>,
    currentDeviceId: Int?,
    onDeviceClick: (Device) -> Unit,
    modifier: Modifier = Modifier
) {
    LazyColumn(
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = modifier
    ) {
        items(
            items = devices,
            key = { it.id }
        ) { device ->
            DeviceSelectionCard(
                device = device,
                isSelected = device.id == currentDeviceId,
                onClick = { onDeviceClick(device) }
            )
        }
    }
}

/**
 * Individual device card for selection.
 * Shows: ID, name, fleet, IMEI, model, phone.
 * Highlights if currently selected.
 * Includes Call and SMS buttons when phone is available.
 */
@Composable
private fun DeviceSelectionCard(
    device: Device,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val context = LocalContext.current
    
    val containerColor = if (isSelected) {
        MaterialTheme.colorScheme.primaryContainer
    } else {
        MaterialTheme.colorScheme.surfaceVariant
    }

    val borderModifier = if (isSelected) {
        Modifier.border(
            width = 2.dp,
            color = MaterialTheme.colorScheme.primary,
            shape = MaterialTheme.shapes.medium
        )
    } else {
        Modifier
    }
    
    // Build SMS text based on device model/type
    val deviceModel = device.model ?: device.type
    val smsText = remember(deviceModel) {
        when {
            deviceModel == "130" -> "unit 130 getinfo"
            deviceModel == "400" -> "status"
            deviceModel?.startsWith("500") == true -> "1111 status"
            else -> "status"
        }
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .then(borderModifier)
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = containerColor
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = MaterialTheme.shapes.medium
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Vehicle icon
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .background(
                        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.1f),
                        shape = MaterialTheme.shapes.medium
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.DirectionsCar,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(28.dp)
                )
            }

            Spacer(modifier = Modifier.width(16.dp))

            // Device info
            Column(modifier = Modifier.weight(1f)) {
                // Line 1: Device name - bold, larger text
                Text(
                    text = device.name.ifBlank { stringResource(R.string.device_no_name) },
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(modifier = Modifier.height(4.dp))

                // Line 2: ID • IMEI
                val imeiDisplay = device.imei.ifBlank { "—" }
                Text(
                    text = "ID: ${device.id} • IMEI: $imeiDisplay",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(modifier = Modifier.height(2.dp))

                // Line 3: Model
                val displayModel = device.model ?: device.type
                displayModel?.let { modelVal ->
                    Text(
                        text = stringResource(R.string.device_model, modelVal),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                }

                // Line 4: Phone number (formatted for display)
                device.phone?.let { phone ->
                    val displayPhone = formatPhoneForDisplay(phone)
                    Text(
                        text = stringResource(R.string.device_phone, displayPhone),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                }

                // Line 5: Філіал
                val fleetDisplay = device.fleetName.ifBlank { stringResource(R.string.device_no_fleet) }
                Text(
                    text = stringResource(R.string.device_fleet, fleetDisplay),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            
            // Call and SMS buttons (only if phone is available)
            device.phone?.takeIf { it.isNotBlank() }?.let { phone ->
                val fullPhoneNumber = formatPhoneForCall(phone)
                
                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    // Call button
                    IconButton(
                        onClick = {
                            val intent = Intent(Intent.ACTION_DIAL).apply {
                                data = Uri.parse("tel:$fullPhoneNumber")
                            }
                            context.startActivity(intent)
                        },
                        modifier = Modifier.size(40.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Call,
                            contentDescription = stringResource(R.string.device_call),
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(24.dp)
                        )
                    }
                    
                    // SMS button
                    IconButton(
                        onClick = {
                            val intent = Intent(Intent.ACTION_SENDTO).apply {
                                data = Uri.parse("sms:$fullPhoneNumber")
                                putExtra("sms_body", smsText)
                            }
                            context.startActivity(intent)
                        },
                        modifier = Modifier.size(40.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Sms,
                            contentDescription = stringResource(R.string.device_sms),
                            tint = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.size(24.dp)
                        )
                    }
                }
            }
        }
    }
}

/**
 * Empty state when no devices match filters.
 */
@Composable
private fun EmptyDevicesContent(
    hasFilters: Boolean
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                imageVector = Icons.Default.DirectionsCar,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                modifier = Modifier.size(64.dp)
            )

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = if (hasFilters) {
                    stringResource(R.string.device_no_devices)
                } else {
                    stringResource(R.string.device_no_devices_available)
                },
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            if (hasFilters) {
                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = stringResource(R.string.device_try_different_search),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                )
            }
        }
    }
}

// ============== Preview ==============

@OptIn(ExperimentalMaterial3Api::class)
@Preview(showBackground = true)
@Composable
private fun DeviceSelectionSheetPreview() {
    val sampleDevices = listOf(
        Device(
            id = 1,
            name = "Toyota Camry",
            imei = "123456789012345",
            fleetId = 1,
            fleetName = "Основной парк",
            type = "500v2",
            phone = "0671234567"
        ),
        Device(
            id = 2,
            name = "Honda Accord",
            imei = "234567890123456",
            fleetId = 1,
            fleetName = "Основной парк",
            type = "130",
            phone = "0679876543"
        ),
        Device(
            id = 3,
            name = "Ford Transit",
            imei = "345678901234567",
            fleetId = 2,
            fleetName = "Грузовой парк",
            type = "400",
            phone = null
        )
    )

    ScmvTheme {
        DeviceSelectionSheet(
            devices = sampleDevices,
            currentDeviceId = 1,
            onDeviceSelected = {},
            onDismiss = {}
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun DeviceSelectionCardPreview() {
    ScmvTheme {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            DeviceSelectionCard(
                device = Device(
                    id = 1,
                    name = "Toyota Camry",
                    imei = "123456789012345",
                    fleetId = 1,
                    fleetName = "Основной парк",
                    type = "500v2",
                    phone = "0671234567"
                ),
                isSelected = false,
                onClick = {}
            )

            DeviceSelectionCard(
                device = Device(
                    id = 2,
                    name = "Honda Accord (Selected)",
                    imei = "234567890123456",
                    fleetId = 1,
                    fleetName = "Основной парк",
                    type = "130",
                    phone = "0679876543"
                ),
                isSelected = true,
                onClick = {}
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun EmptyDevicesContentPreview() {
    ScmvTheme {
        EmptyDevicesContent(hasFilters = true)
    }
}
