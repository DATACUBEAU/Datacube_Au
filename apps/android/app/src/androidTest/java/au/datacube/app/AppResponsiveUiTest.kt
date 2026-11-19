package au.datacube.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import au.datacube.app.ui.documents.DocumentsScreen
import au.datacube.app.ui.documents.DocumentWorkspaceScreen
import au.datacube.app.data.LocalDocument
import au.datacube.app.data.LocalJobStatus
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
            DataCubeTheme {
                Box(Modifier.width(320.dp).fillMaxHeight()) {
                    HomeScreen(
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
            DataCubeTheme {
                Box(Modifier.width(320.dp).fillMaxHeight()) {
                    DocumentsScreen(
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
            DataCubeTheme {
                Box(Modifier.width(600.dp).fillMaxHeight()) {
                    DocumentsScreen(
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
    fun documentWorkspaceShowsLocalPreviewOnCompactPhoneWidth() {
        composeRule.setContent {
            DataCubeTheme {
                Box(Modifier.width(320.dp).fillMaxHeight()) {
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
