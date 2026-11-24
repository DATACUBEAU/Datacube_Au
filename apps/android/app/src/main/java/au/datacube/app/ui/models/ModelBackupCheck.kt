package au.datacube.app.ui.models

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import au.datacube.app.models.ModelVaultStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** A header scan reports presence, while an explicit check reads every saved byte. */
@Composable
internal fun ModelBackupCheck(
    modelId: String,
    archive: ModelVaultStore.Archive? = null,
    refreshKey: Any? = null
) {
    val context = LocalContext.current
    val vault = remember(context) { ModelVaultStore(context) }
    val folder = vault.folder()
    val scope = rememberCoroutineScope()
    var found by remember(modelId, archive, folder, refreshKey) { mutableStateOf(archive) }
    var checked by remember(modelId, archive, folder, refreshKey) { mutableStateOf(false) }
    var busy by remember(modelId, archive, folder, refreshKey) { mutableStateOf(false) }
    var percent by remember(modelId, archive, folder, refreshKey) { mutableIntStateOf(0) }
    var status by remember(modelId, archive, folder, refreshKey) { mutableStateOf<String?>(null) }
    LaunchedEffect(modelId, archive, folder, refreshKey) {
        if (archive != null) return@LaunchedEffect
        if (folder == null) {
            status = "Choose your backup folder."
            return@LaunchedEffect
        }
        try {
            found = vault.latestArchive(modelId)
            status = if (found == null) "No backup ZIP found. Back up again." else null
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            status = "Cannot read the backup folder."
        }
    }
    Text(
        when {
            busy -> "Checking saved ZIP · $percent%"
            checked -> "Backup verified"
            status != null -> status.orEmpty()
            found != null -> "Backup ZIP found · check to verify"
            else -> "Looking for backup ZIP…"
        },
        style = MaterialTheme.typography.bodySmall,
        color = when {
            checked -> MaterialTheme.colorScheme.primary
            status != null && !busy -> MaterialTheme.colorScheme.error
            else -> MaterialTheme.colorScheme.onSurfaceVariant
        }
    )
    if (busy) LinearProgressIndicator(progress = { percent / 100f }, modifier = Modifier.fillMaxWidth())
    if (!busy && found != null && archive == null) {
        Text(found!!.filename, style = MaterialTheme.typography.labelSmall)
    }
    OutlinedButton(
        enabled = folder != null && !busy,
        onClick = {
            busy = true
            checked = false
            status = null
            percent = 0
            scope.launch {
                try {
                    val saved = archive ?: vault.latestArchive(modelId)
                    found = saved
                    if (saved == null) {
                        status = "No backup ZIP found. Back up again."
                    } else {
                        vault.verifyArchive(saved) { done, total ->
                            percent = if (total > 0) (done * 100 / total).toInt().coerceIn(0, 99) else 0
                        }
                        checked = true
                        percent = 100
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    status = failure.message ?: "Backup check failed. Back up again."
                } finally {
                    busy = false
                }
            }
        }, modifier = Modifier.fillMaxWidth()
    ) { Text(if (checked) "Check again" else "Confirm backup") }
}
