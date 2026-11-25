package au.datacube.app.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AuResponseParserTest {
    @Test fun rendersStructuredResponsesAndKeepsActualStatusText() {
        val blocks = AuResponseParser.parse(
            "# Results\n| Check | Status |\n| --- | --- |\n| Backup | Verified |\n" +
                "| Test | Pending |\n[ERROR] Archive is missing\n- Review the folder."
        )
        assertEquals(4, blocks.size)
        assertEquals(1, (blocks[0] as AuResponseBlock.Prose).heading)
        val table = blocks[1] as AuResponseBlock.Table
        assertEquals(listOf("Check", "Status"), table.headers)
        assertEquals(listOf("Backup", "Verified"), table.rows.first())
        assertEquals("ERROR", (blocks[2] as AuResponseBlock.Status).kind)
        assertEquals("• ", (blocks[3] as AuResponseBlock.Prose).prefix)
    }

    @Test fun malformedTablesAndUnfinishedCodeRemainReadable() {
        val plain = AuResponseParser.parse("A | B\nNot a separator")
        assertTrue(plain.all { it is AuResponseBlock.Prose })
        val code = AuResponseParser.parse("\u0060\u0060\u0060kotlin\nval x = 1")
        assertEquals("val x = 1", (code.single() as AuResponseBlock.Code).text)
    }
    @Test fun completeBarChartRendersAndNarratesExactValues() {
        val raw = "[BAR] Downloads (count)\nA | 12\nB | 4.5\n[/BAR]"
        val chart = AuResponseParser.parse(raw).single() as AuResponseBlock.BarChart
        assertEquals(listOf("A" to 12.0, "B" to 4.5), chart.rows)
        assertTrue(AuSpokenResponse.format(raw).contains("B: 4.5"))
    }

    @Test fun malformedBarChartDoesNotBecomeAVisual() {
        listOf("[BAR] Chart\nA | NaN\nB | 2\n[/BAR]",
            "[BAR] Chart\nA | -1\nB | 2\n[/BAR]",
            "[BAR] Chart\nA | 1\nA | 2\n[/BAR]",
            "[BAR] Chart\nA | 1\nB | 2").forEach { raw ->
            assertTrue(AuResponseParser.parse(raw).none { it is AuResponseBlock.BarChart })
        }
    }
    @Test fun groupedWorkflowPreservesStageCardsAndSpokenDescriptions() {
        val raw = "[WORKFLOW] Reward pipeline\nProvider :: Verified callback\n30 min :: Podcast | +10 :: Images | +10 :: Voice\nLedger\n[/WORKFLOW]"
        val workflow = AuResponseParser.parse(raw).single() as AuResponseBlock.Workflow
        assertEquals(listOf(1, 3, 1), workflow.stages.map { it.size })
        assertEquals("+10", workflow.stages[1][1].title)
        assertEquals("Images", workflow.stages[1][1].detail)
        assertTrue(AuSpokenResponse.format(raw).contains("30 min: Podcast"))
    }

    @Test fun invalidOrUnfinishedWorkflowDoesNotRender() {
        listOf("[WORKFLOW] Test\nA\nB", "[WORKFLOW] Test\nA | B | C | D\nE\n[/WORKFLOW]",
            "[WORKFLOW] Test\nA | \nB\n[/WORKFLOW]").forEach { raw ->
            assertTrue(AuResponseParser.parse(raw).none { it is AuResponseBlock.Workflow })
        }
    }

    @Test fun onlyAllowedSchematicRendersAndNarrates() {
        assertEquals(AuResponseBlock.ProjectileIllustration,AuResponseParser.parse("[DIAGRAM] projectile").single())
        assertTrue(AuSpokenResponse.format("[DIAGRAM] projectile").contains("not to scale"))
        assertTrue(AuResponseParser.parse("[DIAGRAM] arbitrary code").none { it == AuResponseBlock.ProjectileIllustration })
    }
}
