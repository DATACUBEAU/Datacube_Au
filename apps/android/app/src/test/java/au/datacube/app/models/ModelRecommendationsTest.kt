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
}
