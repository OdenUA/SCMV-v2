package com.scmv.android.ui.theme

import androidx.compose.ui.graphics.Color

// Primary colors
val Primary = Color(0xFF2196F3)
val PrimaryLight = Color(0xFF64B5F6)
val PrimaryDark = Color(0xFF1976D2)
val PrimaryContainer = Color(0xFF1E3A5F)
val OnPrimary = Color(0xFFFFFFFF)
val OnPrimaryContainer = Color(0xFFD1E4FF)

// Secondary colors
val Secondary = Color(0xFF03A9F4)
val SecondaryContainer = Color(0xFF1A3A4A)
val OnSecondary = Color(0xFFFFFFFF)
val OnSecondaryContainer = Color(0xFFB8EAFF)

// Tertiary colors
val Tertiary = Color(0xFF7C4DFF)
val TertiaryContainer = Color(0xFF2D1F5E)
val OnTertiary = Color(0xFFFFFFFF)
val OnTertiaryContainer = Color(0xFFE8DDFF)

// Background and Surface colors (Dark theme optimized for maps)
val Background = Color(0xFF0D1117)
val OnBackground = Color(0xFFE6E6E6)
val Surface = Color(0xFF161B22)
val SurfaceVariant = Color(0xFF21262D)
val OnSurface = Color(0xFFE6E6E6)
val OnSurfaceVariant = Color(0xFFB0B0B0)
val SurfaceContainer = Color(0xFF1C2128)
val SurfaceContainerHigh = Color(0xFF242A32)
val SurfaceContainerHighest = Color(0xFF2D333B)

// Outline colors
val Outline = Color(0xFF484F58)
val OutlineVariant = Color(0xFF30363D)

// Error colors
val Error = Color(0xFFCF6679)
val ErrorContainer = Color(0xFF4A1A1A)
val OnError = Color(0xFF000000)
val OnErrorContainer = Color(0xFFFFDAD6)

// Track colors - for map visualization
object TrackColors {
    val Moving = Color(0xFF4CAF50)        // Green - vehicle in motion
    val MovingLight = Color(0xFF81C784)
    val MovingDark = Color(0xFF388E3C)
    
    val Stopped = Color(0xFFFF9800)       // Orange - vehicle stopped
    val StoppedLight = Color(0xFFFFB74D)
    val StoppedDark = Color(0xFFF57C00)
    
    val Idle = Color(0xFFFFC107)          // Amber - engine on but not moving
    val Offline = Color(0xFF9E9E9E)       // Gray - no signal
    val Unknown = Color(0xFF757575)       // Dark gray - unknown state
}

// Anomaly colors - for alerts and warnings
object AnomalyColors {
    val Critical = Color(0xFFF44336)      // Red - critical anomaly
    val CriticalLight = Color(0xFFE57373)
    val CriticalDark = Color(0xFFD32F2F)
    val CriticalContainer = Color(0xFF3D1A1A)
    
    val Warning = Color(0xFFFFEB3B)       // Yellow - warning anomaly
    val WarningLight = Color(0xFFFFF176)
    val WarningDark = Color(0xFFFBC02D)
    val WarningContainer = Color(0xFF3D3A1A)
    
    val Info = Color(0xFF9C27B0)          // Purple - informational anomaly
    val InfoLight = Color(0xFFBA68C8)
    val InfoDark = Color(0xFF7B1FA2)
    val InfoContainer = Color(0xFF2D1A3D)
    
    val Fuel = Color(0xFFE91E63)          // Pink - fuel-related anomaly
    val Geofence = Color(0xFF00BCD4)      // Cyan - geofence violation
    val Speed = Color(0xFFFF5722)         // Deep orange - speed violation
}

// Status colors for device states
object StatusColors {
    val Online = Color(0xFF4CAF50)
    val Offline = Color(0xFF9E9E9E)
    val Warning = Color(0xFFFF9800)
    val Error = Color(0xFFF44336)
}

// Map specific colors
object MapColors {
    val PolylineDefault = Color(0xFF2196F3)
    val PolylineSelected = Color(0xFF4CAF50)
    val MarkerDefault = Color(0xFF2196F3)
    val MarkerSelected = Color(0xFFFF9800)
    val GeofenceZone = Color(0x332196F3)  // Semi-transparent
    val ClusterBackground = Color(0xFF1976D2)
}
