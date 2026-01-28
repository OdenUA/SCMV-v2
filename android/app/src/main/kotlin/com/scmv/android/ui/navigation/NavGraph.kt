package com.scmv.android.ui.navigation

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.scmv.android.domain.model.Device
import com.scmv.android.ui.screen.devices.DevicesScreen
import com.scmv.android.ui.screen.login.LoginScreen
import com.scmv.android.ui.screen.map.MapScreen
import com.scmv.android.ui.screen.settings.SettingsScreen

/**
 * Sealed class representing all navigation destinations in the SCMV app.
 */
sealed class Screen(val route: String) {
    
    /** Login screen - authentication */
    object Login : Screen("login")
    
    /** Main map screen - displays all devices */
    object Map : Screen("map")
    
    /** Device list screen - shows all devices with status */
    object Devices : Screen("devices")
    
    /** Device logs screen - shows track history for a specific device */
    object Logs : Screen("logs/{deviceId}") {
        fun createRoute(deviceId: String): String = "logs/$deviceId"
        
        const val ARG_DEVICE_ID = "deviceId"
    }
    
    /** Device detail screen - shows detailed info for a specific device */
    object DeviceDetail : Screen("device/{deviceId}") {
        fun createRoute(deviceId: String): String = "device/$deviceId"
        
        const val ARG_DEVICE_ID = "deviceId"
    }
    
    /** Device track screen - shows live tracking for a specific device */
    object DeviceTrack : Screen("track/{deviceId}") {
        fun createRoute(deviceId: String): String = "track/$deviceId"
        
        const val ARG_DEVICE_ID = "deviceId"
    }
    
    /** Anomalies screen - shows all anomalies */
    object Anomalies : Screen("anomalies")
    
    /** Anomaly detail screen - shows specific anomaly details */
    object AnomalyDetail : Screen("anomaly/{anomalyId}") {
        fun createRoute(anomalyId: String): String = "anomaly/$anomalyId"
        
        const val ARG_ANOMALY_ID = "anomalyId"
    }
    
    /** Settings screen */
    object Settings : Screen("settings")
    
    /** About screen */
    object About : Screen("about")
}

/**
 * Navigation actions helper for common navigation patterns.
 */
class ScmvNavigationActions(private val navController: NavHostController) {
    
    fun navigateToLogin() {
        navController.navigate(Screen.Login.route) {
            popUpTo(0) { inclusive = true }
        }
    }
    
    fun navigateToMap() {
        navController.navigate(Screen.Map.route) {
            popUpTo(Screen.Login.route) { inclusive = true }
        }
    }
    
    fun navigateToDevices() {
        navController.navigate(Screen.Devices.route)
    }
    
    fun navigateToLogs(deviceId: String) {
        navController.navigate(Screen.Logs.createRoute(deviceId))
    }
    
    fun navigateToDeviceDetail(deviceId: String) {
        navController.navigate(Screen.DeviceDetail.createRoute(deviceId))
    }
    
    fun navigateToDeviceTrack(deviceId: String) {
        navController.navigate(Screen.DeviceTrack.createRoute(deviceId))
    }
    
    fun navigateToAnomalies() {
        navController.navigate(Screen.Anomalies.route)
    }
    
    fun navigateToAnomalyDetail(anomalyId: String) {
        navController.navigate(Screen.AnomalyDetail.createRoute(anomalyId))
    }
    
    fun navigateToSettings() {
        navController.navigate(Screen.Settings.route)
    }
    
    fun navigateBack() {
        navController.popBackStack()
    }
}

private const val ANIMATION_DURATION = 300

/**
 * Main navigation host for the SCMV app.
 *
 * @param navController The navigation controller to use.
 * @param startDestination The initial destination route.
 * @param modifier Modifier for the NavHost.
 * @param onDeviceSelected Optional callback when a device is selected from the Devices screen.
 */
@Composable
fun ScmvNavHost(
    navController: NavHostController = rememberNavController(),
    startDestination: String = Screen.Login.route,
    modifier: Modifier = Modifier,
    onDeviceSelected: ((Device) -> Unit)? = null
) {
    val navigationActions = ScmvNavigationActions(navController)
    NavHost(
        navController = navController,
        startDestination = startDestination,
        modifier = modifier,
        enterTransition = {
            slideIntoContainer(
                towards = AnimatedContentTransitionScope.SlideDirection.Start,
                animationSpec = tween(ANIMATION_DURATION)
            ) + fadeIn(animationSpec = tween(ANIMATION_DURATION))
        },
        exitTransition = {
            slideOutOfContainer(
                towards = AnimatedContentTransitionScope.SlideDirection.Start,
                animationSpec = tween(ANIMATION_DURATION)
            ) + fadeOut(animationSpec = tween(ANIMATION_DURATION))
        },
        popEnterTransition = {
            slideIntoContainer(
                towards = AnimatedContentTransitionScope.SlideDirection.End,
                animationSpec = tween(ANIMATION_DURATION)
            ) + fadeIn(animationSpec = tween(ANIMATION_DURATION))
        },
        popExitTransition = {
            slideOutOfContainer(
                towards = AnimatedContentTransitionScope.SlideDirection.End,
                animationSpec = tween(ANIMATION_DURATION)
            ) + fadeOut(animationSpec = tween(ANIMATION_DURATION))
        }
    ) {
        // Login screen
        composable(Screen.Login.route) {
            LoginScreen(
                onLoginSuccess = {
                    navigationActions.navigateToMap()
                }
            )
        }
        
        // Map screen
        composable(Screen.Map.route) { backStackEntry ->
            // Get selected device from saved state if navigating back from devices
            val selectedDeviceId = backStackEntry.savedStateHandle.get<String>("selectedDeviceId")
            
            MapScreen(
                selectedDeviceId = selectedDeviceId,
                onNavigateToSettings = { navigationActions.navigateToSettings() }
            )
        }
        
        // Devices list screen
        composable(Screen.Devices.route) {
            DevicesScreen(
                onDeviceClick = { device ->
                    // Pass selected device back to map
                    navController.previousBackStackEntry
                        ?.savedStateHandle
                        ?.set("selectedDeviceId", device.id.toString())
                    onDeviceSelected?.invoke(device)
                    navigationActions.navigateBack()
                }
            )
        }
        
        // Device logs screen with deviceId argument
        composable(
            route = Screen.Logs.route,
            arguments = listOf(
                navArgument(Screen.Logs.ARG_DEVICE_ID) {
                    type = NavType.StringType
                }
            )
        ) { backStackEntry ->
            val deviceId = backStackEntry.arguments?.getString(Screen.Logs.ARG_DEVICE_ID) ?: ""
            // TODO: Implement LogsScreen(deviceId)
        }
        
        // Device detail screen
        composable(
            route = Screen.DeviceDetail.route,
            arguments = listOf(
                navArgument(Screen.DeviceDetail.ARG_DEVICE_ID) {
                    type = NavType.StringType
                }
            )
        ) { backStackEntry ->
            val deviceId = backStackEntry.arguments?.getString(Screen.DeviceDetail.ARG_DEVICE_ID) ?: ""
            // TODO: Implement DeviceDetailScreen(deviceId)
        }
        
        // Device track screen
        composable(
            route = Screen.DeviceTrack.route,
            arguments = listOf(
                navArgument(Screen.DeviceTrack.ARG_DEVICE_ID) {
                    type = NavType.StringType
                }
            )
        ) { backStackEntry ->
            val deviceId = backStackEntry.arguments?.getString(Screen.DeviceTrack.ARG_DEVICE_ID) ?: ""
            // TODO: Implement DeviceTrackScreen(deviceId)
        }
        
        // Anomalies screen
        composable(Screen.Anomalies.route) {
            // TODO: Implement AnomaliesScreen()
        }
        
        // Anomaly detail screen
        composable(
            route = Screen.AnomalyDetail.route,
            arguments = listOf(
                navArgument(Screen.AnomalyDetail.ARG_ANOMALY_ID) {
                    type = NavType.StringType
                }
            )
        ) { backStackEntry ->
            val anomalyId = backStackEntry.arguments?.getString(Screen.AnomalyDetail.ARG_ANOMALY_ID) ?: ""
            // TODO: Implement AnomalyDetailScreen(anomalyId)
        }
        
        // Settings screen
        composable(
            Screen.Settings.route,
            enterTransition = {
                slideIntoContainer(
                    towards = AnimatedContentTransitionScope.SlideDirection.Start,
                    animationSpec = tween(ANIMATION_DURATION)
                ) + fadeIn(animationSpec = tween(ANIMATION_DURATION))
            },
            exitTransition = {
                slideOutOfContainer(
                    towards = AnimatedContentTransitionScope.SlideDirection.Start,
                    animationSpec = tween(ANIMATION_DURATION)
                ) + fadeOut(animationSpec = tween(ANIMATION_DURATION))
            },
            popEnterTransition = {
                slideIntoContainer(
                    towards = AnimatedContentTransitionScope.SlideDirection.End,
                    animationSpec = tween(ANIMATION_DURATION)
                ) + fadeIn(animationSpec = tween(ANIMATION_DURATION))
            },
            popExitTransition = {
                slideOutOfContainer(
                    towards = AnimatedContentTransitionScope.SlideDirection.End,
                    animationSpec = tween(ANIMATION_DURATION)
                ) + fadeOut(animationSpec = tween(ANIMATION_DURATION))
            }
        ) {
            SettingsScreen(
                onBackClick = { navigationActions.navigateBack() },
                onLogout = { navigationActions.navigateToLogin() }
            )
        }
        
        // About screen
        composable(Screen.About.route) {
            // TODO: Implement AboutScreen()
        }
    }
}

/**
 * Extension function to add the login destination to a NavGraphBuilder.
 */
fun NavGraphBuilder.loginDestination(
    content: @Composable (NavBackStackEntry) -> Unit
) {
    composable(Screen.Login.route) { backStackEntry ->
        content(backStackEntry)
    }
}

/**
 * Extension function to add the map destination to a NavGraphBuilder.
 */
fun NavGraphBuilder.mapDestination(
    content: @Composable (NavBackStackEntry) -> Unit
) {
    composable(Screen.Map.route) { backStackEntry ->
        content(backStackEntry)
    }
}

/**
 * Extension function to add the devices destination to a NavGraphBuilder.
 */
fun NavGraphBuilder.devicesDestination(
    content: @Composable (NavBackStackEntry) -> Unit
) {
    composable(Screen.Devices.route) { backStackEntry ->
        content(backStackEntry)
    }
}

/**
 * Extension function to add the logs destination to a NavGraphBuilder.
 */
fun NavGraphBuilder.logsDestination(
    content: @Composable (NavBackStackEntry, String) -> Unit
) {
    composable(
        route = Screen.Logs.route,
        arguments = listOf(
            navArgument(Screen.Logs.ARG_DEVICE_ID) {
                type = NavType.StringType
            }
        )
    ) { backStackEntry ->
        val deviceId = backStackEntry.arguments?.getString(Screen.Logs.ARG_DEVICE_ID) ?: ""
        content(backStackEntry, deviceId)
    }
}
