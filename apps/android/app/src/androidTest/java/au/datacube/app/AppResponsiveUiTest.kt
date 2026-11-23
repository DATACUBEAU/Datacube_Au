package au.datacube.app

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.InsetDrawable
import android.os.Build
import android.util.TypedValue
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.ForcedSize
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import au.datacube.app.data.LocalDocument
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.ui.auth.AuthBackdrop
import au.datacube.app.ui.auth.AuthLogo
import au.datacube.app.ui.documents.CollectionWorkspaceScreen
import au.datacube.app.ui.documents.DocumentWorkspaceScreen
import au.datacube.app.ui.documents.PracticeWorkspace
import au.datacube.app.ui.documents.DocumentsScreen
import au.datacube.app.ui.home.HomeScreen
import au.datacube.app.ui.profile.ProfileScreen
import au.datacube.app.ui.theme.DataCubeTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.math.PI

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
        composeRule.onNodeWithText("Upload a document to start asking…").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Upload documents").assertIsDisplayed()
    }

    @Test
    fun splashThemeUsesOriginalArtwork() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val resources = context.resources
        val theme = resources.newTheme().apply { applyStyle(R.style.Theme_DataCubeAU, true) }
        val splashIcon = TypedValue()
        val iconAttribute = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            android.R.attr.windowSplashScreenAnimatedIcon
        } else {
            androidx.core.splashscreen.R.attr.windowSplashScreenAnimatedIcon
        }
        assertTrue(theme.resolveAttribute(iconAttribute, splashIcon, true))
        assertEquals(R.drawable.ic_splash_logo, splashIcon.resourceId)

        val inset = resources.getDrawable(splashIcon.resourceId, theme) as InsetDrawable
        val displayedArtwork = (inset.drawable as BitmapDrawable).bitmap
        val originalArtwork = BitmapFactory.decodeResource(resources, R.drawable.datacube_logo)
        assertTrue(displayedArtwork.sameAs(originalArtwork))
    }

    @Test
    fun profileDisplaysDataCubeArtwork() {
        composeRule.setContent {
            DataCubeTheme {
                ProfileScreen(
                    user = null,
                    onSignOut = {},
                    onBackupModels = {},
                    onRestoreModels = {}
                )
            }
        }
        composeRule.onNodeWithContentDescription("DataCube AU").assertIsDisplayed()
    }

    @Test
    fun loginBackdropAndLogoRenderDifferentAnimationFrames() {
        val phase = mutableFloatStateOf(0f)
        composeRule.setContent {
            Column(Modifier.background(Color(0xFF06101F))) {
                Box(Modifier.size(180.dp).testTag("backdrop")) { AuthBackdrop(phase) }
                Box(Modifier.testTag("logo")) { AuthLogo(phase) }
            }
        }
        val backdrop = composeRule.onNodeWithTag("backdrop")
        val logo = composeRule.onNodeWithTag("logo")
        val backdropBefore = backdrop.captureToImage().asAndroidBitmap()
        val logoBefore = logo.captureToImage().asAndroidBitmap()

        composeRule.runOnIdle { phase.floatValue = (PI / 2).toFloat() }

        assertFalse(backdropBefore.sameAs(backdrop.captureToImage().asAndroidBitmap()))
        assertFalse(logoBefore.sameAs(logo.captureToImage().asAndroidBitmap()))
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
        // The workspace header precedes the second copy inside the chat panel.
        composeRule.onAllNodesWithText("Study notes.pdf").onFirst().assertIsDisplayed()
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
}
