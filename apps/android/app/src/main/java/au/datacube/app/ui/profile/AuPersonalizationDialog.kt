package au.datacube.app.ui.profile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import au.datacube.app.data.rag.AuPersonalizationStore
import au.datacube.app.ui.common.DataCubeDialog

@Composable
fun AuPersonalizationDialog(accountId: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val store = remember(accountId, context) { AuPersonalizationStore(context, accountId) }
    var saved by remember(store) { mutableStateOf(store.read()) }
    var enabled by remember(store) { mutableStateOf(saved.enabled) }
    var name by remember(store) { mutableStateOf(saved.name) }
    var style by remember(store) { mutableStateOf(saved.style) }
    var error by remember { mutableStateOf("") }
    var confirmClear by remember { mutableStateOf(false) }
    DataCubeDialog(onDismissRequest = onDismiss, title = { Text("AU personalization") },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Use saved preferences")
                        Text("Optional, stored on this device for your account.", style = MaterialTheme.typography.bodySmall)
                    }
                    Switch(checked = enabled, onCheckedChange = { enabled = it })
                }
                OutlinedTextField(name, { name = it.take(60) }, label = { Text("Preferred name (optional)") },
                    singleLine = true, enabled = enabled, modifier = Modifier.fillMaxWidth())
                Text("Response style", style = MaterialTheme.typography.titleSmall)
                AuPersonalizationStore.STYLES.forEach { option ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = style == option, onClick = { style = option }, enabled = enabled)
                        Text(option)
                    }
                }
                HorizontalDivider()
                Text("Saved memories", style = MaterialTheme.typography.titleMedium)
                Text("Say “Remember that…” in AU Chat to save a short note. Avoid passwords and sensitive information. Turning personalization off stops use of these notes; it does not delete them.", style = MaterialTheme.typography.bodySmall)
                if (saved.notes.isEmpty()) Text("No saved memories.", style = MaterialTheme.typography.bodySmall)
                saved.notes.forEachIndexed { index, note ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(note, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        TextButton(onClick = {
                            runCatching { store.removeNote(index); saved = store.read() }
                                .onFailure { error = "Could not remove the note." }
                        }) { Text("Remove") }
                    }
                }
                if (saved.notes.isNotEmpty()) {
                    TextButton(onClick = { confirmClear = true }) { Text("Clear all memories") }
                }
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = { TextButton(onClick = {
            runCatching { store.savePreferences(enabled, name, style) }
                .onSuccess { onDismiss() }.onFailure { error = "Could not save preferences." }
        }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close") } })
    if (confirmClear) AlertDialog(onDismissRequest = { confirmClear = false },
        title = { Text("Clear saved memories?") },
        text = { Text("This removes saved notes from AU personalization. It does not delete chat histories.") },
        confirmButton = { TextButton(onClick = {
            runCatching { store.clearNotes(); saved = store.read() }
                .onFailure { error = "Could not clear memories." }
            confirmClear = false
        }) { Text("Clear") } },
        dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("Cancel") } })
}
