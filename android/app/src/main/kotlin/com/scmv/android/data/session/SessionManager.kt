package com.scmv.android.data.session

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import com.scmv.android.util.Constants
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * DataStore-based session manager for handling user authentication state.
 * Provides reactive session flow and CRUD operations for session data.
 */
@Singleton
class SessionManager @Inject constructor(
    private val dataStore: DataStore<Preferences>
) {
    /**
     * Represents a user session with authentication credentials.
     */
    data class Session(
        val username: String,
        val password: String,
        val uid: Int,
        val rememberMe: Boolean
    )

    private companion object {
        val KEY_USERNAME = stringPreferencesKey(Constants.DataStoreKeys.USERNAME)
        val KEY_PASSWORD = stringPreferencesKey(Constants.DataStoreKeys.PASSWORD)
        val KEY_USER_ID = intPreferencesKey(Constants.DataStoreKeys.USER_ID)
        val KEY_REMEMBER_ME = booleanPreferencesKey(Constants.DataStoreKeys.REMEMBER_ME)
    }

    /**
     * Flow that emits the current session or null if no session exists.
     * Handles DataStore read errors gracefully by emitting null.
     */
    val sessionFlow: Flow<Session?> = dataStore.data
        .catch { exception ->
            // Handle IOException (e.g., file corruption) by emitting empty preferences
            if (exception is IOException) {
                emit(androidx.datastore.preferences.core.emptyPreferences())
            } else {
                throw exception
            }
        }
        .map { preferences ->
            val username = preferences[KEY_USERNAME]
            val password = preferences[KEY_PASSWORD]
            val uid = preferences[KEY_USER_ID]
            val rememberMe = preferences[KEY_REMEMBER_ME] ?: false

            // Only return a session if all required fields are present
            if (username != null && password != null && uid != null) {
                Session(
                    username = username,
                    password = password,
                    uid = uid,
                    rememberMe = rememberMe
                )
            } else {
                null
            }
        }

    /**
     * Saves a user session to DataStore.
     * 
     * @param username The user's username
     * @param password The user's password (stored securely in DataStore)
     * @param uid The user's unique identifier
     * @param rememberMe Whether to persist the session across app restarts
     */
    suspend fun saveSession(
        username: String,
        password: String,
        uid: Int,
        rememberMe: Boolean
    ) {
        dataStore.edit { preferences ->
            preferences[KEY_USERNAME] = username
            preferences[KEY_PASSWORD] = password
            preferences[KEY_USER_ID] = uid
            preferences[KEY_REMEMBER_ME] = rememberMe
        }
    }

    /**
     * Clears the current session from DataStore.
     * Removes all session-related preferences.
     */
    suspend fun clearSession() {
        dataStore.edit { preferences ->
            preferences.remove(KEY_USERNAME)
            preferences.remove(KEY_PASSWORD)
            preferences.remove(KEY_USER_ID)
            preferences.remove(KEY_REMEMBER_ME)
        }
    }

    /**
     * Retrieves the current session synchronously.
     * 
     * @return The current [Session] or null if no valid session exists
     */
    suspend fun getSession(): Session? {
        return try {
            sessionFlow.first()
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Checks if a valid session exists.
     * 
     * @return true if a user is logged in with valid session data
     */
    suspend fun isLoggedIn(): Boolean {
        return getSession() != null
    }

    /**
     * Checks if the user has enabled "Remember Me" for their session.
     * 
     * @return true if remember me is enabled, false otherwise
     */
    suspend fun isRememberMeEnabled(): Boolean {
        return getSession()?.rememberMe == true
    }

    /**
     * Updates only the remember me preference without modifying other session data.
     * 
     * @param rememberMe The new remember me value
     */
    suspend fun updateRememberMe(rememberMe: Boolean) {
        dataStore.edit { preferences ->
            preferences[KEY_REMEMBER_ME] = rememberMe
        }
    }
}
