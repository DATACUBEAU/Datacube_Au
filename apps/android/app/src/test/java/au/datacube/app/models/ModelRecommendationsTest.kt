package au.datacube.app.models

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelRecommendationsTest {
    @Test fun limitedDevicesNeverRecommendLargeModels() {
        assertNull(ModelRecommendations.bestChatModel(2, 1))
        assertEquals("qwen3-0.6b-litert", ModelRecommendations.bestChatModel(4, 4))
    }

    @Test fun selectsBalancedModelForMemoryAndStorage() {
        assertEquals("gemma-4-e2b", ModelRecommendations.bestChatModel(6, 7))
        assertEquals("gemma-4-e4b", ModelRecommendations.bestChatModel(8, 10))
        assertEquals("gemma-4-e2b", ModelRecommendations.bestChatModel(8, 6))
    }

    @Test fun noDownloadIsPossibleForUnknownOrUnreviewedIds() {
        assertFalse(ModelRecommendations.compatible("unknown", 64))
        assertTrue(ModelRecommendations.compatible("gemma-4-e2b", 8))
        assertFalse(ModelRecommendations.compatible("gemma-4-e4b", 5))
    }

    @Test fun setupPlanRespectsCombinedStorageAndAndroidRuntime() {
        val plan = ModelRecommendations.setupPlan(8,12,35,true)
        assertEquals("gemma-4-e4b",plan.chat)
        assertEquals("embeddinggemma-2-270m",plan.search)
        assertEquals("kokoro-82m-cpu",plan.voice)
        val low = ModelRecommendations.setupPlan(8,1,35,true)
        assertNull(low.chat)
        assertNull(low.search)
        assertNull(low.voice)
        val oldAndroid = ModelRecommendations.setupPlan(8,12,26,true)
        assertNull(oldAndroid.search)
        assertNull(oldAndroid.voice)
        assertNull(ModelRecommendations.setupPlan(8,12,35,false).chat)
    }

    @Test fun setupPlanKeepsCompatibleInstalledChatAndDoesNotChargeForItAgain() {
        val plan = ModelRecommendations.setupPlan(8,4,35,true,setOf("gemma-4-e2b"))
        assertEquals("gemma-4-e2b",plan.chat)
        assertEquals("embeddinggemma-2-270m",plan.search)
    }
}
