package au.datacube.app.ui.models

import au.datacube.app.ui.common.DataCubeDialog
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.work.WorkInfo
import au.datacube.app.models.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelsScreen(
    installed: (String) -> Boolean,
    onGet: (ModelSpec) -> Unit,
    onImport: (ModelSpec) -> Unit,
    onOpenVault: () -> Unit = {},
    onChooseFolder: () -> Unit = {},
    folderRevision: Int = 0,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val device = remember(context) { DeviceCapabilityScanner.scan(context) }
    val bestChatId = remember(device) {
        ModelRecommendations.bestChatModel(device.ramGb, device.freeStorageGb)
    }
    val recommendedChat = bestChatId?.let(ModelCatalog::find)
        ?: ModelCatalog.find("qwen3-0.6b-litert")
    val hasFolder = remember(context, folderRevision) { ModelVaultStore(context).folder() != null }
    var advanced by remember { mutableStateOf(false) }
    var activeRevision by remember { mutableIntStateOf(0) }
    val activeChat = remember(context, activeRevision) { ActiveLocalChatModel(context).selected() }
    Scaffold(modifier = modifier, topBar = {
        TopAppBar(title = { Text("On-device models", fontWeight = FontWeight.Bold) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Outlined.ArrowBack, "Back") } })
    }) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item {
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.primaryContainer
                ) {
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Recommended for your device", fontWeight = FontWeight.SemiBold)
                        Text("${device.ramGb} GB RAM · ${device.freeStorageGb} GB free",
                            style = MaterialTheme.typography.bodySmall)
                        Text("One chat model + one search model. Voice is optional.",
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            item {
                Text("Model folder", style = MaterialTheme.typography.titleMedium)
                OutlinedButton(onClick = onChooseFolder, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.FolderOpen, null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (hasFolder) "Change model folder" else "Choose folder before download")
                }
                Text(if (hasFolder) "Downloaded models are backed up here."
                    else "Choose Documents or SD card. No downloads start automatically.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            item {
                Text("1 · Document search", style = MaterialTheme.typography.titleMedium)
                val spec = ModelCatalog.find(ModelRecommendations.bestSearchModel())
                ModelCard(spec, { installed(spec.id) }, onGet, onImport,
                    canDownload = hasFolder, onChooseFolder = onChooseFolder)
            }
            item {
                Text("2 · Chat & reasoning", style = MaterialTheme.typography.titleMedium)
                Text(if (bestChatId == null) "Limited free memory. Model may not run smoothly."
                    else "Suggested for this device", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                ModelCard(recommendedChat, { installed(recommendedChat.id) }, onGet, onImport,
                    canDownload = hasFolder, onChooseFolder = onChooseFolder,
                    isActive = activeChat == recommendedChat.id,
                    onUse = {
                        ActiveLocalChatModel(context).setSelected(recommendedChat.id)
                        activeRevision++
                    })
            }
            item {
                Text("3 · Voice", style = MaterialTheme.typography.titleMedium)
                Text("Natural narration · optional offline pack",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                val spec = ModelCatalog.find("kokoro-82m-cpu")
                ModelCard(spec, { installed(spec.id) }, onGet, onImport,
                    canDownload = hasFolder, onChooseFolder = onChooseFolder)
            }
            item {
                OutlinedButton(onClick = onOpenVault, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.Inventory2, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Restore existing models")
                }
                TextButton(onClick = { advanced = !advanced }, modifier = Modifier.fillMaxWidth()) {
                    Text(if (advanced) "Hide other models" else "Other models")
                    Icon(if (advanced) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null)
                }
            }
            if (advanced) {
                ModelCatalog.models.filter {
                    it.id != recommendedChat.id &&
                        it.id != ModelRecommendations.bestSearchModel() &&
                        it.id != "kokoro-82m-cpu"
                }.forEach { spec ->
                    item(key = spec.id) {
                        ModelCard(spec, { installed(spec.id) }, onGet, onImport,
                            canDownload = hasFolder, onChooseFolder = onChooseFolder,
                            isActive = activeChat == spec.id,
                            onUse = {
                                ActiveLocalChatModel(context).setSelected(spec.id)
                                activeRevision++
                            })
                    }
                }
            }
        }
    }
}

@Composable
private fun ModelCard(
    model: ModelSpec,
    installed: () -> Boolean,
    onGet: (ModelSpec) -> Unit,
    onImport: (ModelSpec) -> Unit,
    canDownload: Boolean,
    onChooseFolder: () -> Unit,
    isActive: Boolean = false,
    onUse: () -> Unit = {}
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val downloader = remember(context) { VerifiedModelDownloadManager(context) }
    val verified = remember(model.id) { VerifiedModelDownloads.find(model.id) }
    val changes = remember(model.id) {
        if (verified != null) downloader.observe(model.id) else null
    }
    val works by (changes?.collectAsState(initial = emptyList()) ?: remember {
        mutableStateOf(emptyList<WorkInfo>())
    })
    val work = works.firstOrNull {
        it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED
    } ?: works.lastOrNull()
    val working = work?.state == WorkInfo.State.RUNNING ||
        work?.state == WorkInfo.State.ENQUEUED || work?.state == WorkInfo.State.BLOCKED
    val complete = installed()
    var chooseNetwork by remember(model.id) { mutableStateOf(false) }
    var revision by remember(model.id) { mutableIntStateOf(0) }
    val paused = remember(revision, work?.state) { verified != null && downloader.paused(model.id) }
    val percent = work?.progress?.getInt(VerifiedModelDownloadWorker.KEY_PROGRESS, -1) ?: -1
    val error = work?.outputData?.getString(VerifiedModelDownloadWorker.KEY_ERROR)

    if (chooseNetwork && verified != null) {
        DataCubeDialog(
            onDismissRequest = { chooseNetwork = false },
            title = { Text("Download " + model.name + "?") },
            text = { Text(verified.displaySize + " · " + verified.license +
                ". Installed locally and backed up to your chosen folder. Needs space for two copies.") },
            confirmButton = {
                Column {
                    Button(onClick = {
                        downloader.start(model.id, wifiOnly = true)
                        revision += 1
                        chooseNetwork = false
                    }, modifier = Modifier.fillMaxWidth()) { Text("Wi-Fi only") }
                    TextButton(onClick = {
                        downloader.start(model.id, wifiOnly = false)
                        revision += 1
                        chooseNetwork = false
                    }, modifier = Modifier.fillMaxWidth()) { Text("Allow mobile data") }
                }
            },
            dismissButton = { TextButton(onClick = { chooseNetwork = false }) { Text("Not now") } }
        )
    }

    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), tonalElevation = 1.dp) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(model.name, fontWeight = FontWeight.SemiBold)
                    Text(model.description, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall)
                }
                if (complete) Icon(Icons.Outlined.CheckCircle, "Files imported",
                    tint = MaterialTheme.colorScheme.primary)
            }
            Text(
                when {
                    complete -> when (model.role) {
                        ModelRole.EMBEDDING -> "Ready for local indexing"
                        ModelRole.VOICE -> "Ready for Podcast"
                        ModelRole.GENERATION -> if (isActive) "Active chat model" else "Installed"
                    }
                    verified != null -> verified.displaySize + " · " + verified.license
                    else -> "Suggested RAM: " + model.minRamGb + " GB+"
                }, style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (complete && model.role == ModelRole.GENERATION && !isActive) {
                Button(onClick = onUse, modifier = Modifier.fillMaxWidth()) { Text("Use for AU Chat") }
            }
            if (working && !complete) {
                Text(if (work?.state == WorkInfo.State.RUNNING)
                    work.progress.getString(VerifiedModelDownloadWorker.KEY_STAGE) ?: "Downloading"
                    else "Queued · waiting for network and battery",
                    style = MaterialTheme.typography.bodySmall)
                if (percent >= 0) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LinearProgressIndicator(progress = { percent / 100f }, modifier = Modifier.weight(1f))
                        Spacer(Modifier.width(9.dp))
                        Text(percent.toString() + "%", style = MaterialTheme.typography.labelSmall)
                    }
                } else LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { scope.launch { downloader.pause(model.id); revision += 1 } },
                        modifier = Modifier.weight(1f)) { Text("Pause") }
                    TextButton(
                        onClick = { scope.launch { downloader.cancel(model.id); revision += 1 } },
                        modifier = Modifier.weight(1f)) { Text("Cancel") }
                }
            } else if (!complete && paused && verified != null) {
                Text("Paused. Partial download retained.", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = {
                        downloader.resume(model.id)
                        revision += 1
                    }, modifier = Modifier.weight(1f)) { Text("Resume") }
                    OutlinedButton(
                        onClick = { scope.launch { downloader.cancel(model.id); revision += 1 } },
                        modifier = Modifier.weight(1f)) { Text("Remove partial") }
                }
            } else if (!complete) {
                if (!error.isNullOrBlank() && work?.state == WorkInfo.State.FAILED) {
                    Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                if (verified != null) {
                    Button(onClick = {
                        if (canDownload) chooseNetwork = true else onChooseFolder()
                    }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Outlined.Download, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(if (!canDownload) "Choose folder to download"
                        else if (work?.state == WorkInfo.State.FAILED) "Retry download" else "Download")
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { onGet(model) }, modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(horizontal = 8.dp)) { Text("Publisher") }
                    OutlinedButton(onClick = { onImport(model) }, modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(horizontal = 8.dp)) { Text("Import files") }
                }
            }
        }
    }
}
