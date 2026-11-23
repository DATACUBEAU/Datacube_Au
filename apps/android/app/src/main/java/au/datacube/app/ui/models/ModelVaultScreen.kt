package au.datacube.app.ui.models

import android.net.Uri
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

/** User-owned portable archives, readable again after the user selects the folder. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelVaultScreen(
    folderRevision: Int,
    installedRevision: Int,
    installed: (String) -> Boolean,
    onChooseFolder: () -> Unit,
    onRestoreArchive: (Uri) -> Unit,
    onOpenArchive: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val vault = remember(context) { ModelVaultStore(context) }
    val jobs = remember(context) { ModelVaultBackupJobs(context) }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var refresh by remember { mutableIntStateOf(0) }
    var archives by remember { mutableStateOf<List<ModelVaultStore.Archive>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    val folder = remember(folderRevision) { vault.folder() }
    LaunchedEffect(folderRevision, refresh, installedRevision) {
        loading = folder != null
        archives = if (folder == null) emptyList() else {
            runCatching { vault.archives() }.onFailure {
                snackbar.showSnackbar(it.message ?: "Could not read this model folder.")
            }.getOrDefault(emptyList())
        }
        loading = false
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Model Vault", fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Outlined.ArrowBack, "Back") } }
            )
        },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { insets ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(insets),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    shape = RoundedCornerShape(18.dp)
                ) {
                    Column(Modifier.fillMaxWidth().padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("My model folder", fontWeight = FontWeight.SemiBold)
                        Text(
                            if (folder == null) "Choose Documents, an SD card or a supported cloud folder."
                            else "Folder connected. Archives here can survive uninstall.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall
                        )
                        Button(onClick = onChooseFolder, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Outlined.FolderOpen, null)
                            Spacer(Modifier.width(8.dp))
                            Text(if (folder == null) "Choose folder" else "Change folder")
                        }
                    }
                }
            }
            item {
                Text("Back up installed models", style = MaterialTheme.typography.titleMedium)
                Text("Each archive includes its model ID and integrity checks.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
            val installedModels = ModelCatalog.models.filter { installed(it.id) }
            if (installedModels.isEmpty()) {
                item { Text("No model files installed yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                installedModels.forEach { spec ->
                    item(key = spec.id) {
                        VaultModelRow(
                            spec = spec,
                            canBackup = folder != null,
                            jobs = jobs,
                            onFinished = { refresh += 1 },
                            onError = { message -> scope.launch { snackbar.showSnackbar(message) } }
                        )
                    }
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Saved archives", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    TextButton(onClick = { refresh += 1 }, enabled = folder != null) { Text("Refresh") }
                }
                if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            }
            if (archives.isEmpty() && !loading) {
                item {
                    Text(if (folder == null) "Choose a folder to see saved models."
                        else "No DataCube AU model archives in this folder.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            archives.forEach { archive ->
                item(key = archive.uri.toString()) {
                    Surface(
                        shape = RoundedCornerShape(18.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        color = MaterialTheme.colorScheme.surface
                    ) {
                        Column(Modifier.fillMaxWidth().padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(7.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.Inventory2, null, tint = MaterialTheme.colorScheme.primary)
                                Spacer(Modifier.width(8.dp))
                                Text(archive.preview.labels.joinToString(", "), fontWeight = FontWeight.Medium,
                                    modifier = Modifier.weight(1f))
                            }
                            Text(archive.filename, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Integrity is checked during restore.",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            OutlinedButton(onClick = { onRestoreArchive(archive.uri) },
                                modifier = Modifier.fillMaxWidth()) {
                                Text("Restore model")
                            }
                        }
                    }
                }
            }
            item {
                OutlinedButton(onClick = onOpenArchive, modifier = Modifier.fillMaxWidth()) {
                    Text("Select another model archive")
                }
                Text("After reinstalling, choose your folder again. Models are restored into private storage before inference.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun VaultModelRow(
    spec: ModelSpec,
    canBackup: Boolean,
    jobs: ModelVaultBackupJobs,
    onFinished: () -> Unit,
    onError: (String) -> Unit
) {
    val flow = remember(spec.id) { jobs.observe(spec.id) }
    val infos by flow.collectAsState(initial = emptyList())
    val work = infos.firstOrNull { it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED }
        ?: infos.lastOrNull()
    val active = work?.state == WorkInfo.State.RUNNING || work?.state == WorkInfo.State.ENQUEUED
    LaunchedEffect(work?.id, work?.state) {
        if (work?.state == WorkInfo.State.SUCCEEDED) onFinished()
    }
    Surface(
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        color = MaterialTheme.colorScheme.surface
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(spec.name, fontWeight = FontWeight.SemiBold)
            Text("${spec.id} · ${spec.role.name.lowercase()}",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (active) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
                Text("Saving to your folder…", style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = { jobs.cancel(spec.id) }) { Text("Cancel") }
            } else {
                if (work?.state == WorkInfo.State.FAILED) {
                    Text(work.outputData.getString(ModelVaultBackupWorker.KEY_ERROR) ?: "Backup failed",
                        color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                Button(
                    onClick = { runCatching { jobs.start(spec.id) }.onFailure {
                        onError(it.message ?: "Could not back up this model.")
                    } },
                    enabled = canBackup,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Outlined.SaveAlt, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(if (work?.state == WorkInfo.State.SUCCEEDED) "Back up again" else "Back up")
                }
            }
        }
    }
}
