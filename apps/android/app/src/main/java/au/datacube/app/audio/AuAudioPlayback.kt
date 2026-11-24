package au.datacube.app.audio

import android.content.Context
import au.datacube.app.work.AuBackgroundWork
import kotlinx.coroutines.*

/** Single user-selected audio task, independent of composition lifecycle.
 * A replacement waits for the old engine's cleanup rather than mixing voices.
 */
object AuAudioPlayback {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val playbackMutex = kotlinx.coroutines.sync.Mutex()
    private var current: Job? = null

    fun launch(context: Context, label: String, block: suspend () -> Unit): Job {
        stop()
        val app = context.applicationContext
        val job = scope.launch(start = CoroutineStart.LAZY) {
            playbackMutex.lock()
            try { block() } finally { playbackMutex.unlock() }
        }
        current = job
        job.start()
        AuBackgroundWork.track(app, job, label)
        return job
    }

    fun stop() {
        current?.cancel()
        current = null
    }
}
