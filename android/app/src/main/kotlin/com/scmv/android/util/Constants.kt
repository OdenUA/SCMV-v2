package com.scmv.android.util

object Constants {
    // WebSocket configuration
    // IMPORTANT: port 4445 is HTTPS/WSS on the server (nginx will return 400 for plain HTTP).
    const val WS_URL = "wss://scmv.vpngps.com:4445"
    // Kept for compatibility with Settings UI; same as WS_URL because ws:// on :4445 is not supported.
    const val WS_URL_FALLBACK = "wss://scmv.vpngps.com:4445"
    const val RECONNECT_DELAY_MS = 5000L
    
    // Anomaly thresholds (mileage mode)
    const val GAP_THRESHOLD_MS = 600_000L      // 10 minutes gap
    const val SPEED_THRESHOLD_KPH = 200.0       // Max realistic speed
    const val JUMP_SPEED_KPH = 50.0             // Speed indicating position jump
    const val REAL_SPEED_KPH = 10.0             // Minimum real movement speed
    const val POSITION_JUMP_M = 800.0           // Position jump distance in meters
    
    // Raw track anomaly thresholds (from web anomalies.js)
    const val RAW_GAP_THRESHOLD_MS = 1_800_000L     // 30 minutes for raw track (changed from 5min)
    const val RAW_SPEED_THRESHOLD_KPH = 150.0       // 150 km/h for raw track
    const val RAW_POSITION_JUMP_M = 1200.0          // 1200 m for position jump in raw track
    
    // Stop visibility threshold (matching web version)
    const val STOP_MIN_DURATION_MINUTES = 5
    
    // Ukraine geographic bounds
    const val MIN_LAT = 44.3
    const val MAX_LAT = 52.4
    const val MIN_LON = 22.1
    const val MAX_LON = 40.2
    
    // Default map center (Ukraine)
    const val DEFAULT_LAT = 48.5
    const val DEFAULT_LON = 31.5
    const val DEFAULT_ZOOM = 6.0
    
    // DataStore keys
    object DataStoreKeys {
        const val USERNAME = "username"
        const val PASSWORD = "password"
        const val USER_ID = "user_id"
        const val REMEMBER_ME = "remember_me"
        const val AUTH_TOKEN = "auth_token"
        const val SELECTED_DEVICE_ID = "selected_device_id"
        const val MAP_STYLE = "map_style"
        const val TRACK_LINE_WIDTH = "track_line_width"
        const val STOP_MARKER_SIZE = "stop_marker_size"
        const val ARROW_SIZE = "arrow_size"
        const val APP_LANGUAGE = "app_language"
    }
    
    // Legacy keys (deprecated - use DataStoreKeys instead)
    @Deprecated("Use DataStoreKeys.AUTH_TOKEN", ReplaceWith("DataStoreKeys.AUTH_TOKEN"))
    const val PREF_AUTH_TOKEN = "auth_token"
    @Deprecated("Use DataStoreKeys.USER_ID", ReplaceWith("DataStoreKeys.USER_ID"))
    const val PREF_USER_ID = "user_id"
    @Deprecated("Use DataStoreKeys.SELECTED_DEVICE_ID", ReplaceWith("DataStoreKeys.SELECTED_DEVICE_ID"))
    const val PREF_SELECTED_DEVICE_ID = "selected_device_id"
    @Deprecated("Use DataStoreKeys.MAP_STYLE", ReplaceWith("DataStoreKeys.MAP_STYLE"))
    const val PREF_MAP_STYLE = "map_style"
    
    // API timeouts (milliseconds)
    const val CONNECT_TIMEOUT_MS = 30_000L
    const val READ_TIMEOUT_MS = 30_000L
    const val WRITE_TIMEOUT_MS = 30_000L
}
