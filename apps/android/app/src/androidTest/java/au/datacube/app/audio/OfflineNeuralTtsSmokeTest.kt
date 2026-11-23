package au.datacube.app.audio

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.mediapipe.tasks.audio.texttospeech.SynthesisOptions
import com.google.mediapipe.tasks.audio.texttospeech.TextToSpeech
import com.google.mediapipe.tasks.audio.texttospeech.TextToSpeechOptions
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Exercising MediaPipe JNI with its publisher-provided test sentinel; no downloaded model. */
@RunWith(AndroidJUnit4::class)
class OfflineNeuralTtsSmokeTest {
    @Test fun mediapipeCanProduceSyntheticLocalAudio() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val base = BaseOptions.builder()
            .setModelAssetPath(TextToSpeech.SYNTHETIC_TEST_MODEL_PATH)
            .setDelegate(Delegate.CPU)
            .build()
        val tts = TextToSpeech.create(
            TextToSpeechOptions(
                base, "af_heart", null, 1.0f, 64, context.cacheDir.absolutePath
            )
        )
        try {
            val pcm = tts.synthesize(
                "Hello from the on-device speech engine.",
                SynthesisOptions("af_heart", null)
            )
            assertTrue(pcm.sampleRateHz > 0)
            assertTrue(pcm.samples.isNotEmpty())
        } finally {
            tts.close()
        }
    }
}
