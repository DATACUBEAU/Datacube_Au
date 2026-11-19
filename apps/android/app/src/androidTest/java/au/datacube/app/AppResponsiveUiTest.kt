package au.datacube.app

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.WindowSize
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalDocument
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.ui.documents.CollectionWorkspaceScreen
import au.datacube.app.ui.documents.DocumentWorkspaceScreen
import au.datacube.app.ui.documents.DocumentsScreen
import au.datacube.app.ui.home.HomeScreen
import au.datacube.app.ui.theme.DataCubeTheme
import org.junit.Rule
import org.junit.Test

class AppResponsiveUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun homeRendersOnCompactPhoneWidth() {
        composeRule.setContent {
            DeviceConfigurationOverride(DeviceConfigurationOverride.WindowSize(DpSize(320.dp, 740.dp))) {
                DataCubeTheme {
                    HomeScreen(
                        modifier = Modifier.fillMaxSize(),
                        user = null,
                        recentDocuments = emptyList(),
                        onImportDocument = {},
                        onNavigateToDocuments = {},
                        onNavigateToStudy = {},
                        onNavigateToChat = {},
                        onOpenDocument = {},
                        onNavigateSettings = {}
                    )
                }
            }
        }
        composeRule.onNodeWithText("DataCube AU").assertIsDisplayed()
        composeRule.onNodeWithText("Active Documents").assertIsDisplayed()
        composeRule.onNodeWithText("No documents yet").assertIsDisplayed()
    }

    @Test
    fun documentsRendersOnCompactPhoneWidth() {
        composeRule.setContent {
            DeviceConfigurationOverride(DeviceConfigurationOverride.WindowSize(DpSize(320.dp, 740.dp))) {
                DataCubeTheme {
                    DocumentsScreen(
                        modifier = Modifier.fillMaxSize(),
                        documents = emptyList(),
                        collections = emptyList(),
                        onImport = {},
                        onNavigateHome = {},
                        onNavigateSettings = {},
                        onCreateCollection = { _, done -> done(Result.success("collection-test")) },
                        onOpenCollection = {},
                        onDeleteCollection = {},
                        onOpenDocument = {},
                        onDelete = {}
                    )
                }
            }
        }
        composeRule.onNodeWithText("Documents").assertIsDisplayed()
        composeRule.onNodeWithText("Collections").assertIsDisplayed()
        composeRule.onNodeWithText("Recent Documents").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun documentsRendersOnExpandedWidth() {
        composeRule.setContent {
            DeviceConfigurationOverride(DeviceConfigurationOverride.WindowSize(DpSize(600.dp, 900.dp))) {
                DataCubeTheme {
                    DocumentsScreen(
                        modifier = Modifier.fillMaxSize(),
                        documents = emptyList(),
                        collections = emptyList(),
                        onImport = {},
                        onNavigateHome = {},
                        onNavigateSettings = {},
                        onCreateCollection = { _, done -> done(Result.success("collection-test")) },
                        onOpenCollection = {},
                        onDeleteCollection = {},
                        onOpenDocument = {},
                        onDelete = {}
                    )
                }
            }
        }
        composeRule.onNodeWithText("Documents").assertIsDisplayed()
        composeRule.onNodeWithText("Collections").assertIsDisplayed()
        composeRule.onNodeWithText("Recent Documents").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun collectionWorkspaceShowsEmptyStateOnCompactWidth() {
        composeRule.setContent {
            DeviceConfigurationOverride(DeviceConfigurationOverride.WindowSize(DpSize(320.dp, 740.dp))) {
                DataCubeTheme {
                    CollectionWorkspaceScreen(
                        name = "Biology Notes",
                        documents = emptyList(),
                        onBack = {},
                        onAddDocuments = {},
                        onRemoveDocument = {},
                        onOpenDocument = {}
                    )
                }
            }
        }
        composeRule.onNodeWithText("Biology Notes").assertIsDisplayed()
        composeRule.onNodeWithText("Collection workspace").assertIsDisplayed()
        composeRule.onNodeWithText("This collection is empty").assertIsDisplayed()
    }

    @Test
    fun documentWorkspaceShowsLocalPreviewOnCompactPhoneWidth() {
        composeRule.setContent {
            DeviceConfigurationOverride(DeviceConfigurationOverride.WindowSize(DpSize(320.dp, 740.dp))) {
                DataCubeTheme {
                    DocumentWorkspaceScreen(
                        document = LocalDocument(
                            id = "test-document",
                            name = "Study notes.pdf",
                            extension = "pdf",
                            mimeType = "application/pdf",
                            sizeBytes = 24_576L,
                            privatePath = "/private/test-document.pdf",
                            createdAtEpochMs = 1_700_000_000_000L
                        ),
                        extractionStatus = LocalJobStatus.COMPLETED,
                        extractionProgress = 1.0,
                        extractionError = null,
                        textPreview = "LOCAL PREVIEW CONTENT FOR RESPONSIVE UI TEST",
                        previewTruncated = false,
                        previewLoading = false,
                        previewError = null,
                        onBack = {}
                    )
                }
            }
        }
        composeRule.onNodeWithText("Study notes.pdf").assertIsDisplayed()
        composeRule.onNodeWithText("Overview").assertIsDisplayed()
        composeRule.onNodeWithText("Extracted text").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("LOCAL PREVIEW CONTENT FOR RESPONSIVE UI TEST").performScrollTo().assertIsDisplayed()
    }
}
