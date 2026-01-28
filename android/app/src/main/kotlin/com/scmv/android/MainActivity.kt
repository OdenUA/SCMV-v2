package com.scmv.android

import android.content.Context
import android.content.res.Configuration
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.os.LocaleListCompat
import androidx.lifecycle.lifecycleScope
import com.scmv.android.data.session.SessionManager
import com.scmv.android.data.settings.AppSettings
import com.scmv.android.ui.navigation.Screen
import com.scmv.android.ui.navigation.ScmvNavHost
import com.scmv.android.ui.theme.ScmvTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.util.Locale
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var sessionManager: SessionManager
    
    @Inject
    lateinit var appSettings: AppSettings

    override fun attachBaseContext(newBase: Context) {
        // Load saved language setting synchronously before activity context is attached
        val prefs = newBase.getSharedPreferences("app_settings_prefs", Context.MODE_PRIVATE)
        val langCode = prefs.getString("app_language", "uk") ?: "uk"
        val locale = Locale(langCode)
        Locale.setDefault(locale)
        
        val config = Configuration(newBase.resources.configuration)
        config.setLocale(locale)
        val context = newBase.createConfigurationContext(config)
        super.attachBaseContext(context)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d("MainActivity", "onCreate called")
        
        // Apply saved language on startup using AppCompat for API 33+
        lifecycleScope.launch {
            val settings = appSettings.settingsFlow.first()
            setAppLocale(settings.appLanguage)
        }
        
        setContent {
            ScmvTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MainContent(sessionManager = sessionManager, appSettings = appSettings)
                }
            }
        }
    }
    
    /**
     * Sets the app locale based on language code.
     * Uses AppCompatDelegate.setApplicationLocales for API 33+ compatibility.
     * @param languageCode Language code ("uk" for Ukrainian, "ru" for Russian)
     */
    fun setAppLocale(languageCode: String) {
        // Save to shared prefs for attachBaseContext on next launch
        getSharedPreferences("app_settings_prefs", Context.MODE_PRIVATE)
            .edit()
            .putString("app_language", languageCode)
            .apply()
        
        // Use AppCompat locale API for proper locale handling
        val localeList = LocaleListCompat.forLanguageTags(languageCode)
        AppCompatDelegate.setApplicationLocales(localeList)
    }
}

/**
 * Main content composable that determines the start destination based on session state.
 * Shows a loading indicator while checking session, then navigates to appropriate screen.
 * Also observes language changes and recreates activity when language changes.
 */
@Composable
private fun MainContent(sessionManager: SessionManager, appSettings: AppSettings) {
    var isCheckingSession by remember { mutableStateOf(true) }
    var startDestination by remember { mutableStateOf(Screen.Login.route) }

    // Check session on start
    LaunchedEffect(Unit) {
        val session = sessionManager.getSession()
        startDestination = if (session != null && session.rememberMe) {
            // User has valid session with remember me enabled
            Screen.Map.route
        } else {
            // No session or remember me disabled
            Screen.Login.route
        }
        isCheckingSession = false
    }

    if (isCheckingSession) {
        // Show loading while checking session
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator()
        }
    } else {
        // Show navigation with determined start destination
        ScmvNavHost(startDestination = startDestination)
    }
}
