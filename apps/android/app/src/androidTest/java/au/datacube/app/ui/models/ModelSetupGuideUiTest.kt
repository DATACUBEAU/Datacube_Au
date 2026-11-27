package au.datacube.app.ui.models

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import au.datacube.app.ui.theme.DataCubeTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ModelSetupGuideUiTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun tourCanBeSkippedAfterNavigatingPages() {
        val showing = mutableStateOf(true)
        var skipped = 0
        composeRule.setContent {
            DataCubeTheme {
                if(showing.value) ModelSetupTour(onDismiss={skipped++;showing.value=false},onOpenModels={})
            }
        }
        composeRule.onNodeWithText("Welcome to AU").assertIsDisplayed()
        composeRule.onNodeWithText("Next").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Set up AU").assertIsDisplayed()
        composeRule.onNodeWithText("Skip").performClick()
        composeRule.runOnIdle { assertEquals(1,skipped) }
    }

    @Test fun missingModelsDialogOffersDirectSetupAndPreservesImportChoice() {
        var opened = 0
        var imported = 0
        composeRule.setContent {
            DataCubeTheme {
                MissingModelPrompt(ModelSetupGuide.Readiness(false,false,true),
                    onDismiss={},onOpenModels={opened++},onImportAnyway={imported++})
            }
        }
        composeRule.onNodeWithText("Open Models").assertIsDisplayed().performClick()
        composeRule.onNodeWithText("Import anyway").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(1,opened);assertEquals(1,imported) }
    }

    @Test fun communityInvitationRequiresExplicitChoice() {
        var joined=0
        var dismissed=0
        composeRule.setContent {
            DataCubeTheme { CommunityInviteDialog(onDismiss={dismissed++},onJoin={joined++}) }
        }
        composeRule.onNodeWithText("Join the AU community").assertIsDisplayed()
        composeRule.onNodeWithText("Not now").performClick()
        composeRule.runOnIdle { assertEquals(1,dismissed); assertEquals(0,joined) }
        composeRule.onNodeWithText("Open WhatsApp").performClick()
        composeRule.runOnIdle { assertEquals(1,joined) }
    }
}
