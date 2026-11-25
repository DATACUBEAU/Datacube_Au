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

    @Test fun practiceUsesRequestedFormatAndActualBoundedSources() {
        val prepared = StudyGenerationPrompt.prepare(
            "Lecture.pdf", GeneratedStudyMode.PRACTICE, passages, null,
            questionCount = 10, questionStyle = "Recall", focus = "Chapter 3"
        )
        assertTrue(prepared.text.contains("10 distinct practice questions"))
        assertTrue(prepared.text.contains("Recall key facts"))
        assertTrue(prepared.text.contains("Chapter 3"))
        assertTrue(prepared.text.contains("ANSWER:"))
        assertTrue(prepared.evidence.all { it.text.length <= 1150 })
        assertTrue(prepared.text.length <= 18_000)
    }

    @Test fun practiceParserRejectsUnlistedSourcesAndMissingAnswers() {
        val evidence = listOf(SourceSnippet("A verified passage", 7))
        val raw = """
            QUESTION: What is the concept?
            ANSWER: A useful explanation.
            SOURCE: 1
            TOPIC: Concept
            QUESTION: Unsupported question?
            ANSWER: Unsupported answer.
            SOURCE: 9
            TOPIC: Other
            QUESTION: Missing answer?
            SOURCE: 1
            TOPIC: Other
        """.trimIndent()
        val parsed = GeneratedPracticeParser.parse(raw, evidence)
        assertEquals(1, parsed.size)
        assertEquals("A useful explanation.", parsed.single().modelAnswer)
        assertEquals(7, parsed.single().page)
        assertEquals("A verified passage", parsed.single().reference)
    }

    @Test fun fallbackOverviewCoversStartMiddleAndEnd() {
        val chunks = (0..39).toList()
        val sample = StudyGenerationPrompt.spreadAcross(chunks, 10)
        assertEquals(10, sample.size)
        assertEquals(0, sample.first())
        assertEquals(39, sample.last())
        assertTrue(sample.any { it in 18..22 })
    }

    @Test fun boundedNotesRetainLastChapterAndRequestVisuals() {
        val prepared = StudyGenerationPrompt.prepare("Lecture.pdf", GeneratedStudyMode.NOTES, passages, null)
        assertEquals(1, prepared.evidence.first().page)
        assertEquals(12, prepared.evidence.last().page)
        assertTrue(prepared.text.contains("[FLOW]"))
        assertTrue(prepared.text.contains("[WORKFLOW]"))
        assertTrue(prepared.text.contains("selected passages"))
    }
}
