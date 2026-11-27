package au.datacube.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import au.datacube.app.data.rag.AuEffort
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.semantics.SemanticsActions
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
    @Test fun expansionAndResponseEffortAreInteractive() {
        var selected = AuEffort.BALANCED
        rule.setContent {
            var effort by remember { mutableStateOf(AuEffort.BALANCED) }
            var text by remember { mutableStateOf("") }
            DataCubeTheme {
                AuComposer(value = text, onValueChange = { text = it }, onSend = {},
                    placeholder = "Ask AU", enabled = true, sendEnabled = false,
                    effort = effort, onEffortChange = { effort = it; selected = it })
            }
        }
        rule.onNodeWithContentDescription("Expand composer").assertDoesNotExist()
        rule.onNodeWithTag("au-composer-input").performTextInput((1..10).joinToString("\n") { "Line $it" })
        rule.onNodeWithContentDescription("Expand composer").performClick()
        rule.onNodeWithContentDescription("Collapse composer").performClick()
        rule.onNodeWithContentDescription("Response effort: Balanced").performClick()
        rule.onNodeWithTag("au-effort-slider").performSemanticsAction(SemanticsActions.SetProgress) { it(2f) }
        rule.onNodeWithText("Done").performClick()
        rule.runOnIdle { assertEquals(AuEffort.DEEP, selected) }
        rule.onNodeWithContentDescription("Response effort: Deep").assertExists()
    }

    @Test fun actionRowDoesNotShrinkUnderLongDraft() {
        rule.setContent {
            var input by remember { mutableStateOf("") }
            DataCubeTheme {
                Box(Modifier.fillMaxWidth().height(190.dp)) {
                    AuComposer(input, { input = it }, {}, "Ask AU", true, true, onEffortChange = {})
                }
            }
        }
        val row = rule.onNodeWithTag("au-composer-actions", useUnmergedTree = true)
        val initial = row.getBoundsInRoot().let { it.bottom - it.top }
        org.junit.Assert.assertTrue(kotlin.math.abs(initial.value - 48f) <= 1f)
        rule.onNodeWithTag("au-composer-input").performTextInput((1..15).joinToString("\n") { "A long draft line $it" })
        assertEquals(initial, row.getBoundsInRoot().let { it.bottom - it.top })
        rule.onNodeWithContentDescription("Expand composer").performClick()
        rule.onNodeWithContentDescription("Collapse composer").performClick()
        assertEquals(initial, row.getBoundsInRoot().let { it.bottom - it.top })
    }
}
