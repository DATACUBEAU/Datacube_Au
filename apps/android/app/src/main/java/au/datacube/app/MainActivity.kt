package au.datacube.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import au.datacube.app.ui.DataCubeViewModel
import au.datacube.app.ui.auth.AuthScreen
import au.datacube.app.ui.auth.AuthViewModel
import au.datacube.app.ui.chat.ChatScreen
import au.datacube.app.ui.documents.DocumentsScreen
import au.datacube.app.ui.documents.CollectionWorkspaceScreen
import au.datacube.app.ui.documents.CollectionWorkspaceScreen
import au.datacube.app.data.LocalDocument
import au.datacube.app.ui.home.HomeScreen
import au.datacube.app.ui.profile.ProfileScreen
import au.datacube.app.ui.study.StudyScreen
import au.datacube.app.ui.theme.DataCubeTheme
import au.datacube.app.work.LocalJobScheduler
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val authViewModel: AuthViewModel by viewModels()
    private val documentsViewModel: DataCubeViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)

        // Recover any locally interrupted jobs on startup.
        lifecycleScope.launch {
            runCatching { LocalJobScheduler(applicationContext).enqueueRecoverable() }
        }

        setContent {
            DataCubeTheme {
                DataCubeRoot(authViewModel, documentsViewModel)
            }
        }
        handleAuthIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAuthIntent(intent)
    }

    private fun handleAuthIntent(incoming: Intent?) {
        val uri = incoming?.data ?: return
        if (incoming.action != Intent.ACTION_VIEW ||
            uri.scheme != "datacube" ||
            uri.host != "auth-callback"
        ) return

        val code = uri.getQueryParameter("code")
        val state = uri.getQueryParameter("state")
        // Consume the launch URI so Activity recreation cannot replay the handoff.
        setIntent(Intent(incoming).apply { data = null })
        authViewModel.completeWebsiteAuthentication(code, state)
    }

}

// ── Navigation destinations ───────────────────────────────────────────────────

private sealed class Screen(val route: String) {
    object Auth : Screen("auth")
    object Home : Screen("home")
    object Documents : Screen("documents")
    object Collection : Screen("collection/{id}")
    object Collection : Screen("collection/{id}")
    object Study : Screen("study")
    object Chat : Screen("chat")
    object Profile : Screen("profile")
}

private data class BottomNavItem(
    val screen: Screen,
    val label: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

private val bottomNavItems = listOf(
    BottomNavItem(Screen.Home, "Home", Icons.Outlined.Home),
    BottomNavItem(Screen.Documents, "Documents", Icons.Outlined.Folder),
    BottomNavItem(Screen.Study, "Study", Icons.Outlined.School),
    BottomNavItem(Screen.Chat, "AU Chat", Icons.Outlined.Chat),
    BottomNavItem(Screen.Profile, "Profile", Icons.Outlined.Person)
)

// ── Root composable ───────────────────────────────────────────────────────────

@Composable
private fun DataCubeRoot(
    authViewModel: AuthViewModel,
    documentsViewModel: DataCubeViewModel
) {
    val authState by authViewModel.state.collectAsStateWithLifecycle()
    val documents by documentsViewModel.documents.collectAsStateWithLifecycle()
    val collections by documentsViewModel.collections.collectAsStateWithLifecycle()
    var collectionPickerTarget by remember { mutableStateOf<String?>(null) }
    val navController = rememberNavController()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var collectionPickerTarget by remember { mutableStateOf<String?>(null) }

    // Document picker
    val mimeTypes = arrayOf(
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain", "application/rtf", "text/markdown"
    )
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) {
            val name = context.contentResolver.query(
                uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
            )?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            } ?: "Imported document"
            documentsViewModel.import(uri, name) { result ->
                scope.launch {
                    snackbar.showSnackbar(
                        result.exceptionOrNull()?.message
                            ?: "Document saved. Local processing has been queued."
                    )
                }
            }
        }
    }

    val multiPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val targetCollection = collectionPickerTarget
        collectionPickerTarget = null
        if (targetCollection != null) {
            uris.forEach { uri ->
                val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                } ?: "Imported document"
                documentsViewModel.importToCollection(uri, name, targetCollection) { result ->
                    scope.launch { result.exceptionOrNull()?.let { snackbar.showSnackbar(it.message ?: "Could not add document.") } }
                }
            }
        }
    }

    val multiPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val targetId = collectionPickerTarget
        collectionPickerTarget = null
        if (targetId != null) {
            uris.forEach { uri ->
                val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                } ?: "Imported document"
                documentsViewModel.importToCollection(uri, name, targetId) { result ->
                    scope.launch {
                        result.exceptionOrNull()?.let { snackbar.showSnackbar(it.message ?: "Could not add document.") }
                    }
                }
            }
        }
    }

    // Loading / session-restore gate
    if (!authState.sessionRestored) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    // If not authenticated, show auth screen
    if (authState.user == null) {
        AuthScreen(
            viewModel = authViewModel,
            onOpenWebsite = { url ->
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            }
        )
        return
    }

    // Main app scaffold with Navigation Compose
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            val navBackStackEntry by navController.currentBackStackEntryAsState()
            val current = navBackStackEntry?.destination
            NavigationBar {
                bottomNavItems.forEach { item ->
                    NavigationBarItem(
                        selected = current?.hierarchy?.any { it.route == item.screen.route } == true,
                        onClick = {
                            navController.navigate(item.screen.route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(item.icon, contentDescription = item.label) },
                        label = { Text(item.label) }
                    )
                }
            }
        }
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Screen.Home.route,
            modifier = Modifier.padding(padding)
        ) {
            composable(Screen.Home.route) {
                HomeScreen(
                    user = authState.user,
                    recentDocuments = documents,
                    onImportDocument = { picker.launch(mimeTypes) },
                    onNavigateToDocuments = { navController.navigate(Screen.Documents.route) },
                    onNavigateToStudy = { navController.navigate(Screen.Study.route) },
                    onNavigateToChat = { navController.navigate(Screen.Chat.route) }
                )
            }
            composable(Screen.Documents.route) {
                DocumentsScreen(
                    documents = documents,
                    collections = collections,
                    onImport = { picker.launch(mimeTypes) },
                    onCreateCollection = documentsViewModel::createCollection,
                    onOpenCollection = { id -> navController.navigate("collection/$id") },
                    onDeleteCollection = documentsViewModel::deleteCollection,
                    onOpenDocument = { navController.navigate(Screen.Chat.route) },
                    onDelete = documentsViewModel::delete
                )
            }
            composable(Screen.Collection.route) { entry ->
                val collectionId = entry.arguments?.getString("id").orEmpty()
                val collection = collections.firstOrNull { it.id == collectionId }
                val collectionDocuments by documentsViewModel.observeCollectionDocuments(collectionId)
                    .collectAsStateWithLifecycle(initialValue = emptyList())
                CollectionWorkspaceScreen(
                    name = collection?.name ?: "Collection",
                    documents = collectionDocuments,
                    onBack = { navController.popBackStack() },
                    onAddDocuments = {
                        collectionPickerTarget = collectionId
                        multiPicker.launch(mimeTypes)
                    },
                    onOpenDocument = { navController.navigate(Screen.Chat.route) }
                )
            }
            composable(Screen.Study.route) {
                StudyScreen()
            }
            composable(Screen.Chat.route) {
                ChatScreen()
            }
            composable(Screen.Profile.route) {
                ProfileScreen(
                    user = authState.user,
                    onSignOut = { authViewModel.signOut() }
                )
            }
        }
    }
}
