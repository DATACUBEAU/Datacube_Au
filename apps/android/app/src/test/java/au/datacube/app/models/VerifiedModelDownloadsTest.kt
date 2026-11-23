package au.datacube.app.models

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class VerifiedModelDownloadsTest {
    @Test fun knownPublicLiteRtModelHasPinnedRevisionAndSha() {
        val model = requireNotNull(VerifiedModelDownloads.find("qwen3-0.6b-litert"))
        assertEquals("Apache-2.0", model.license)
        assertEquals(
            "c5f39b4191926786c3e6668b62af4d6eb15248dfc7a5348252a9b406f33f2108",
            model.sha256
        )
        assertTrue(model.url.contains("/resolve/e6687177e00897731e7716267eebd4eba0dde7c2/"))
        assertTrue(model.maximumBytes > 614_000_000L)
    }

    @Test fun neverDownloadsGatedOrUnreviewedModel() {
        assertNull(VerifiedModelDownloads.find("gemma-4-e2b"))
        assertNull(VerifiedModelDownloads.find("embeddinggemma-300m"))
        assertNull(VerifiedModelDownloads.find("unknown-model"))
    }

    @Test fun invalidManifestCannotBeRegistered() {
        assertThrows(IllegalArgumentException::class.java) {
            VerifiedModelArtifact(
                "bad-id", "model.litertlm", "http://example.com/model",
                "0".repeat(64), 900_000_000L, "900 MB", "Unknown"
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            VerifiedModelArtifact(
                "bad-id", "../model.litertlm", "https://huggingface.co/publisher/repo/resolve/main/model",
                "0".repeat(64), 900_000_000L, "900 MB", "Unknown"
            )
        }
    }
}
