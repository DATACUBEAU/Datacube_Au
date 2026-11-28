package au.datacube.app.ui.common

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import au.datacube.app.data.rag.AuScienceTemplate
import au.datacube.app.data.rag.AuWaveParameters
import au.datacube.app.ui.theme.DataCubeTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class AuScienceVisualUiTest {
    @get:Rule val rule=createComposeRule()

    @Test fun scientificTemplateCanExpandAndZoom() {
        rule.setContent { DataCubeTheme { AuScienceVisual(AuScienceTemplate.PLANT_CELL) } }
        rule.onNodeWithText("Expand").performClick()
        rule.onNodeWithText("1.0×").assertIsDisplayed()
        rule.onNodeWithText("+").performClick()
        rule.onNodeWithText("1.5×").assertIsDisplayed()
        rule.onNodeWithText("Close").performClick()
        rule.onNodeWithText("Expand").assertIsDisplayed()
    }

    @Test fun templateExportsAreBoundedAndActuallyDrawn() {
        AuScienceTemplate.entries.forEach { template ->
            val bitmap=AuScienceRenderer.bitmap(template,AuWaveParameters())
            try {
                assertEquals(1280,bitmap.width)
                assertEquals(840,bitmap.height)
                val pixels=mutableSetOf<Int>()
                for (y in 0 until bitmap.height step 20)
                    for (x in 0 until bitmap.width step 20) pixels += bitmap.getPixel(x,y)
                assertTrue(pixels.size > 2)
            } finally { bitmap.recycle() }
        }
    }
}
