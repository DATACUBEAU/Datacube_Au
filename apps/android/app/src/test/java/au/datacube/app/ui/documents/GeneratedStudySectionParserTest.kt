package au.datacube.app.ui.documents

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GeneratedStudySectionParserTest {
    @Test fun usesOnlyActualGeneratedHeadingsInConceptTree() {
        val parsed = GeneratedStudySectionParser.parse(
            "TOPIC: Database indexing\nAn index helps retrieve records.\n" +
                "TOPIC: Queries\nA query requests stored information."
        )
        assertEquals(2, parsed.size)
        assertEquals("Database indexing", parsed.first().topic)
        assertTrue(parsed.last().details.contains("query requests"))
    }

    @Test fun revisionPrioritySectionsRemainReadable() {
        val sections = GeneratedStudySectionParser.parse(
            "PRIORITY: Variables\nReview declaration and scoping.\n" +
                "PRIORITY: Layout\nPractice constraints."
        )
        assertEquals(2, sections.size)
        assertEquals("Variables", sections.first().topic)
    }

    @Test fun unstructuredGeneratedTextIsStillShownWithoutInventedTopics() {
        val sections = GeneratedStudySectionParser.parse(
            "First paragraph with a useful explanation.\n\nSecond useful paragraph."
        )
        assertEquals(2, sections.size)
        assertEquals("Section 1", sections.first().topic)
    }
}
