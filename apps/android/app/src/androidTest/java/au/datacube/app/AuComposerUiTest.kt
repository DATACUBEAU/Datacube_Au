package au.datacube.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performClick
import au.datacube.app.ui.common.AuComposer
import au.datacube.app.ui.theme.DataCubeTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class AuComposerUiTest {
    @get:Rule val rule = createComposeRule()

    @Test fun nativeComposerSendsTextOnlyAfterExplicitTap() {
        var sent = ""
        rule.setContent {
            var input by remember { mutableStateOf("") }
            DataCubeTheme {
                AuComposer(
                    value = input,
                    onValueChange = { input = it },
                    onSend = { sent = input },
                    placeholder = "Ask AU",
                    enabled = true,
                    sendEnabled = input.isNotBlank()
                )
            }
        }
        rule.onNodeWithTag("au-composer-input").performTextInput("Explain this document")
        rule.runOnIdle { assertEquals("", sent) }
        rule.onNodeWithContentDescription("Send to AU").performClick()
        rule.runOnIdle { assertEquals("Explain this document", sent) }
    }
    @Test fun stopReplacesSendDuringGenerationEvenWhenInputDisabled() {
        var stops = 0
        var sends = 0
        rule.setContent {
            DataCubeTheme {
                AuComposer(
                    value = "",
                    onValueChange = {},
                    onSend = { sends++ },
                    placeholder = "Ask AU",
                    enabled = false,
                    sendEnabled = false,
                    onStop = { stops++ }
                )
            }
        }
        rule.onNodeWithContentDescription("Stop generating").performClick()
        rule.runOnIdle {
            assertEquals(1, stops)
            assertEquals(0, sends)
        }
    }
}
