package com.scmv.android.ui.screen.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.scmv.android.MainActivity
import com.scmv.android.R
import com.scmv.android.data.settings.AppSettingsData
import kotlin.math.roundToInt

/**
 * Settings screen for app configuration
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBackClick: () -> Unit,
    onLogout: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title)) },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.back)
                        )
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Change User / Logout Section
            Card(
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = stringResource(R.string.settings_account),
                        style = MaterialTheme.typography.titleMedium
                    )
                    
                    Button(
                        onClick = { viewModel.logout(onLogout) },
                        enabled = !uiState.isLoggingOut,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error
                        )
                    ) {
                        if (uiState.isLoggingOut) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onError
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                        } else {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.Logout,
                                contentDescription = null,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                        }
                        Text(stringResource(R.string.settings_change_user))
                    }
                }
            }

            // Map Display Settings
            Card(
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Text(
                        text = stringResource(R.string.settings_map_display),
                        style = MaterialTheme.typography.titleMedium
                    )
                    
                    // Track Line Thickness Slider
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = stringResource(R.string.settings_track_line_width),
                                style = MaterialTheme.typography.bodyMedium
                            )
                            Text(
                                text = "${uiState.trackLineWidth.roundToInt()} ${stringResource(R.string.unit_px)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Slider(
                            value = uiState.trackLineWidth,
                            onValueChange = { viewModel.setTrackLineWidth(it) },
                            valueRange = AppSettingsData.MIN_TRACK_LINE_WIDTH..AppSettingsData.MAX_TRACK_LINE_WIDTH,
                            steps = 21, // 2..24 = 23 values, 21 steps between
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    
                    // Stop Marker Size Slider
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = stringResource(R.string.settings_stop_marker_size),
                                style = MaterialTheme.typography.bodyMedium
                            )
                            Text(
                                text = "${uiState.stopMarkerSize} ${stringResource(R.string.unit_px)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Slider(
                            value = uiState.stopMarkerSize.toFloat(),
                            onValueChange = { viewModel.setStopMarkerSize(it.roundToInt()) },
                            valueRange = AppSettingsData.MIN_STOP_MARKER_SIZE.toFloat()..AppSettingsData.MAX_STOP_MARKER_SIZE.toFloat(),
                            steps = 4, // 12,16,20,24,28,32 = 6 values, 4 steps
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    
                    // Arrow Thickness Slider
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = stringResource(R.string.settings_arrow_thickness),
                                style = MaterialTheme.typography.bodyMedium
                            )
                            Text(
                                text = "${uiState.arrowSize} ${stringResource(R.string.unit_px)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Slider(
                            value = uiState.arrowSize.toFloat(),
                            onValueChange = { viewModel.setArrowSize(it.roundToInt()) },
                            valueRange = AppSettingsData.MIN_ARROW_SIZE.toFloat()..AppSettingsData.MAX_ARROW_SIZE.toFloat(),
                            steps = 6, // 2,4,6,8,10,12,14,16 = 8 values, 6 steps
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }
            
            // Language Settings
            Card(
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = stringResource(R.string.settings_language),
                        style = MaterialTheme.typography.titleMedium
                    )
                    
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        FilterChip(
                            selected = uiState.appLanguage == "uk",
                            onClick = { 
                                viewModel.setAppLanguage("uk")
                                // Apply locale and recreate activity
                                (context as? MainActivity)?.setAppLocale("uk")
                            },
                            label = { Text(stringResource(R.string.language_ukrainian)) },
                            modifier = Modifier.weight(1f)
                        )
                        FilterChip(
                            selected = uiState.appLanguage == "ru",
                            onClick = { 
                                viewModel.setAppLanguage("ru")
                                // Apply locale and recreate activity
                                (context as? MainActivity)?.setAppLocale("ru")
                            },
                            label = { Text(stringResource(R.string.language_russian)) },
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            }

            // Connection Status
            Card(
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = stringResource(R.string.settings_connection_status),
                        style = MaterialTheme.typography.titleMedium
                    )
                    
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier.size(12.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Surface(
                                modifier = Modifier.size(12.dp),
                                shape = MaterialTheme.shapes.small,
                                color = when {
                                    uiState.connectionStatus.contains("Connected") || 
                                    uiState.connectionStatus.contains("Підключено") ||
                                    uiState.connectionStatus.contains("Подключен") -> 
                                        MaterialTheme.colorScheme.primary
                                    uiState.connectionStatus.contains("Error") || 
                                    uiState.connectionStatus.contains("Помилка") ||
                                    uiState.connectionStatus.contains("Ошибка") -> 
                                        MaterialTheme.colorScheme.error
                                    else -> MaterialTheme.colorScheme.outline
                                }
                            ) {}
                        }
                        Text(
                            text = uiState.connectionStatus,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                    
                    Button(
                        onClick = { viewModel.reconnect() },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(stringResource(R.string.settings_reconnect))
                    }
                }
            }

            // Debug Info
            if (uiState.showDebugInfo) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    )
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.settings_debug_info),
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                        Text(
                            text = uiState.debugMessage,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                    }
                }
            }
        }
    }
}
