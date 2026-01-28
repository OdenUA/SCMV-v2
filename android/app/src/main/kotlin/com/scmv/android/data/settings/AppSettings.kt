package com.scmv.android.data.settings

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import com.scmv.android.util.Constants
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * DataStore keys for app settings.
 */
object SettingsKeys {
    val TRACK_LINE_WIDTH = floatPreferencesKey(Constants.DataStoreKeys.TRACK_LINE_WIDTH)
    val STOP_MARKER_SIZE = intPreferencesKey(Constants.DataStoreKeys.STOP_MARKER_SIZE)
    val ARROW_SIZE = intPreferencesKey(Constants.DataStoreKeys.ARROW_SIZE)
    val APP_LANGUAGE = stringPreferencesKey(Constants.DataStoreKeys.APP_LANGUAGE)
}

/**
 * Data class representing app settings.
 */
data class AppSettingsData(
    val trackLineWidth: Float = DEFAULT_TRACK_LINE_WIDTH,
    val stopMarkerSize: Int = DEFAULT_STOP_MARKER_SIZE,
    val arrowSize: Int = DEFAULT_ARROW_SIZE,
    val appLanguage: String = DEFAULT_APP_LANGUAGE
) {
    companion object {
        const val DEFAULT_TRACK_LINE_WIDTH = 6f
        const val DEFAULT_STOP_MARKER_SIZE = 16  // Swapped: now smaller (was 24)
        const val DEFAULT_ARROW_SIZE = 8
        const val DEFAULT_APP_LANGUAGE = "uk"  // Ukrainian as default
        const val MIN_TRACK_LINE_WIDTH = 2f
        const val MAX_TRACK_LINE_WIDTH = 24f
        const val MIN_STOP_MARKER_SIZE = 12  // Swapped: smaller range
        const val MAX_STOP_MARKER_SIZE = 32  // Swapped: smaller range
        const val MIN_ARROW_SIZE = 2
        const val MAX_ARROW_SIZE = 16
    }
}

/**
 * DataStore-based settings manager for app preferences.
 * Provides reactive settings flow and CRUD operations.
 */
@Singleton
class AppSettings @Inject constructor(
    private val dataStore: DataStore<Preferences>
) {
    /**
     * Flow that emits current app settings.
     * Handles DataStore read errors gracefully by emitting defaults.
     */
    val settingsFlow: Flow<AppSettingsData> = dataStore.data
        .catch { exception ->
            if (exception is IOException) {
                emit(androidx.datastore.preferences.core.emptyPreferences())
            } else {
                throw exception
            }
        }
        .map { preferences ->
            AppSettingsData(
                trackLineWidth = preferences[SettingsKeys.TRACK_LINE_WIDTH]
                    ?: AppSettingsData.DEFAULT_TRACK_LINE_WIDTH,
                stopMarkerSize = preferences[SettingsKeys.STOP_MARKER_SIZE]
                    ?: AppSettingsData.DEFAULT_STOP_MARKER_SIZE,
                arrowSize = preferences[SettingsKeys.ARROW_SIZE]
                    ?: AppSettingsData.DEFAULT_ARROW_SIZE,
                appLanguage = preferences[SettingsKeys.APP_LANGUAGE]
                    ?: AppSettingsData.DEFAULT_APP_LANGUAGE
            )
        }

    /**
     * Updates the track line width setting.
     *
     * @param width The new track line width (2-12)
     */
    suspend fun setTrackLineWidth(width: Float) {
        val clampedWidth = width.coerceIn(
            AppSettingsData.MIN_TRACK_LINE_WIDTH,
            AppSettingsData.MAX_TRACK_LINE_WIDTH
        )
        dataStore.edit { preferences ->
            preferences[SettingsKeys.TRACK_LINE_WIDTH] = clampedWidth
        }
    }

    /**
     * Updates the stop marker size setting.
     *
     * @param size The new stop marker size (12-32)
     */
    suspend fun setStopMarkerSize(size: Int) {
        val clampedSize = size.coerceIn(
            AppSettingsData.MIN_STOP_MARKER_SIZE,
            AppSettingsData.MAX_STOP_MARKER_SIZE
        )
        dataStore.edit { preferences ->
            preferences[SettingsKeys.STOP_MARKER_SIZE] = clampedSize
        }
    }

    /**
     * Updates the arrow size setting.
     *
     * @param size The new arrow size (2-16)
     */
    suspend fun setArrowSize(size: Int) {
        val clampedSize = size.coerceIn(
            AppSettingsData.MIN_ARROW_SIZE,
            AppSettingsData.MAX_ARROW_SIZE
        )
        dataStore.edit { preferences ->
            preferences[SettingsKeys.ARROW_SIZE] = clampedSize
        }
    }

    /**
     * Updates the app language setting.
     *
     * @param languageCode The language code ("uk" or "ru")
     */
    suspend fun setAppLanguage(languageCode: String) {
        dataStore.edit { preferences ->
            preferences[SettingsKeys.APP_LANGUAGE] = languageCode
        }
    }

    /**
     * Resets all settings to defaults.
     */
    suspend fun resetToDefaults() {
        dataStore.edit { preferences ->
            preferences.remove(SettingsKeys.TRACK_LINE_WIDTH)
            preferences.remove(SettingsKeys.STOP_MARKER_SIZE)
        }
    }
}
