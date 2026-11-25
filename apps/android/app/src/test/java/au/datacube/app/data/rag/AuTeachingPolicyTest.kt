package au.datacube.app.data.rag
import org.junit.Assert.*
import org.junit.Test

class AuTeachingPolicyTest {
    @Test fun audienceAndSubjectAreIndependent() {
        val p = AuTeachingPolicy.plan("Explain this document like I'm a beginner","Physics 101.pdf")
        assertEquals(AuTeachingPolicy.Level.SIMPLE,p.level)
        assertEquals(AuTeachingPolicy.Subject.PHYSICS,p.subject)
        assertEquals(AuTeachingPolicy.Visual.AUTO,p.visual)
    }
    @Test fun visualRequestAndOptOut() {
        assertEquals(AuTeachingPolicy.Visual.REQUESTED,AuTeachingPolicy.plan("Draw a cell diagram").visual)
        assertEquals(AuTeachingPolicy.Visual.TEXT_ONLY,AuTeachingPolicy.plan("Explain with no diagrams").visual)
        assertEquals(AuTeachingPolicy.Subject.MATHEMATICS,AuTeachingPolicy.plan("Solve this quadratic").subject)
    }
    @Test fun technicalAndGeneralConversation() {
        assertEquals(AuTeachingPolicy.Level.ADVANCED,AuTeachingPolicy.plan("Derive formally").level)
        assertEquals(AuTeachingPolicy.Subject.GENERAL,AuTeachingPolicy.plan("Hello").subject)
        assertEquals(AuTeachingPolicy.Level.BRIEF,AuTeachingPolicy.plan("Keep it short").level)
    }
}
