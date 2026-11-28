package au.datacube.app.data.rag

import org.junit.Assert.*
import org.junit.Test

class AuScienceTemplateTest {
    @Test fun scientificExplanationsAndRequestsSelectRelevantTemplates() {
        assertEquals(AuScienceTemplate.PLANT_CELL, AuScienceTemplate.select("Explain the structure of a plant cell"))
        assertEquals(AuScienceTemplate.WATER_CYCLE, AuScienceTemplate.select("What is the water cycle?"))
        assertEquals(AuScienceTemplate.PARALLEL_LINES, AuScienceTemplate.select("Draw parallel lines"))
        assertEquals(AuScienceTemplate.SINE_WAVE, AuScienceTemplate.select("Show a sine wave simulation"))
        assertNull(AuScienceTemplate.select("Explain plant cells with no diagrams"))
        assertNull(AuScienceTemplate.select("Compare plant cells and animal cells"))
        assertNull(AuScienceTemplate.select("Create a concept map of plant cells"))
        assertNull(AuScienceTemplate.select("Hello"))
        assertNull(AuScienceTemplate.fromKey("unknown"))
    }

    @Test fun automaticVisualInstructionsAreSelective() {
        assertTrue(AuVisualPlan.optionalInstruction("Explain the process of digestion")!!.contains("[FLOW]"))
        assertTrue(AuVisualPlan.optionalInstruction("Explain the classification of matter")!!.contains("[TREE]"))
        assertNull(AuVisualPlan.optionalInstruction("Explain the process without diagrams"))
        assertNull(AuVisualPlan.optionalInstruction("Hello"))
        assertTrue(AuVisualPlan.instruction("Draw parallel lines").contains("[SCIENCE] parallel-lines"))
    }

    @Test fun generalAnswerFallbackDoesNotDuplicateExistingVisual() {
        val template=AuScienceTemplate.WATER_CYCLE
        assertEquals("\n\n[SCIENCE] water-cycle",template.missingIllustration("The water cycle involves evaporation and precipitation."))
        assertNull(template.missingIllustration("The water cycle involves evaporation.\n[SCIENCE] water-cycle"))
        assertNull(template.missingIllustration("I cannot answer that question."))
    }

    @Test fun waveUsesActualMathematicsAndBoundedParameters() {
        val wave=AuWaveParameters(2f,1f)
        assertEquals(0.0,wave.displacement(0.0),1e-8)
        assertEquals(2.0,wave.displacement(.25),1e-8)
        assertEquals(-2.0,wave.displacement(.75),1e-8)
        assertEquals(0.0,AuWaveParameters(2f,2f).displacement(.25),1e-8)
        assertTrue(runCatching { AuWaveParameters(Float.NaN,1f) }.isFailure)
        assertTrue(runCatching { AuWaveParameters(1f,99f) }.isFailure)
    }
}
