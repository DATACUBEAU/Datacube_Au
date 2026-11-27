package au.datacube.app

import au.datacube.app.ui.common.DataCubeDialog
import au.datacube.app.ui.common.AuSpotlightState
import au.datacube.app.ui.common.AuSpotlightOverlay
import au.datacube.app.ui.common.AuTourStep
import au.datacube.app.ui.common.TourPage
import au.datacube.app.ui.common.LocalAuSpotlight
import au.datacube.app.ui.common.AuTutorialOffer
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.semantics.clearAndSetSemantics
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.core.tween
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.activity.compose.ReportDrawnWhen
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.doOnPreDraw
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import au.datacube.app.ui.DataCubeViewModel
import au.datacube.app.ui.auth.AuthScreen
import au.datacube.app.ui.auth.AuthViewModel
import au.datacube.app.ui.documents.DocumentsScreen
import au.datacube.app.ui.documents.CollectionWorkspaceScreen
import au.datacube.app.ui.documents.DocumentWorkspaceScreen
import au.datacube.app.ui.documents.DocumentChatSessions
import au.datacube.app.ui.chat.DiscsScreen
import au.datacube.app.data.LocalDocument
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.ui.documents.DocumentPreparationScreen
import au.datacube.app.models.ModelBackupManager
import au.datacube.app.models.ModelBackupPreview
import au.datacube.app.models.ModelVaultStore
import au.datacube.app.ui.models.ModelVaultScreen
import au.datacube.app.models.LocalModelLibrary
import au.datacube.app.models.ModelCatalog
import au.datacube.app.models.ModelSpec
import au.datacube.app.ui.models.ModelsScreen
import au.datacube.app.ui.theme.ThemePreference
import au.datacube.app.ui.theme.ThemePreferenceStore
import au.datacube.app.ui.home.HomeScreen
import au.datacube.app.updates.AndroidUpdateCheckWorker
import au.datacube.app.updates.AndroidUpdateManager
import au.datacube.app.ui.profile.ProfileScreen
import au.datacube.app.ui.theme.DataCubeTheme
import au.datacube.app.work.LocalJobScheduler
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val authViewModel: AuthViewModel by viewModels()
    private val documentsViewModel: DataCubeViewModel by viewModels()
    private var mobileSignInRequest: String? = null
    private var ignoreViewIntentOnResume = false
    private var workspaceRecoveryStarted = false

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        // Metadata-only periodic checks; no APK/model is downloaded until user consent.
        AndroidUpdateCheckWorker.schedule(applicationContext)
        val updateJustCompleted = AndroidUpdateManager.consumeUpdatedOnLaunch(applicationContext)
        receiveMobileSignInIntent(intent, "cold")

        setContent {
            val themeStore = remember { ThemePreferenceStore(applicationContext) }
            var displayMode by remember { mutableStateOf(themeStore.get()) }
            val systemDark = isSystemInDarkTheme()
            val dark = when (displayMode) {
                ThemePreference.DARK -> true
                ThemePreference.LIGHT -> false
                ThemePreference.SYSTEM -> systemDark
            }
            DataCubeTheme(darkTheme = dark) {
                DataCubeRoot(
                    authViewModel,
                    { documentsViewModel },
                    openBrowser = ::openBrowser,
                    onWorkspaceDrawn = ::recoverWorkspaceJobs,
                    updateJustCompleted = updateJustCompleted,
                    themePreference = displayMode,
                    onThemeChange = { selected ->
                        themeStore.set(selected)
                        displayMode = selected
                    }
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        receiveMobileSignInIntent(intent, "warm")
    }

    override fun onResume() {
        super.onResume()
        val request = mobileSignInRequest
        val ignoreIntent = ignoreViewIntentOnResume
        mobileSignInRequest = null
        ignoreViewIntentOnResume = false
        if (!ignoreIntent) authViewModel.resumeMobileSignIn(request)
    }

    override fun onPause() {
        authViewModel.pauseMobileSignIn()
        super.onPause()
    }

    private fun receiveMobileSignInIntent(intent: Intent?, launch: String) {
        if (intent?.action != Intent.ACTION_VIEW) {
            ignoreViewIntentOnResume = false
            return
        }
        val request = mobileSignInRequestId(intent)
        if (request == null) {
            ignoreViewIntentOnResume = mobileSignInRequest == null
            Log.i(TAG, "mobile_return_ignored launch=$launch")
            return
        }
        mobileSignInRequest = request
        ignoreViewIntentOnResume = false
        Log.i(TAG, "mobile_return_received launch=$launch")
    }

    private fun openBrowser(uri: Uri) {
        startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
    }

    private fun recoverWorkspaceJobs() {
        if (workspaceRecoveryStarted) return
        workspaceRecoveryStarted = true
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                LocalJobScheduler(applicationContext).enqueueRecoverable()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                Log.w(TAG, "local_job_recovery_failed")
            }
        }
    }

    private companion object {
        const val TAG = "DataCubeStartup"
    }
}

// ── Navigation destinations ───────────────────────────────────────────────────

private sealed class Screen(val route: String) {
    object Auth : Screen("auth")
    object Home : Screen("home")
    object Documents : Screen("documents")
    object Discs : Screen("discs")
    object Collection : Screen("collection/{id}")
    object CollectionChat : Screen("collection-chat/{id}")
    object Document : Screen("document/{id}?prompt={prompt}&tab={tab}&collection={collection}")
    object Settings : Screen("settings")
    object Models : Screen("models")
    object ModelVault : Screen("model-vault")
}

// ── Root composable ───────────────────────────────────────────────────────────

@Composable
internal fun DataCubeRoot(
    authViewModel: AuthViewModel,
    documentsViewModel: () -> DataCubeViewModel,
    openBrowser: (Uri) -> Unit = {},
    onWorkspaceDrawn: () -> Unit = {},
    updateJustCompleted: Boolean = false,
    themePreference: ThemePreference = ThemePreference.SYSTEM,
    onThemeChange: (ThemePreference) -> Unit = {}
) {
    val authState by authViewModel.state.collectAsStateWithLifecycle()
    ReportDrawnWhen { authState.sessionRestored && !authState.isLoading }

    // Never flash Welcome while an existing encrypted session is still loading.
    if (!authState.sessionRestored) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }
    if (authState.user == null) {
        AuthScreen(
            viewModel = authViewModel,
            openBrowser = openBrowser
        )
        return
    }

    key(authState.user?.id) {
        AuthenticatedWorkspace(
            authState, authViewModel, documentsViewModel(),
            themePreference, onThemeChange, updateJustCompleted
        )
        val view = LocalView.current
        DisposableEffect(view) {
            val listener = view.doOnPreDraw { view.post { onWorkspaceDrawn() } }
            onDispose { listener.removeListener() }
        }
    }
}

@Composable
private fun AuthenticatedWorkspace(
    authState: au.datacube.app.ui.auth.AuthState,
    authViewModel: AuthViewModel,
    documentsViewModel: DataCubeViewModel,
    themePreference: ThemePreference,
    onThemeChange: (ThemePreference) -> Unit,
    updateJustCompleted: Boolean
) {
    val documents by documentsViewModel.documents.collectAsStateWithLifecycle()
    val collections by documentsViewModel.collections.collectAsStateWithLifecycle()
    val navController = rememberNavController()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    LaunchedEffect(authState.error) { authState.error?.let { snackbar.showSnackbar(it) } }
    LaunchedEffect(authState.user?.id) { authState.user?.id?.let { au.datacube.app.ui.common.ResponseFeedbackStore.schedule(context,it) } }
    val accountId = requireNotNull(authState.user).id
    val setupPrefs = remember(context) {
        context.getSharedPreferences("datacube_model_setup", android.content.Context.MODE_PRIVATE)
    }
    val userSetupKey = "offered_" + accountId
    val communityKey = "community_offered_" + accountId
    val firstRun = remember(accountId) { !setupPrefs.getBoolean(userSetupKey,false) }
    val communityAlreadyOffered = remember(accountId) {
        setupPrefs.getBoolean(communityKey,false) ||
            context.getSharedPreferences("au_community_prompt_v1",android.content.Context.MODE_PRIVATE)
                .getBoolean(accountId,false)
    }
    var initialCommunity by rememberSaveable(accountId) { mutableStateOf(firstRun && !communityAlreadyOffered) }
    var manualCommunity by rememberSaveable(accountId) { mutableStateOf(false) }
    var tutorialOffer by rememberSaveable(accountId) { mutableStateOf(firstRun && communityAlreadyOffered) }
    var waitingForCommunity by rememberSaveable(accountId) { mutableStateOf(false) }
    var tourIndex by rememberSaveable(accountId) { mutableIntStateOf(-1) }
    val tour = remember(accountId) { AuSpotlightState() }
    val tourStep = AuTourStep.entries.getOrNull(tourIndex)
    SideEffect { tour.activeTarget=tourStep?.target }
    fun finishCommunityOffer() {
        initialCommunity=false
        setupPrefs.edit().putBoolean(communityKey,true).apply()
        tutorialOffer=true
    }
    val communityLauncher=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        if(waitingForCommunity) {
            waitingForCommunity=false
            tutorialOffer=true
        }
    }
    if(initialCommunity || manualCommunity) {
        au.datacube.app.ui.models.CommunityInviteDialog(
            onDismiss={
                if(initialCommunity) finishCommunityOffer()
                manualCommunity=false
            },
            onJoin={
                if(initialCommunity) {
                    initialCommunity=false
                    setupPrefs.edit().putBoolean(communityKey,true).apply()
                    waitingForCommunity=true
                    runCatching {
                        communityLauncher.launch(Intent(Intent.ACTION_VIEW,
                            Uri.parse(au.datacube.app.ui.models.ModelSetupGuide.COMMUNITY_URL)))
                    }.onFailure {
                        waitingForCommunity=false
                        tutorialOffer=true
                        scope.launch { snackbar.showSnackbar("Community link could not be opened.") }
                    }
                } else {
                    manualCommunity=false
                    if(!au.datacube.app.ui.models.ModelSetupGuide.openCommunity(context))
                        scope.launch { snackbar.showSnackbar("Community link could not be opened.") }
                }
            }
        )
    }
    if(tutorialOffer && !waitingForCommunity && !initialCommunity && !manualCommunity) {
        AuTutorialOffer(
            onStart={
                setupPrefs.edit().putBoolean(userSetupKey,true).apply()
                tutorialOffer=false
                tourIndex=0
            },
            onDecline={
                setupPrefs.edit().putBoolean(userSetupKey,true).apply()
                tutorialOffer=false
            }
        )
    }
    LaunchedEffect(updateJustCompleted) {
        if (updateJustCompleted) {
            snackbar.showSnackbar("DataCube AU updated successfully. Your local data is retained.")
        }
    }
    var collectionPickerTarget by remember { mutableStateOf<String?>(null) }
    var modelRevision by remember { mutableIntStateOf(0) }
    var modelImportTarget by remember { mutableStateOf<ModelSpec?>(null) }
    var vaultRevision by remember { mutableIntStateOf(0) }
    var selectedRestoreUri by remember { mutableStateOf<Uri?>(null) }
    var selectedRestorePreview by remember { mutableStateOf<ModelBackupPreview?>(null) }
    var restoringModels by remember { mutableStateOf(false) }
    var restorePercent by remember { mutableIntStateOf(0) }
    val vaultStore = remember(context) { ModelVaultStore(context.applicationContext) }
    fun offerRestore(uri: Uri) {
        if (restoringModels) return
        scope.launch {
            runCatching { ModelBackupManager(context).inspectBackup(uri) }
                .onSuccess { preview ->
                    selectedRestoreUri = uri
                    selectedRestorePreview = preview
                }
                .onFailure { error ->
                    snackbar.showSnackbar(error.message ?: "Unrecognized model archive.")
                }
        }
    }
    if (selectedRestoreUri != null && selectedRestorePreview != null) {
        val archiveUri = requireNotNull(selectedRestoreUri)
        val preview = requireNotNull(selectedRestorePreview)
        DataCubeDialog(
            onDismissRequest = {
                if (!restoringModels) {
                    selectedRestoreUri = null
                    selectedRestorePreview = null
                }
            },
            title = { Text(if (restoringModels) "Restoring models" else "Smart Recovery") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text(preview.labels.joinToString("\n"))
                    Text("${preview.fileCount} files · ${preview.totalBytes / (1024 * 1024)} MB")
                    Text("Files will be checked before installation. Existing models will not be replaced.")
                    if (restoringModels) {
                        LinearProgressIndicator(progress = { restorePercent / 100f }, modifier = Modifier.fillMaxWidth())
                        Text("Verifying and restoring · $restorePercent%")
                    }
                }
            },
            confirmButton = {
                TextButton(enabled = !restoringModels, onClick = {
                    restoringModels = true
                    restorePercent = 0
                    scope.launch {
                        val message = try {
                            val summary = ModelBackupManager(context).restoreBackup(archiveUri) { copied, total ->
                                kotlinx.coroutines.withContext(Dispatchers.Main) {
                                    restorePercent = if (total > 0) (copied * 100 / total).toInt().coerceIn(0, 99) else 0
                                }
                            }
                            modelRevision += 1
                            "Restored ${summary.modelCount} model(s) with verified files."
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (error: Exception) {
                            error.message ?: "Could not restore the archive."
                        } finally {
                            restoringModels = false
                            selectedRestoreUri = null
                            selectedRestorePreview = null
                        }
                        snackbar.showSnackbar(message)
                    }
                }) { Text("Restore") }
            },
            dismissButton = {
                TextButton(enabled = !restoringModels, onClick = {
                    selectedRestoreUri = null
                    selectedRestorePreview = null
                }) { Text("Cancel") }
            }
        )
    }
    val modelVaultFolderPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri ->
        if (uri != null) {
            runCatching { vaultStore.selectFolder(uri) }
                .onSuccess { vaultRevision += 1 }
                .onFailure { error ->
                    scope.launch { snackbar.showSnackbar(error.message ?: "Cannot use this folder.") }
                }
        }
    }
    val modelStore = remember(context) { LocalModelLibrary(context.applicationContext) }
    val installedModelIds = remember(modelRevision) {
        ModelCatalog.models.filter { modelStore.installed(it.id) }.map { it.id }.toSet()
    }
    val taskNotifications = remember(context) { au.datacube.app.notifications.LocalNotificationService(context.applicationContext) }
    val notificationPrefs = remember(context) { context.getSharedPreferences("au_notification_onboarding_v1", android.content.Context.MODE_PRIVATE) }
    var notificationOffer by rememberSaveable(accountId) { mutableStateOf(false) }
    val notificationPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) taskNotifications.showPermissionExample()
        scope.launch { snackbar.showSnackbar(if (granted) "Task notifications enabled." else "Notifications remain off. You can enable them in Settings.") }
    }
    LaunchedEffect(initialCommunity, tutorialOffer, waitingForCommunity, tourIndex, manualCommunity) {
        if (!initialCommunity && !tutorialOffer && !waitingForCommunity && !manualCommunity && tourIndex < 0 &&
            !notificationPrefs.getBoolean("offered", false)) {
            taskNotifications.ensureChannels()
            if (taskNotifications.enabled()) {
                notificationPrefs.edit().putBoolean("offered", true).apply()
            } else notificationOffer = true
        }
    }
    fun finishNotificationOffer(allow: Boolean) {
        notificationPrefs.edit().putBoolean("offered", true).apply()
        notificationOffer = false
        if (!allow) return
        if (android.os.Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        } else if (taskNotifications.enabled()) taskNotifications.showPermissionExample()
        else runCatching { context.startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)) }
    }
    if (notificationOffer) DataCubeDialog(
        onDismissRequest = { finishNotificationOffer(false) },
        title = { Text("Enable task notifications?") },
        text = { Text("See document processing progress, study reminders and completed AU tasks even while using another app. You can change this in Settings.") },
        confirmButton = { Button(onClick = { finishNotificationOffer(true) }) { Text("Allow notifications") } },
        dismissButton = { TextButton(onClick = { finishNotificationOffer(false) }) { Text("Not now") } }
    )
    // Multi-select document picker. Imports are copied sequentially and scheduled locally.
    val mimeTypes = arrayOf(
        "application/pdf",
        "text/plain",
        "text/markdown"
    )

    val modelBackupLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument(ModelBackupManager.BACKUP_MIME_TYPE)
    ) { destination ->
        if (destination != null) {
            scope.launch {
                runCatching { ModelBackupManager(context).exportBackup(destination) }
                    .onSuccess { summary ->
                        snackbar.showSnackbar(
                            "Backed up ${summary.modelCount} model(s), ${summary.fileCount} file(s)."
                        )
                    }
                    .onFailure { error ->
                        snackbar.showSnackbar(error.message ?: "Could not create the model backup.")
                    }
            }
        }
    }

    val modelRestoreLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { source ->
        if (source != null) offerRestore(source)
    }

    val modelImportPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        val target = modelImportTarget
        modelImportTarget = null
        if (target != null && uris.isNotEmpty()) {
            scope.launch {
                try {
                    LocalModelLibrary(context.applicationContext).install(target, uris)
                    modelRevision += 1
                    snackbar.showSnackbar("${target.name} files imported. Runtime activation comes next.")
                } catch (error: Exception) {
                    snackbar.showSnackbar(error.message ?: "Model import failed.")
                }
            }
        }
    }

    val multiPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val targetCollection = collectionPickerTarget
        collectionPickerTarget = null
        if (uris.isNotEmpty()) {
            if (targetCollection != null) {
                documentsViewModel.importManyToCollection(uris, targetCollection) { result ->
                    scope.launch {
                        result.onSuccess { count ->
                            snackbar.showSnackbar("$count document(s) added to collection.")
                        }.onFailure { error ->
                            snackbar.showSnackbar(error.message ?: "Could not finish importing documents.")
                        }
                    }
                }
            } else {
                documentsViewModel.importMany(uris) { result ->
                    scope.launch {
                        result.onSuccess { count ->
                            snackbar.showSnackbar("$count document(s) imported. Local processing has been queued.")
                        }.onFailure { error ->
                            snackbar.showSnackbar(error.message ?: "Could not import the selected documents.")
                        }
                    }
                }
            }
        }
    }

    var importSetupPrompt by remember { mutableStateOf<au.datacube.app.ui.models.ModelSetupGuide.Readiness?>(null) }
    var pendingCollection by remember { mutableStateOf<String?>(null) }
    fun launchImport(collectionId:String?) {
        collectionPickerTarget = collectionId
        multiPicker.launch(mimeTypes)
    }
    fun requestImport(collectionId:String? = null) {
        val state = au.datacube.app.ui.models.ModelSetupGuide.readiness(context)
        if (state.needsSetup) {
            pendingCollection = collectionId
            importSetupPrompt = state
        } else launchImport(collectionId)
    }
    importSetupPrompt?.let { state ->
        au.datacube.app.ui.models.MissingModelPrompt(state,
            onDismiss = { importSetupPrompt = null; pendingCollection = null },
            onOpenModels = {
                importSetupPrompt = null
                pendingCollection = null
                navController.navigate(Screen.Models.route)
            },
            onImportAnyway = {
                val target = pendingCollection
                importSetupPrompt = null
                pendingCollection = null
                launchImport(target)
            })
    }

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route
    val isWorkspaceRoute = currentRoute == Screen.Collection.route || currentRoute == Screen.Document.route
    val tourRoute=when(tourStep?.page) {
        TourPage.HOME -> Screen.Home.route
        TourPage.DOCUMENTS -> Screen.Documents.route
        TourPage.GIST -> Screen.Discs.route
        TourPage.SETTINGS -> Screen.Settings.route
        TourPage.MODELS -> Screen.Models.route
        null -> null
    }
    LaunchedEffect(tourRoute,currentRoute) {
        if(tourRoute!=null && currentRoute!=null && currentRoute!=tourRoute) {
            if(tourRoute==Screen.Home.route) {
                if(!navController.popBackStack(Screen.Home.route,false))
                    navController.navigate(Screen.Home.route) { launchSingleTop=true }
            } else navController.navigate(tourRoute) {
                popUpTo(Screen.Home.route) { inclusive=false }
                launchSingleTop=true
            }
        }
    }
    BackHandler(enabled=tourStep!=null) { tourIndex=-1 }

    // Nested workspaces consume system back and return to their parent instead of closing the app.
    BackHandler(enabled = tourStep==null && isWorkspaceRoute && navController.previousBackStackEntry != null) {
        navController.popBackStack()
    }

    // Keep the top notice OUTSIDE Scaffold's snackbar slot. A fillMaxSize()
    // snackbar there is measured as an entire screen and steals all nav space.
    // A normal-height host above Scaffold reserves only its actual banner height.
    CompositionLocalProvider(LocalAuSpotlight provides if(tourStep!=null) tour else null) {
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().then(if(tourStep!=null) Modifier.clearAndSetSemantics {} else Modifier)) {
        SnackbarHost(
            hostState = snackbar,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
        )
        Scaffold(modifier = Modifier.weight(1f)) { padding ->
        NavHost(
            navController = navController,
            startDestination = Screen.Home.route,
            modifier = Modifier.padding(padding),
            enterTransition = { if(tourStep!=null) fadeIn(tween(100)) else fadeIn(tween(170)) + slideInHorizontally(tween(170)) { it / 18 } },
            exitTransition = { if(tourStep!=null) fadeOut(tween(100)) else fadeOut(tween(130)) + slideOutHorizontally(tween(130)) { -it / 24 } },
            popEnterTransition = { fadeIn(tween(170)) + slideInHorizontally(tween(170)) { -it / 24 } },
            popExitTransition = { if(tourStep!=null) fadeOut(tween(100)) else fadeOut(tween(130)) + slideOutHorizontally(tween(130)) { it / 24 } }
        ) {
            composable(Screen.Home.route) {
                HomeScreen(
                    user = authState.user,
                    recentDocuments = documents,
                    onImportDocument = { requestImport() },
                    onNavigateToDocuments = { navController.navigate(Screen.Documents.route) },
                    onNavigateToGist = { navController.navigate(Screen.Discs.route) },
                    onNavigateToChat = { navController.navigate(Screen.Documents.route) },
                    onOpenDocument = { id -> navController.navigate("document/$id") },
                    onSendPromptToDocument = { id, prompt ->
                        navController.navigate("document/$id?prompt=" + Uri.encode(prompt) + "&tab=0")
                    },
                    onNavigateSettings = { navController.navigate(Screen.Settings.route) },
                    onOpenModels = { navController.navigate(Screen.Models.route) }
                )
            }
            composable(Screen.Discs.route) {
                DiscsScreen(
                    accountId = requireNotNull(authState.user).id,
                    documents = documents,
                    onBack = { navController.popBackStack() },
                    onOpenDocument = { id -> navController.navigate("document/$id") },
                    onOpenDocuments = { navController.navigate(Screen.Documents.route) },
                    onOpenModels = { navController.navigate(Screen.Models.route) }
                )
            }
            composable(Screen.Documents.route) {
                DocumentsScreen(
                    documents = documents,
                    collections = collections,
                    onImport = { requestImport() },
                    onNavigateHome = { navController.navigate(Screen.Home.route) },
                    onNavigateSettings = { navController.navigate(Screen.Settings.route) },
                    onNavigateToDiscs = { navController.navigate(Screen.Discs.route) },
                    onCreateCollection = { name, done -> documentsViewModel.createCollection(name, done = done) },
                    onOpenCollection = { id -> navController.navigate("collection/$id") },
                    onDeleteCollection = documentsViewModel::deleteCollection,
                    onOpenDocument = { id -> navController.navigate("document/$id") },
                    onDelete = documentsViewModel::delete
                )
            }
            composable(Screen.Collection.route) { entry ->
                val collectionId = entry.arguments?.getString("id").orEmpty()
                val collection = collections.firstOrNull { it.id == collectionId }
                val collectionDocumentsFlow = remember(collectionId) {
                    documentsViewModel.observeCollectionDocuments(collectionId)
                }
                val collectionDocuments by collectionDocumentsFlow.collectAsStateWithLifecycle(initialValue = emptyList())
                CollectionWorkspaceScreen(
                    name = collection?.name ?: "Collection",
                    documents = collectionDocuments,
                    onBack = { navController.popBackStack() },
                    onAddDocuments = {
                        requestImport(collectionId)
                    },
                    onRemoveDocument = { id ->
                        documentsViewModel.removeDocumentFromCollection(collectionId, id)
                    },
                    onOpenDocument = { id -> navController.navigate("document/$id?collection=" + Uri.encode(collectionId)) },
                    onOpenCollectionChat = {
                        if (collectionId.isNotBlank()) navController.navigate("collection-chat/$collectionId")
                    }
                )
            }
            composable(Screen.CollectionChat.route) { entry ->
                val collectionId = entry.arguments?.getString("id").orEmpty()
                val collection = collections.firstOrNull { it.id == collectionId }
                val collectionDocumentsFlow = remember(collectionId) {
                    documentsViewModel.observeCollectionDocuments(collectionId)
                }
                val collectionDocs by collectionDocumentsFlow.collectAsStateWithLifecycle(
                    initialValue = emptyList()
                )
                val allowedIds = collectionDocs.map { it.id }.toSet()
                DiscsScreen(
                    accountId = requireNotNull(authState.user).id,
                    documents = documents.filter { it.document.id in allowedIds },
                    onBack = { navController.popBackStack() },
                    onOpenDocument = { id ->
                        if (id in allowedIds) navController.navigate("document/$id?collection=" + Uri.encode(collectionId))
                    },
                    onOpenDocuments = { navController.navigate("collection/$collectionId") },
                    collectionId = collectionId,
                    collectionName = collection?.name ?: "Collection AU",
                    onOpenModels = { navController.navigate(Screen.Models.route) }
                )
            }
            composable(
                Screen.Document.route,
                arguments = listOf(
                    androidx.navigation.navArgument("prompt") {
                        type = androidx.navigation.NavType.StringType
                        defaultValue = ""
                    },
                    androidx.navigation.navArgument("tab") {
                        type = androidx.navigation.NavType.IntType
                        defaultValue = 0
                    },
                    androidx.navigation.navArgument("collection") {
                        type = androidx.navigation.NavType.StringType
                        defaultValue = ""
                    }
                )
            ) { entry ->
                val documentId = entry.arguments?.getString("id").orEmpty()
                val initialPrompt = entry.arguments?.getString("prompt")
                val initialTab = entry.arguments?.getInt("tab") ?: 0
                val sourceCollection = entry.arguments?.getString("collection").orEmpty()
                val relatedFlow = remember(sourceCollection) { documentsViewModel.observeCollectionDocuments(sourceCollection) }
                val related by relatedFlow.collectAsStateWithLifecycle(initialValue = emptyList())
                val collectionScope = sourceCollection.takeIf { it.isNotBlank() && related.any { doc -> doc.id == documentId } }
                val relatedDocuments = if (collectionScope != null) related else emptyList()
                val selectedProcessing = documents.firstOrNull { it.document.id == documentId }
                val selectedDocument = selectedProcessing?.document
                var textPreview by remember(documentId) { mutableStateOf<String?>(null) }
                var previewTruncated by remember(documentId) { mutableStateOf(false) }
                var previewLoading by remember(documentId) { mutableStateOf(true) }
                var previewError by remember(documentId) { mutableStateOf<String?>(null) }

                LaunchedEffect(documentId, selectedProcessing?.extractionStatus) {
                    previewLoading = true
                    previewError = null
                    textPreview = null
                    try {
                        val preview = documentsViewModel.loadDocumentTextPreview(documentId)
                        textPreview = preview?.text
                        previewTruncated = preview?.truncated == true
                    } catch (error: Exception) {
                        previewError = error.message ?: "The local document preview could not be loaded."
                    } finally {
                        previewLoading = false
                    }
                }

                val extractionReady = when (selectedProcessing?.extractionStatus) {
                    LocalJobStatus.COMPLETED, LocalJobStatus.FAILED, LocalJobStatus.CANCELLED -> true
                    else -> !textPreview.isNullOrBlank()
                }
                if (selectedDocument != null && !extractionReady) {
                    DocumentPreparationScreen(
                        documentName = selectedDocument.name,
                        extractionStatus = selectedProcessing?.extractionStatus,
                        extractionProgress = selectedProcessing?.extractionProgress,
                        onBack = { navController.popBackStack() }
                    )
                } else if (selectedDocument != null) {
                    DocumentWorkspaceScreen(
                        document = selectedDocument,
                        accountId = requireNotNull(authState.user).id,
                        initialPrompt = initialPrompt,
                        initialTab = initialTab,
                        collectionId = collectionScope,
                        collectionDocuments = relatedDocuments,
                        extractionStatus = selectedProcessing?.extractionStatus,
                        extractionProgress = selectedProcessing?.extractionProgress,
                        extractionError = selectedProcessing?.extractionError,
                        textPreview = textPreview,
                        previewTruncated = previewTruncated,
                        previewLoading = previewLoading,
                        previewError = previewError,
                        onBack = { navController.popBackStack() },
                        onOpenModels = { navController.navigate(Screen.Models.route) }
                    )
                } else {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("Document is unavailable. Return to your library and refresh.")
                    }
                }
            }
            composable(Screen.Settings.route) {
                ProfileScreen(
                    user = authState.user,
                    onBack = { navController.popBackStack() },
                    onSignOut = {
                         au.datacube.app.work.AuBackgroundWork.cancelAll()
                         au.datacube.app.ui.common.AuReadAloudSessions.stopAll()
                         au.datacube.app.audio.AuAudioPlayback.stop()
                         DocumentChatSessions.releaseAll()
                         au.datacube.app.ui.documents.GeneratedStudySessions.releaseAll()
                         au.datacube.app.audio.PodcastOverviewSession.stopAll()
                         authViewModel.signOut()
                     },
                    onBackupModels = {
                        modelBackupLauncher.launch(
                            "${ModelBackupManager.BACKUP_FILE_PREFIX}-${System.currentTimeMillis()}.zip"
                        )
                    },
                    onRestoreModels = {
                        modelRestoreLauncher.launch(arrayOf(ModelBackupManager.BACKUP_MIME_TYPE, "application/octet-stream", "application/x-zip-compressed"))
                    },
                    themePreference = themePreference,
                    onThemeChange = onThemeChange,
                    onOpenModels = { navController.navigate(Screen.Models.route) },
                    onOpenVault = { navController.navigate(Screen.ModelVault.route) },
                    onShowSetupGuide = { tutorialOffer=true },
                    onOpenCommunity = { manualCommunity=true },
                    onOpenSubscription = {
                        val url = BuildConfig.AUTH_WEBSITE_URL.trimEnd('/') + "/dashboard/settings/usage"
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    },
                    onEnableNotifications = {
                        if (android.os.Build.VERSION.SDK_INT >= 33) {
                            notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                        } else {
                            scope.launch { snackbar.showSnackbar("Notifications are controlled in Android settings.") }
                        }
                    }
                )
            }
            composable(Screen.ModelVault.route) {
                ModelVaultScreen(
                    folderRevision = vaultRevision,
                    installedRevision = modelRevision,
                    installed = { id -> modelStore.installed(id) },
                    onChooseFolder = { modelVaultFolderPicker.launch(null) },
                    onRestoreArchive = { uri -> offerRestore(uri) },
                    onOpenArchive = {
                        modelRestoreLauncher.launch(arrayOf(ModelBackupManager.BACKUP_MIME_TYPE, "application/octet-stream", "application/x-zip-compressed"))
                    },
                    onBack = { navController.popBackStack() }
                )
            }
            composable(Screen.Models.route) {
                ModelsScreen(
                    installed = { id -> modelStore.installed(id) },
                    onOpenVault = { navController.navigate(Screen.ModelVault.route) },
                    onChooseFolder = { modelVaultFolderPicker.launch(null) },
                    folderRevision = vaultRevision,
                    onGet = { model ->
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(model.sourcePage)))
                    },
                    onImport = { model ->
                        modelImportTarget = model
                        modelImportPicker.launch(arrayOf("*/*"))
                    },
                    onBack = { navController.popBackStack() }
                )
            }
        }
        }
    }
    if(tourStep!=null) {
        AuSpotlightOverlay(tour,tourStep,tourIndex,
            onNext={ if(currentRoute==tourRoute) tourIndex=if(tourIndex==AuTourStep.entries.lastIndex) -1 else tourIndex+1 },
            onSkip={tourIndex=-1})
    }
    }
    }
}
