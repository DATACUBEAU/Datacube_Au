package au.datacube.app.ui.common

import org.junit.Assert.assertFalse
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

    @Test fun nativeSketchSupportsDifferentSubjectsAndNarration() {
        val raw = "[SKETCH] Plant cell\nALT | A cell wall surrounds the cell and its nucleus.\nRECT | 10 | 10 | 90 | 90\nCIRCLE | 50 | 50 | 15\nLABEL | 50 | 65 | Nucleus\n[/SKETCH]"
        val scene = (AuResponseParser.parse(raw).single() as AuResponseBlock.Sketch).scene
        assertEquals(3,scene.commands.size)
        assertTrue(AuSpokenResponse.format(raw).contains("cell wall"))
        assertTrue(AuResponseParser.parse(raw.replace("50 | 50 | 15","500 | 50 | 15")).none { it is AuResponseBlock.Sketch })
        assertTrue(AuResponseParser.parse(raw.replace("RECT | 10 | 10 | 90 | 90","SCRIPT | arbitrary")).none { it is AuResponseBlock.Sketch })
        assertTrue(AuResponseParser.parse(raw.substringBefore("[/SKETCH]")).none { it is AuResponseBlock.Sketch })
    }

    @Test fun formulaCardKeepsSymbolsAndNarration() {
        val raw = "[FORMULA] Newton's second law\nF = m × a\nF | net force in newtons\nm | mass in kilograms\na | acceleration\n[/FORMULA]"
        val block = AuResponseParser.parse(raw).single() as AuResponseBlock.Formula
        assertEquals("F = m × a",block.equation)
        assertEquals(3,block.symbols.size)
        assertTrue(AuSpokenResponse.format(raw).contains("F means net force in newtons"))
        assertTrue(AuResponseParser.parse(raw.substringBefore("[/FORMULA]")).none { it is AuResponseBlock.Formula })
    }

    @Test fun guidedStepsRetainNestedIllustrationAndNarration() {
        val raw="[STEPS] Learn motion\n[STEP] Start\nA ball moves forward.\n[STEP] Gravity\n[DIAGRAM] projectile\n[/STEPS]"
        val deck=AuResponseParser.parse(raw).single() as AuResponseBlock.Steps
        assertEquals(2,deck.pages.size)
        assertTrue(AuResponseParser.parse(deck.pages[1].body).contains(AuResponseBlock.ProjectileIllustration))
        assertTrue(AuSpokenResponse.format(raw).contains("Step 2. Gravity"))
        assertTrue(AuResponseParser.parse(raw.substringBefore("[/STEPS]")).none { it is AuResponseBlock.Steps })
    }

    @Test fun nestedStepDecksAreNotAcceptedAsOuterDecks() {
        val raw="[STEPS] Outer\n[STEP] A\n[STEPS] Inner\n[STEP] X\nOne\n[STEP] Y\nTwo\n[/STEPS]\n[STEP] B\nThree\n[/STEPS]"
        assertFalse(AuResponseParser.parse(raw).any { it is AuResponseBlock.Steps && it.title=="Outer" })
    }

    @Test fun parallelLinesPreserveDirectionAndSpokenDescription() {
        val raw = "[SKETCH] Parallel lines\nALT | Two distinct lines have the same direction and never meet.\nLINE | 12 | 70 | 72 | 30\nLINE | 24 | 88 | 84 | 48\n[/SKETCH]"
        val scene = (AuResponseParser.parse(raw).single() as AuResponseBlock.Sketch).scene
        val lines = scene.commands.filter { it.kind == "LINE" }.map { it.coordinates }
        assertEquals(2, lines.size)
        assertEquals(lines[0][2] - lines[0][0], lines[1][2] - lines[1][0])
        assertEquals(lines[0][3] - lines[0][1], lines[1][3] - lines[1][1])
        assertTrue(lines[0][0] != lines[1][0])
        assertTrue(AuSpokenResponse.format(raw).contains("never meet"))
    }
}
