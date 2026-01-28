package com.scmv.android.ui.screen.map.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.scmv.android.domain.model.TrackIssueType
import com.scmv.android.domain.model.TrackSegment
import java.time.format.DateTimeFormatter

/**
 * Panel displaying condensed route analysis with segments grouped by issue type.
 * Shows a summary at the top and expandable list of segments below.
 */
@Composable
fun AnalysisPanel(
    segments: List<TrackSegment>,
    isExpanded: Boolean,
    onToggleExpand: () -> Unit,
    onSegmentClick: (TrackSegment) -> Unit,
    modifier: Modifier = Modifier
) {
    val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")
    
    // Calculate summary stats
    val okSegments = segments.count { it.issues.isEmpty() }
    val problemSegments = segments.size - okSegments
    
    Surface(
        modifier = modifier
            .padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 4.dp,
        shadowElevation = 2.dp
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            // Header with summary
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onToggleExpand() },
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "Аналіз маршруту",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "✅ $okSegments без помилок, ⚠️ $problemSegments з проблемами",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Icon(
                    imageVector = if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = if (isExpanded) "Згорнути" else "Розгорнути"
                )
            }
            
            // Expandable segment list
            AnimatedVisibility(
                visible = isExpanded,
                enter = expandVertically(),
                exit = shrinkVertically()
            ) {
                Column(modifier = Modifier.padding(top = 8.dp)) {
                    HorizontalDivider(modifier = Modifier.padding(bottom = 8.dp))
                    
                    // Full height when expanded full screen, constrained otherwise
                    LazyColumn(
                        modifier = if (isExpanded) Modifier.weight(1f) else Modifier.heightIn(max = 300.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        items(segments) { segment ->
                            SegmentRow(
                                segment = segment,
                                timeFormatter = timeFormatter,
                                onClick = { onSegmentClick(segment) }
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Single row representing a track segment in the analysis panel.
 */
@Composable
private fun SegmentRow(
    segment: TrackSegment,
    timeFormatter: DateTimeFormatter,
    onClick: () -> Unit
) {
    val primaryIssue = segment.primaryIssue()
    val issueColor = Color(primaryIssue.color)
    
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
            .clickable(onClick = onClick)
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Color indicator
        Box(
            modifier = Modifier
                .size(12.dp)
                .clip(CircleShape)
                .background(issueColor)
        )
        
        Spacer(modifier = Modifier.width(8.dp))
        
        // Time range
        Text(
            text = "${segment.startTime.format(timeFormatter)} - ${segment.endTime.format(timeFormatter)}",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium
        )
        
        Spacer(modifier = Modifier.width(8.dp))
        
        // Issue label
        Text(
            text = segment.issuesLabel(),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f)
        )
        
        // Stats
        Text(
            text = "${segment.formattedDuration()}, ${segment.count}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        
        Spacer(modifier = Modifier.width(4.dp))
        
        // Focus button
        Icon(
            imageVector = Icons.Default.MyLocation,
            contentDescription = "Показати на карті",
            modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.primary
        )
    }
}
