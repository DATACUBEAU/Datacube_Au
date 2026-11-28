package au.datacube.app.data.rag

import org.junit.Assert.*
import org.junit.Test

class AuAnswerPlanTest {
    private fun plan(q: String?, effort: AuEffort = AuEffort.BALANCED, visual: Boolean = false,
        multimodal: Boolean = false, model: String = "gemma-4-e2b") =
        AuAnswerPlan.build(q, effort, model, false, visual, multimodal)

    @Test fun definitionAndBriefRequestAvoidUnnecessaryThinking() {
        assertEquals(512, plan("What is photosynthesis?").outputTokens)
        assertEquals(0, plan("What is photosynthesis?").thinkingTokens)
        assertEquals(384, plan("Explain gravity briefly").outputTokens)
        assertTrue(plan("What is photosynthesis?").instruction.startsWith("Start with the definition"))
    }

    @Test fun followUpsAndComplexQuestionsKeepSelectedBudget() {
        for (q in listOf("What is it?", "Compare velocity and speed", "Derive the equation step by step")) {
            val p = plan(q)
            assertEquals(AuEffort.BALANCED.outputTokens, p.outputTokens)
            assertEquals(AuEffort.BALANCED.thinkingTokens, p.thinkingTokens)
        }
        assertEquals(AuEffort.DEEP.outputTokens, plan("What is gravity?", AuEffort.DEEP).outputTokens)
        assertEquals(AuEffort.DEEP.thinkingTokens, plan("What is gravity?", AuEffort.DEEP).thinkingTokens)
    }

    @Test fun visualAndMultimodalRequestsKeepBudgetAndUnknownModelsKeepDefaultThinking() {
        assertEquals(AuEffort.BALANCED.outputTokens, plan("What is a cell?", visual = true).outputTokens)
        assertEquals(AuEffort.BALANCED.outputTokens, plan("What is this?", multimodal = true).outputTokens)
        assertNull(plan("What is gravity?", model = "qwen3-0.6b-litert").thinkingTokens)
    }
}
