package au.datacube.app.data.rag

import org.junit.Assert.*
import org.junit.Test

class AuInteractiveLatencyTest {
    @Test fun simpleDefinitionUsesFastBudgetButExplicitDeepEffortIsRetained() {
        assertEquals(AuEffort.FAST, AuInteractiveLatency.generalEffort("What is photosynthesis?", AuEffort.BALANCED))
        assertEquals(AuEffort.DEEP, AuInteractiveLatency.generalEffort("What is photosynthesis?", AuEffort.DEEP))
        assertEquals(AuEffort.BALANCED, AuInteractiveLatency.generalEffort("What is this?", AuEffort.BALANCED))
        assertEquals(AuEffort.BALANCED, AuInteractiveLatency.generalEffort("What is a diagram?", AuEffort.BALANCED))
        assertEquals(AuEffort.BALANCED, AuInteractiveLatency.generalEffort("Why does gravity affect time?", AuEffort.BALANCED))
    }

    @Test fun fastLexicalPathRequiresAllTopicTermsAndFastMode() {
        assertTrue(AuInteractiveLatency.canUseLexicalOnly("Define kinetic energy", AuEffort.FAST, "Kinetic energy is energy of motion."))
        assertFalse(AuInteractiveLatency.canUseLexicalOnly("Define kinetic energy", AuEffort.FAST, "Potential energy."))
        assertFalse(AuInteractiveLatency.canUseLexicalOnly("Define kinetic energy", AuEffort.BALANCED, "Kinetic energy is energy of motion."))
        assertFalse(AuInteractiveLatency.canUseLexicalOnly("Compare kinetic and potential energy", AuEffort.FAST, "Kinetic and potential energy"))
    }
}
