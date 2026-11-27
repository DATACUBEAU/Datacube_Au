package au.datacube.app

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollToKey
import androidx.compose.ui.test.performScrollTo
import au.datacube.app.models.DeviceCapability
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
        composeRule.onNodeWithText("Manage subscription").assertExists()
        composeRule.onNodeWithText("Cloud AU usage").assertDoesNotExist()
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
                    onBack = {},
                    scanDevice = { DeviceCapability(8,12,"arm64-v8a","Gemma") },
                    runtimeSdk = 35
                )
            }
        }
        composeRule.onNodeWithTag("model-list").performScrollToKey("recommended-search")
        composeRule.onNodeWithText("EmbeddingGemma 2 · 270M").assertIsDisplayed()
        composeRule.onNodeWithTag("import-embeddinggemma-2-270m").performScrollTo().assertIsDisplayed().performClick()
        composeRule.runOnIdle {
            assertNotNull(selected)
            assertEquals("embeddinggemma-2-270m", selected?.id)
        }
    }
}
