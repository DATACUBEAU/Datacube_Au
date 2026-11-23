package au.datacube.app.ui.models

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
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    Scaffold(modifier = modifier, topBar = {
        TopAppBar(title = { Text("On-device models", fontWeight = FontWeight.Bold) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Outlined.ArrowBack, "Back") } })
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                Text("Search model", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("For local semantic document search.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            ModelCatalog.models.filter { it.role == ModelRole.EMBEDDING }.forEach { spec ->
                item(key = spec.id) {
                    ModelCard(spec, { installed(spec.id) }, onGet, onImport)
                }
            }
            item {
                Spacer(Modifier.height(4.dp))
                Text("Chat models", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("Optional. Choose based on device memory.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            ModelCatalog.models.filter { it.role == ModelRole.GENERATION }.forEach { spec ->
                item(key = spec.id) { ModelCard(spec, { installed(spec.id) }, onGet, onImport) }
            }
            item {
                Text("Model files remain on your device. Downloading does not enable generation or semantic search until their local runtimes are connected.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(4.dp))
            }
        }
    }
}

@Composable
private fun ModelCard(
    model: ModelSpec,
    installed: () -> Boolean,
    onGet: (ModelSpec) -> Unit,
    onImport: (ModelSpec) -> Unit
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
        AlertDialog(
            onDismissRequest = { chooseNetwork = false },
            title = { Text("Download " + model.name + "?") },
            text = { Text(verified.displaySize + " · " + verified.license +
                ". Model files are saved privately. You can pause or resume.") },
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
                    complete -> "Files saved · local inference not enabled yet"
                    verified != null -> verified.displaySize + " · " + verified.license
                    else -> "Suggested RAM: " + model.minRamGb + " GB+"
                }, style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
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
                    Button(onClick = { chooseNetwork = true }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Outlined.Download, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(if (work?.state == WorkInfo.State.FAILED) "Retry download" else "Download")
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
