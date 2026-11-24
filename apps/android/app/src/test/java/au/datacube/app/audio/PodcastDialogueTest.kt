package au.datacube.app.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PodcastDialogueTest {
    @Test fun parsesTwoRolesWithDistinctKokoroVoices() {
        val raw = """
            HOST: Today we're exploring cross-platform app development.
            GUIDE: Flutter provides a way to create applications for different devices.
            HOST: What is the role of widgets in that architecture?
            GUIDE: Widgets describe the visual interface and how elements are composed.
            HOST: Can you give me one practical takeaway?
            GUIDE: Build a small interface with reusable components before adding complexity.
        """.trimIndent()
        val parsed = PodcastDialogue.parse(raw)
        assertEquals(6, parsed.size)
        assertEquals(PodcastSpeaker.HOST, parsed[0].speaker)
        assertEquals(PodcastSpeaker.GUIDE, parsed[1].speaker)
        assertEquals("af_heart", PodcastDialogue.voiceFor(parsed[0].speaker))
        assertEquals("am_adam", PodcastDialogue.voiceFor(parsed[1].speaker))
    }

    @Test fun rejectsUnstructuredTextInsteadOfPretendingItIsAnAudioDiscussion() {
        assertThrows(IllegalArgumentException::class.java) {
            PodcastDialogue.parse("The document is about Android. This is a nice lecture.")
        }
    }

    @Test fun rejectsSingleSpeakerAndRemovesUnsupportedCitationTokens() {
        assertThrows(IllegalArgumentException::class.java) {
            PodcastDialogue.parse((1..5).joinToString("\n") {
                "HOST: This section introduces a new concept and describes a related example."
            })
        }
        assertTrue(PodcastDialogue.sanitize("Learning widgets [1] matters.").contains("Learning widgets"))
        assertTrue(PodcastDialogue.sanitize("Learning widgets [1] matters.").contains("matters."))
    }

    @Test fun combinesRepeatedRolesAndKeepsAlternatingQuestionAnswerPairs() {
        val parsed = PodcastDialogue.parse("""
            HOST: What is this chapter about?
            HOST: Why does it matter?
            GUIDE: It explains how storage preserves information.
            HOST: How is that different from memory?
            GUIDE: Memory holds information temporarily during active work.
            HOST: One last unfinished question?
        """.trimIndent())
        assertEquals(4, parsed.size)
        assertTrue(parsed.first().text.contains("Why does it matter?"))
        assertEquals(PodcastSpeaker.GUIDE, parsed.last().speaker)
        assertTrue(parsed.zipWithNext().all { (a, b) -> a.speaker != b.speaker })
    }
}
