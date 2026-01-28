package com.scmv.android.ui.screen.map.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.GpsOff
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.scmv.android.R
import com.scmv.android.domain.model.Anomaly
import com.scmv.android.domain.model.AnomalyType
import com.scmv.android.domain.model.GroupedAnomaly
import com.scmv.android.util.AnomalyDetector
import java.time.format.DateTimeFormatter

/**
 * Anomaly colors matching web version (anomalies.js).
 */
object AnomalyPanelColors {
    val TimeGap = Color(0xFFFF4136)       // Red #ff4136
    val SpeedSpike = Color(0xFFFFDC00)    // Yellow #ffdc00
    val PositionJump = Color(0xFFFF4136)  // Red #ff4136
    val OutOfBounds = Color(0xFF800080)   // Purple #800080
}

/**
 * Gets the color for an anomaly type.
 */
fun getAnomalyColor(type: AnomalyType): Color {
    return when (type) {
        AnomalyType.TIME_GAP -> AnomalyPanelColors.TimeGap
        AnomalyType.SPEED_SPIKE -> AnomalyPanelColors.SpeedSpike
        AnomalyType.POSITION_JUMP -> AnomalyPanelColors.PositionJump
        AnomalyType.OUT_OF_BOUNDS -> AnomalyPanelColors.OutOfBounds
    }
}

/**
 * Gets the icon for an anomaly type.
 */
fun getAnomalyIcon(type: AnomalyType): ImageVector {
    return when (type) {
        AnomalyType.TIME_GAP -> Icons.Default.Timeline
        AnomalyType.SPEED_SPIKE -> Icons.Default.Speed
        AnomalyType.POSITION_JUMP -> Icons.Default.GpsOff
        AnomalyType.OUT_OF_BOUNDS -> Icons.Default.Warning
    }
}

/**
 * Gets the display name for an anomaly type.
 */
@Composable
fun getAnomalyTypeName(type: AnomalyType): String {
    return when (type) {
        AnomalyType.TIME_GAP -> stringResource(R.string.anomaly_time_gap)
        AnomalyType.SPEED_SPIKE -> stringResource(R.string.anomaly_speed_spike)
        AnomalyType.POSITION_JUMP -> stringResource(R.string.anomaly_position_jump)
        AnomalyType.OUT_OF_BOUNDS -> stringResource(R.string.anomaly_out_of_bounds)
    }
}

/**
 * Collapsible panel showing list of detected anomalies.
 * Each row shows: type icon, time range, description.
 * Click on row focuses on the anomaly on the map.
 * Type badges act as filters to show/hide specific anomaly types.
 * Consecutive anomalies of the same type are grouped together.
 *
 * @param anomalies List of detected anomalies
 * @param onAnomalyClick Callback when an anomaly row is clicked (receives the first anomaly in group)
 * @param modifier Modifier for the panel
 */
@Composable
fun AnomalyPanel(
    anomalies: List<Anomaly>,
    onAnomalyClick: (Anomaly) -> Unit,
    modifier: Modifier = Modifier
) {
    var isExpanded by remember { mutableStateOf(false) }
    var selectedTypes by remember { mutableStateOf(AnomalyType.entries.toSet()) }
    val timeFormatter = remember { DateTimeFormatter.ofPattern("HH:mm:ss") }
    val dateTimeFormatter = remember { DateTimeFormatter.ofPattern("dd.MM.yy HH:mm:ss") }

    if (anomalies.isEmpty()) return

    // Group consecutive anomalies of the same type
    val groupedAnomalies = remember(anomalies) {
        AnomalyDetector.groupConsecutiveAnomalies(anomalies)
    }

    // Filter grouped anomalies based on selected types
    val filteredGroupedAnomalies = remember(groupedAnomalies, selectedTypes) {
        groupedAnomalies.filter { it.type in selectedTypes }
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp),
        shape = RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Column {
            // Header row - always visible
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { isExpanded = !isExpanded }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Warning,
                        contentDescription = null,
                        tint = AnomalyPanelColors.TimeGap,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    // Show total anomaly count and group count
                    val totalCount = anomalies.size
                    val groupCount = groupedAnomalies.size
                    val countText = if (totalCount != groupCount) {
                        stringResource(R.string.anomalies_count, totalCount) + " ($groupCount груп)"
                    } else {
                        stringResource(R.string.anomalies_count, totalCount)
                    }
                    Text(
                        text = countText,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Medium
                    )
                }

                // Count by type
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    AnomalyType.entries.forEach { type ->
                        val count = anomalies.count { it.type == type }
                        if (count > 0) {
                            AnomalyBadge(
                                type = type,
                                count = count,
                                isActive = type in selectedTypes,
                                onClick = {
                                    selectedTypes = if (type in selectedTypes) {
                                        // Prevent deselecting all types
                                        if (selectedTypes.size > 1) {
                                            selectedTypes - type
                                        } else {
                                            selectedTypes
                                        }
                                    } else {
                                        selectedTypes + type
                                    }
                                }
                            )
                        }
                    }

                    IconButton(
                        onClick = { isExpanded = !isExpanded },
                        modifier = Modifier.size(24.dp)
                    ) {
                        Icon(
                            imageVector = if (isExpanded) Icons.Default.ExpandMore else Icons.Default.ExpandLess,
                            contentDescription = if (isExpanded) stringResource(R.string.anomaly_collapse) else stringResource(R.string.anomaly_expand),
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
            }

            // Expandable content
            AnimatedVisibility(
                visible = isExpanded,
                enter = expandVertically(),
                exit = shrinkVertically()
            ) {
                Column {
                    HorizontalDivider(
                        color = MaterialTheme.colorScheme.outlineVariant,
                        thickness = 1.dp
                    )

                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height((filteredGroupedAnomalies.size.coerceAtMost(5) * 60).dp)
                    ) {
                        items(filteredGroupedAnomalies) { groupedAnomaly ->
                            GroupedAnomalyRow(
                                groupedAnomaly = groupedAnomaly,
                                timeFormatter = timeFormatter,
                                dateTimeFormatter = dateTimeFormatter,
                                onClick = { onAnomalyClick(groupedAnomaly.firstAnomaly) }
                            )
                            if (groupedAnomaly != filteredGroupedAnomalies.last()) {
                                HorizontalDivider(
                                    modifier = Modifier.padding(horizontal = 16.dp),
                                    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
                                    thickness = 0.5.dp
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Small badge showing anomaly type icon and count.
 * Clickable to toggle filter for that type.
 * When inactive, appears greyed out/outlined.
 */
@Composable
private fun AnomalyBadge(
    type: AnomalyType,
    count: Int,
    isActive: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val color = getAnomalyColor(type)

    Row(
        modifier = modifier
            .clip(RoundedCornerShape(4.dp))
            .clickable(onClick = onClick)
            .background(
                if (isActive) color.copy(alpha = 0.2f) else Color.Transparent
            )
            .padding(horizontal = 4.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Icon(
            imageVector = getAnomalyIcon(type),
            contentDescription = null,
            tint = if (isActive) color else color.copy(alpha = 0.4f),
            modifier = Modifier.size(12.dp)
        )
        Text(
            text = count.toString(),
            style = MaterialTheme.typography.labelSmall,
            color = if (isActive) color else color.copy(alpha = 0.4f),
            fontWeight = if (isActive) FontWeight.Medium else FontWeight.Normal
        )
    }
}

/**
 * Single anomaly row in the list.
 */
@Composable
private fun AnomalyRow(
    anomaly: Anomaly,
    timeFormatter: DateTimeFormatter,
    dateTimeFormatter: DateTimeFormatter,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val color = getAnomalyColor(anomaly.type)
    val icon = getAnomalyIcon(anomaly.type)
    val typeName = getAnomalyTypeName(anomaly.type)

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Type icon with colored background
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(color.copy(alpha = 0.2f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = typeName,
                tint = color,
                modifier = Modifier.size(20.dp)
            )
        }

        Spacer(modifier = Modifier.width(12.dp))

        Column(
            modifier = Modifier.weight(1f)
        ) {
            Text(
                text = typeName,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface
            )

            // Time range
            val startTime = anomaly.startPoint.timestamp
            val endTime = anomaly.endPoint.timestamp
            val timeText = if (startTime == endTime) {
                startTime.format(dateTimeFormatter)
            } else {
                "${startTime.format(timeFormatter)} → ${endTime.format(timeFormatter)}"
            }

            Text(
                text = timeText,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            // Description
            Text(
                text = anomaly.description,
                style = MaterialTheme.typography.bodySmall,
                color = color,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

/**
 * Grouped anomaly row in the list.
 * Shows count badge for groups with multiple anomalies.
 */
@Composable
private fun GroupedAnomalyRow(
    groupedAnomaly: GroupedAnomaly,
    timeFormatter: DateTimeFormatter,
    dateTimeFormatter: DateTimeFormatter,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val color = getAnomalyColor(groupedAnomaly.type)
    val icon = getAnomalyIcon(groupedAnomaly.type)
    val typeName = getAnomalyTypeName(groupedAnomaly.type)

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Type icon with colored background and count badge
        Box(
            modifier = Modifier.size(36.dp),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(color.copy(alpha = 0.2f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = typeName,
                    tint = color,
                    modifier = Modifier.size(20.dp)
                )
            }
            
            // Count badge for grouped anomalies
            if (groupedAnomaly.isGrouped) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .size(16.dp)
                        .clip(CircleShape)
                        .background(color),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = if (groupedAnomaly.count > 99) "99+" else groupedAnomaly.count.toString(),
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        Spacer(modifier = Modifier.width(12.dp))

        Column(
            modifier = Modifier.weight(1f)
        ) {
            // Type name with count if grouped
            val displayName = if (groupedAnomaly.isGrouped) {
                "$typeName (×${groupedAnomaly.count})"
            } else {
                typeName
            }
            
            Text(
                text = displayName,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface
            )

            // Time range - from first to last anomaly
            val startTime = groupedAnomaly.startPoint.timestamp
            val endTime = groupedAnomaly.endPoint.timestamp
            val timeText = if (startTime == endTime) {
                startTime.format(dateTimeFormatter)
            } else {
                "${startTime.format(timeFormatter)} → ${endTime.format(timeFormatter)}"
            }

            Text(
                text = timeText,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            // Description - aggregated for groups
            Text(
                text = groupedAnomaly.getGroupDescription(),
                style = MaterialTheme.typography.bodySmall,
                color = color,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
