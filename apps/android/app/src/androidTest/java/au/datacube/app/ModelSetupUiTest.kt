package au.datacube.app

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import au.datacube.app.models.ModelSpec
import au.datacube.app.ui.models.ModelsScreen
import au.datacube.app.ui.profile.ProfileScreen
import au.datacube.app.ui.theme.DataCubeTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test

class ModelSetupUiTest {
    @get:Rule val composeRule = createComposeRule()

    @Test
    fun settingsUsesShortAULabelsAndModelEntry() {
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
        composeRule.onNodeWithText("Cloud AU usage").assertExists()
        composeRule.onNodeWithText("Check your cloud AU usage").assertExists()
        composeRule.onNodeWithText("Models").assertExists()
        composeRule.onNodeWithText("Display mode").assertIsDisplayed()
    }

    @Test
    fun modelPickerStartsImportForEmbeddingModel() {
        var selected: ModelSpec? = null
        composeRule.setContent {
            DataCubeTheme {
                ModelsScreen(
                    installed = { false },
                    onGet = {},
                    onImport = { selected = it },
                    onBack = {}
                )
            }
        }
        composeRule.onNodeWithText("EmbeddingGemma 300M").assertIsDisplayed()
        composeRule.onAllNodesWithText("Import files").onFirst().performClick()
        assertNotNull(selected)
        assertEquals("embeddinggemma-300m", selected?.id)
    }
}
