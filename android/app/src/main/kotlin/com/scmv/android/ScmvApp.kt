package com.scmv.android

import android.app.Application
import dagger.hilt.android.HiltAndroidApp
import org.osmdroid.config.Configuration

@HiltAndroidApp
class ScmvApp : Application() {

    override fun onCreate() {
        super.onCreate()
        
        // Configure OSMdroid
        Configuration.getInstance().apply {
            // Set user agent for tile requests (required by OSM tile usage policy)
            userAgentValue = "${packageName}/${BuildConfig.VERSION_NAME}"
            
            // Set cache location
            osmdroidBasePath = filesDir
            osmdroidTileCache = cacheDir
            
            // Tile cache settings
            tileFileSystemCacheMaxBytes = 100L * 1024 * 1024 // 100 MB
            tileFileSystemCacheTrimBytes = 80L * 1024 * 1024 // 80 MB
            
            // Expiration settings
            expirationOverrideDuration = 1000L * 60 * 60 * 24 * 7 // 7 days
        }
    }
}
