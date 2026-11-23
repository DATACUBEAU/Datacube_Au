package au.datacube.app.ui.models

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.datacube.app.models.ModelCatalog
import au.datacube.app.models.ModelRole
import au.datacube.app.models.ModelSpec

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelsScreen(
    installed: (String) -> Boolean,
    onGet: (ModelSpec) -> Unit,
    onImport: (ModelSpec) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("On-device models", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Outlined.ArrowBack, "Back") }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item {
                Text("Search model", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("Needed for local semantic search.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            item {
                ModelCard(ModelCatalog.models[0], installed(ModelCatalog.models[0].id), onGet, onImport)
            }
            item {
                Spacer(Modifier.height(4.dp))
                Text("Chat models", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("Optional. Pick one that fits your device.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            ModelCatalog.models.filter { it.role == ModelRole.GENERATION }.forEach { spec ->
                item(key = spec.id) { ModelCard(spec, installed(spec.id), onGet, onImport) }
            }
            item {
                Text(
                    "Get files from the model publisher, accept its license, then import them here. Imported files are not activated until the local runtime is connected.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(4.dp)
                )
            }
        }
    }
}

@Composable
private fun ModelCard(
    model: ModelSpec,
    installed: Boolean,
    onGet: (ModelSpec) -> Unit,
    onImport: (ModelSpec) -> Unit
) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        tonalElevation = 1.dp
    ) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(model.name, fontWeight = FontWeight.SemiBold)
                    Text(model.description, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
                if (installed) {
                    Icon(Icons.Outlined.CheckCircle, "Imported", tint = MaterialTheme.colorScheme.primary)
                }
            }
            Text(
                if (installed) "Files imported" else "Recommended memory: ${model.minRamGb} GB+",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = { onGet(model) },
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = 8.dp)
                ) {
                    Icon(Icons.Outlined.OpenInNew, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Get files")
                }
                Button(
                    onClick = { onImport(model) },
                    enabled = !installed,
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = 8.dp)
                ) {
                    Icon(Icons.Outlined.FileUpload, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(if (installed) "Imported" else "Import")
                }
            }
        }
    }
}
