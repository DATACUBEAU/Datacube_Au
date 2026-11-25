package au.datacube.app.ui.common

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import au.datacube.app.ui.theme.DataCubeTheme
import org.junit.Rule
import org.junit.Test

class AuStepDeckUiTest {
    @get:Rule val composeRule=createComposeRule()
    @Test fun navigationAndFullLessonAreAccessible() {
        composeRule.setContent {
            DataCubeTheme {
                AuStepDeck(AuResponseBlock.Steps("Learn motion",listOf(
                    AuResponseBlock.StepCard("Forward","Motion carries the ball forward."),
                    AuResponseBlock.StepCard("Gravity","Gravity acts downward.")
                )))
            }
        }
        composeRule.onNodeWithText("Step 1 of 2").assertIsDisplayed()
        composeRule.onNodeWithText("Next").performClick()
        composeRule.onNodeWithText("Step 2 of 2").assertIsDisplayed()
        composeRule.onNodeWithText("Gravity acts downward.").assertIsDisplayed()
        composeRule.onNodeWithText("Previous").performClick()
        composeRule.onNodeWithText("Step 1 of 2").assertIsDisplayed()
        composeRule.onNodeWithText("Show all steps").performClick()
        composeRule.onNodeWithText("Motion carries the ball forward.").assertIsDisplayed()
        composeRule.onNodeWithText("Gravity acts downward.").assertIsDisplayed()
    }
}
