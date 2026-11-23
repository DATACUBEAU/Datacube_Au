package au.datacube.app.ui.common

import org.junit.Assert.assertEquals
import org.junit.Test

class AuActivityTimelineTest {
    @Test fun categorizesRealRetrievalStages() {
        assertEquals(AuActivityKind.SEARCH, classifyAuActivity("Searched document text"))
        assertEquals(AuActivityKind.SEARCH, classifyAuActivity("Combined BM25 and vector ranks"))
        assertEquals(AuActivityKind.EVIDENCE, classifyAuActivity("Selected 4 supporting passages"))
        assertEquals(AuActivityKind.ANSWER, classifyAuActivity("Generated an answer using AU"))
        assertEquals(AuActivityKind.OTHER, classifyAuActivity("Listed imported document titles"))
        assertEquals(AuActivityKind.ERROR, classifyAuActivity("AU response failed; sources remain available"))
    }
}
