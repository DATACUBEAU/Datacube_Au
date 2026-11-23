package au.datacube.app

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.ui.documents.DocumentPreparationScreen
import au.datacube.app.ui.theme.DataCubeTheme
import org.junit.Rule
import org.junit.Test

class DocumentPreparationUiTest {
    @get:Rule val rule = createComposeRule()

    @Test fun extractionProgressIsVisibleAndHasBackNavigation() {
        rule.setContent {
            DataCubeTheme {
                DocumentPreparationScreen(
                    documentName = "Class lecture.pdf",
                    extractionStatus = LocalJobStatus.RUNNING,
                    extractionProgress = 0.47,
                    onBack = {}
                )
            }
        }
        rule.onNodeWithText("Preparing document").assertIsDisplayed()
        rule.onNodeWithText("47% extracted").assertIsDisplayed()
        rule.onNodeWithText("Return to documents").assertIsDisplayed()
    }
}
