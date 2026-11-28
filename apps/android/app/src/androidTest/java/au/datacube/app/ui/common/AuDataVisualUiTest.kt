package au.datacube.app.ui.common

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import au.datacube.app.data.rag.AuSimulationKind
import au.datacube.app.data.rag.AuVisualData
import au.datacube.app.ui.theme.DataCubeTheme
import org.junit.Rule
import org.junit.Test

class AuDataVisualUiTest {
    @get:Rule val rule=createComposeRule()
    @Test fun relationshipMapCanExpandAndClose() {
        val data=AuVisualData.map("Data relationships",listOf("NODE | a | Source","NODE | b | Target","EDGE | a | b | sends"))!!
        rule.setContent { DataCubeTheme { AuDiagramInspector(data.title) { AuRelationshipMap(data) } } }
        rule.onNodeWithText("Expand diagram").performClick()
        rule.onNodeWithText("1.0×").assertIsDisplayed()
        rule.onNodeWithText("+").performClick()
        rule.onNodeWithText("1.5×").assertIsDisplayed()
        rule.onNodeWithText("Close").performClick()
        rule.onNodeWithText("Expand diagram").assertIsDisplayed()
    }

    @Test fun quadraticSimulationExposesParametersAndReset() {
        rule.setContent { DataCubeTheme { Column(Modifier.verticalScroll(rememberScrollState())) { AuLearningSimulation(AuSimulationKind.QUADRATIC) } } }
        rule.onNodeWithText("a: 1").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("b: 0").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("c: 0").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Reset simulation").performScrollTo().performClick()
        rule.onNodeWithText("a: 1").performScrollTo().assertIsDisplayed()
    }
}
