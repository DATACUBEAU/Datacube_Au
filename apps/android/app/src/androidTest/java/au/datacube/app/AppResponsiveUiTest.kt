package au.datacube.app

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.ForcedSize
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalDocument
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.ui.documents.CollectionWorkspaceScreen
import au.datacube.app.ui.documents.DocumentWorkspaceScreen
import au.datacube.app.ui.documents.PracticeWorkspace
import au.datacube.app.ui.documents.DocumentsScreen
import au.datacube.app.ui.home.HomeScreen
import au.datacube.app.models.ModelBackupProgress
import au.datacube.app.ui.profile.ProfileScreen
import au.datacube.app.ui.theme.DataCubeTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class AppResponsiveUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun homeRendersOnCompactPhoneWidth() {
        composeRule.setContent {
            DeviceConfigurationOverride(DeviceConfigurationOverride.ForcedSize(DpSize(320.dp, 740.dp))) {
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
            DeviceConfigurationOverride(DeviceConfigurationOverride.ForcedSize(DpSize(320.dp, 740.dp))) {
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
            DeviceConfigurationOverride(DeviceConfigurationOverride.ForcedSize(DpSize(600.dp, 900.dp))) {
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
            DeviceConfigurationOverride(DeviceConfigurationOverride.ForcedSize(DpSize(320.dp, 740.dp))) {
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
            DeviceConfigurationOverride(DeviceConfigurationOverride.ForcedSize(DpSize(320.dp, 740.dp))) {
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
        composeRule.onNodeWithText("AU Chat").assertIsDisplayed()
        composeRule.onNodeWithText("Ask about this document").assertIsDisplayed()
    }

    @Test
    fun practiceExplainsWhenExtractedTextHasNoReadablePassages() {
        composeRule.setContent {
            DeviceConfigurationOverride(DeviceConfigurationOverride.ForcedSize(DpSize(320.dp, 740.dp))) {
                DataCubeTheme {
                    PracticeWorkspace(
                        documentName = "Short notes.pdf",
                        textPreview = "Short text",
                        previewLoading = false
                    )
                }
            }
        }
        composeRule.onNodeWithText("No readable passages found").assertIsDisplayed()
    }

    @Test
    fun documentStudyToolsAreInteractiveOnExpandedPhoneWidth() {
        composeRule.setContent {
            DeviceConfigurationOverride(DeviceConfigurationOverride.ForcedSize(DpSize(700.dp, 900.dp))) {
                DataCubeTheme {
                    DocumentWorkspaceScreen(
                        document = LocalDocument(
                            id = "interactive-document",
                            name = "Lecture_Notes.pdf",
                            extension = "pdf",
                            mimeType = "application/pdf",
                            sizeBytes = 3_400_000L,
                            privatePath = "/private/interactive-document.pdf",
                            createdAtEpochMs = 1_700_000_000_000L
                        ),
                        extractionStatus = LocalJobStatus.COMPLETED,
                        extractionProgress = 1.0,
                        extractionError = null,
                        textPreview = """
                            ----- Page 1 -----
                            Newton's Laws of Motion
                            Newton's first law describes inertia and the motion of objects.
                            Newton's second law states that net force equals mass multiplied by acceleration.
                            ----- Page 2 -----
                            Newton's third law explains equal and opposite action and reaction forces.
                            These laws describe how forces affect the movement of objects.
                        """.trimIndent(),
                        previewTruncated = false,
                        previewLoading = false,
                        previewError = null,
                        onBack = {}
                    )
                }
            }
        }

        composeRule.onNodeWithText("Smart Note").performClick()
        composeRule.onNodeWithText("Study notes").assertIsDisplayed()
        composeRule.onNodeWithText("Diagram").performClick()
        composeRule.onNodeWithText("Concept map").assertIsDisplayed()

        composeRule.onNodeWithText("Prediction").performClick()
        composeRule.onNodeWithText("Generate Study Plan").performClick()
        composeRule.onNodeWithText("Suggested revision questions").assertIsDisplayed()

        composeRule.onNodeWithText("Practice").performClick()
        composeRule.onNodeWithText("Start Practice").performClick()
        composeRule.onNodeWithText("Question 1 of 5").assertIsDisplayed()

        composeRule.onNodeWithText("Podcast").performClick()
        composeRule.onNodeWithText("Chapters").assertIsDisplayed()
        composeRule.onNodeWithText("Play summary").assertIsDisplayed()
    }
    @Test
    fun profileShowsExternalModelBackupActions() {
        composeRule.setContent {
            DataCubeTheme {
                ProfileScreen(
                    user = null,
                    onSignOut = {},
                    onBackupModels = {},
                    onRestoreModels = {},
                    modelOperationBusy = false,
                    modelBackupProgress = null,
                    installedModels = emptyList(),
                    onCancelModelOperation = {}
                )
            }
        }

        composeRule.onNodeWithText("Model backups").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Export model backup").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Restore from backup").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun profileShowsModelBackupProgressAndCancellation() {
        var cancelRequested = false
        composeRule.setContent {
            DataCubeTheme {
                ProfileScreen(
                    user = null,
                    onSignOut = {},
                    onBackupModels = {},
                    onRestoreModels = {},
                    modelOperationBusy = true,
                    modelBackupProgress = ModelBackupProgress(
                        phase = "Writing external backup",
                        currentModel = "embedding-model",
                        currentFile = "model.onnx",
                        completedBytes = 5L * 1024 * 1024,
                        totalBytes = 10L * 1024 * 1024,
                        completedFiles = 1,
                        totalFiles = 2
                    ),
                    installedModels = emptyList(),
                    onCancelModelOperation = { cancelRequested = true }
                )
            }
        }

        composeRule.onNodeWithText("Writing external backup").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Cancel operation").performScrollTo().performClick()
        assertTrue(cancelRequested)
    }

}
