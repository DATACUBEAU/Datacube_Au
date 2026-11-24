package au.datacube.app.ui.documents

import au.datacube.app.data.rag.RagEvidence
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StudyGenerationPromptTest {
    private val passages = (1..12).map {
        RagEvidence("Chapter $it: " + "explanation ".repeat(250), it)
    }

    @Test fun revisionKeepsAttachedReferenceEvenWhenMainEvidenceIsLarge() {
        val marker = "SUPPLEMENTARY_FILE_SPECIFIC_EVIDENCE"
        val prepared = StudyGenerationPrompt.prepare(
            "Algorithms.pdf", GeneratedStudyMode.REVISION,
            passages, marker + " " + "revision ".repeat(1100)
        )
        assertEquals(8, prepared.evidence.size)
        assertTrue(prepared.text.contains(marker))
        assertTrue(prepared.text.contains("ADDITIONAL USER-SELECTED REFERENCE"))
        assertTrue(prepared.text.contains("PRIORITY:"))
        assertTrue(prepared.text.length <= 19_000)
    }

    @Test fun notePromptsAreStructuredAndDoNotImportPredictionAttachment() {
        val prepared = StudyGenerationPrompt.prepare(
            "Lecture.pdf", GeneratedStudyMode.NOTES,
            passages, "PREDICTION_ONLY_REFERENCE"
        )
        assertTrue(prepared.text.contains("TOPIC:"))
        assertTrue(prepared.text.contains("2-5 clear"))
        assertFalse(prepared.text.contains("PREDICTION_ONLY_REFERENCE"))
        assertTrue(prepared.text.contains("Do not invent facts"))
    }

    @Test fun fallbackOverviewCoversStartMiddleAndEnd() {
        val chunks = (0..39).toList()
        val sample = StudyGenerationPrompt.spreadAcross(chunks, 10)
        assertEquals(10, sample.size)
        assertEquals(0, sample.first())
        assertEquals(39, sample.last())
        assertTrue(sample.any { it in 18..22 })
    }
}
