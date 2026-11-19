package au.datacube.app.ui.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.datacube.app.ui.theme.DataCubeColors

@Composable
fun ChatScreen(modifier: Modifier = Modifier) {
    var text by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf("All documents") }
    var documentMenuExpanded by remember { mutableStateOf(false) }
    var modelMenuExpanded by remember { mutableStateOf(false) }

    Column(modifier.fillMaxSize().background(DataCubeColors.BluePale)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    "AU Chat",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = DataCubeColors.Navy,
                )
                Text(
                    "Ask questions and explore your documents",
                    color = DataCubeColors.TextSecondary,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            IconButton(onClick = {}) {
                Icon(Icons.Outlined.Settings, contentDescription = "Chat settings", tint = DataCubeColors.Navy)
            }
        }

        Row(
            Modifier.fillMaxWidth().padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Searching in", color = DataCubeColors.TextSecondary)
            Spacer(Modifier.width(8.dp))
            Box {
                OutlinedButton(
                    onClick = { documentMenuExpanded = true },
                    shape = RoundedCornerShape(22.dp),
                ) {
                    Icon(Icons.Outlined.Description, contentDescription = null, tint = DataCubeColors.Blue)
                    Spacer(Modifier.width(6.dp))
                    Text(selected, color = DataCubeColors.Navy)
                    Icon(Icons.Outlined.ArrowDropDown, contentDescription = null)
                }
                DropdownMenu(
                    expanded = documentMenuExpanded,
                    onDismissRequest = { documentMenuExpanded = false },
                ) {
                    DropdownMenuItem(
                        text = { Text("All documents") },
                        onClick = {
                            selected = "All documents"
                            documentMenuExpanded = false
                        },
                    )
                }
            }
        }

        Box(
            Modifier.weight(1f).fillMaxWidth(),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(28.dp),
            ) {
                Icon(
                    Icons.Outlined.ChatBubbleOutline,
                    contentDescription = null,
                    tint = DataCubeColors.Blue,
                    modifier = Modifier.size(48.dp),
                )
                Spacer(Modifier.height(14.dp))
                Text(
                    "Ask anything about your document",
                    fontWeight = FontWeight.SemiBold,
                    color = DataCubeColors.Navy,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "Choose a document and ask AU to explain, summarize or find information.",
                    color = DataCubeColors.TextSecondary,
                )
            }
        }

        Surface(
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
            border = BorderStroke(1.dp, DataCubeColors.Divider),
            tonalElevation = 2.dp,
        ) {
            Column(
                Modifier.fillMaxWidth().navigationBarsPadding().padding(12.dp),
            ) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    placeholder = { Text("Ask AU about this document") },
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 4,
                    shape = RoundedCornerShape(18.dp),
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = {}) {
                        Icon(Icons.Outlined.Add, contentDescription = "Attach document")
                    }
                    Box {
                        OutlinedButton(
                            onClick = { modelMenuExpanded = true },
                            shape = RoundedCornerShape(22.dp),
                        ) {
                            Text("Gemma (local)", color = DataCubeColors.Navy)
                            Icon(Icons.Outlined.ArrowDropDown, contentDescription = null)
                        }
                        DropdownMenu(
                            expanded = modelMenuExpanded,
                            onDismissRequest = { modelMenuExpanded = false },
                        ) {
                            DropdownMenuItem(
                                text = { Text("Gemma (local)") },
                                onClick = { modelMenuExpanded = false },
                            )
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = {}) {
                        Icon(Icons.Outlined.Mic, contentDescription = "Voice input")
                    }
                    FilledIconButton(onClick = {}, enabled = text.isNotBlank()) {
                        Icon(Icons.Outlined.Send, contentDescription = "Send")
                    }
                }
            }
        }
    }
}
