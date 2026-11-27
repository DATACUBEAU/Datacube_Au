package au.datacube.app.ui.common

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import au.datacube.app.ui.theme.DataCubeTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class AuSpotlightUiTest {
    @get:Rule val rule=createComposeRule()

    @Test fun offerIsOptionalAndCanStart() {
        var starts=0
        var declines=0
        rule.setContent {
            DataCubeTheme { AuTutorialOffer(onStart={starts++},onDecline={declines++}) }
        }
        rule.onNodeWithText("Not now").performClick()
        rule.runOnIdle { assertEquals(1,declines);assertEquals(0,starts) }
        rule.onNodeWithText("Start tutorial").performClick()
        rule.runOnIdle { assertEquals(1,starts) }
    }

    @Test fun highlightNeverActivatesUnderlyingUploadAndSkipWorks() {
        var uploads=0
        var advances=0
        var skips=0
        rule.setContent {
            DataCubeTheme {
                val state=remember { AuSpotlightState() }
                CompositionLocalProvider(LocalAuSpotlight provides state) {
                    Box(Modifier.fillMaxSize()) {
                        Button(onClick={uploads++},modifier=Modifier.padding(20.dp).auTourTarget(TourTarget.UPLOAD)) {
                            Text("Upload Documents")
                        }
                        AuSpotlightOverlay(state,AuTourStep.UPLOAD,1,{advances++},{skips++})
                    }
                }
            }
        }
        rule.onNodeWithText("Add a document").assertIsDisplayed()
        rule.onNodeWithText("Upload Documents").performTouchInput { click() }
        rule.runOnIdle { assertEquals(0,uploads);assertEquals(1,advances) }
        rule.onNodeWithText("Skip").performClick()
        rule.runOnIdle { assertEquals(1,skips) }
    }

    @Test fun missingTargetDoesNotTrapUser() {
        var advances=0
        rule.setContent {
            DataCubeTheme {
                AuSpotlightOverlay(remember { AuSpotlightState() },AuTourStep.RECOMMEND,6,{advances++},{})
            }
        }
        rule.onNodeWithText("Find the right models").assertIsDisplayed()
        rule.onNodeWithText("Continue").performClick()
        rule.runOnIdle { assertEquals(1,advances) }
    }
}
