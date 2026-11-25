package au.datacube.app.data.rag

import org.junit.Assert.*
import org.junit.Test

class CollectionProvenanceTest {
    @Test fun samePageAndTextInDifferentDocumentsKeepDistinctProvenance() {
        val first = RagEvidence("Force equals mass times acceleration.", 1, "physics1", "Physics 001")
        val second = first.copy(documentId="physics2",documentName="Physics 002")
        val evidence = GroundedRagPlanner.fuse(listOf(first,second),emptyList(),5)
        assertEquals(2,evidence.size)
        val prompt = GroundedRagPlanner.build("Compare the sources",emptyList(),evidence)
        assertTrue(prompt.value.contains("Physics 001"))
        assertTrue(prompt.value.contains("Physics 002"))
        assertEquals(setOf("physics1","physics2"),prompt.evidence.map { it.documentId }.toSet())
    }
}
