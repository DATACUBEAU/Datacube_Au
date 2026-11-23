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

    @Test fun embeddingGemma2HasPublisherPinnedBytes() {
        val model = requireNotNull(VerifiedModelDownloads.find("embeddinggemma-2-270m"))
        assertEquals("Apache-2.0", model.license)
        assertEquals("2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb", model.sha256)
        assertTrue(model.url.contains("/resolve/9be6e8b90982095dc05c2bd162e4b954ee4dbac7/"))
    }

    @Test fun neverDownloadsGatedOrUnreviewedModel() {
        assertEquals(
            "ab7838cdfc8f77e54d8ca45eadceb20452d9f01e4bfade03e5dce27911b27e42",
            requireNotNull(VerifiedModelDownloads.find("gemma-4-e2b")).sha256
        )
        assertEquals(
            "0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0",
            requireNotNull(VerifiedModelDownloads.find("gemma-4-e4b")).sha256
        )
        assertNull(VerifiedModelDownloads.find("embeddinggemma-300m"))
        assertNull(VerifiedModelDownloads.find("unknown-model"))
    }

    @Test fun kokoroHasPinnedPublisherDigestAndOptionalVoiceRole() {
        val model = requireNotNull(VerifiedModelDownloads.find("kokoro-82m-cpu"))
        assertEquals("e7b931ee5d4b7104012a838c9eee240d19ea69cb3ca269041a3274f83dbb7fa1", model.sha256)
        assertTrue(model.url.contains("/resolve/81e43a025bccabcbbd487f08bc3ebd65b5fc7295/"))
        assertEquals(ModelRole.VOICE, ModelCatalog.find("kokoro-82m-cpu").role)
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
