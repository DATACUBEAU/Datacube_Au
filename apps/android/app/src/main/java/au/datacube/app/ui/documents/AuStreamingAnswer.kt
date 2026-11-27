package au.datacube.app.ui.documents

import android.os.SystemClock
import au.datacube.app.data.rag.ModelOutputCleaner

/** One request's visible stream. Parsing/cleaning runs on the inference thread,
 * only changed snapshots cross to the main dispatcher. Always flush final text. */
internal class AuStreamingAnswer(
    private val sourceCount: Int,
    private val clock: () -> Long = { SystemClock.elapsedRealtime() },
    private val publish: suspend (String) -> Unit
) {
    private val raw = StringBuilder()
    private var lastUpdate: Long? = null
    private var lastVisible = ""
    suspend fun append(part: String) {
        if (part.isEmpty()) return
        // Keep existing bounded history contract; report overflow rather than
        // passing off a silently truncated reply as a successful answer.
        check(raw.length + part.length <= 64_000) { "Response exceeds the local output safety limit." }
        raw.append(part)
        val now = clock()
        val previous = lastUpdate
        if (previous != null && now - previous < 100L) return
        emit(ModelOutputCleaner.streamingVisible(raw.toString(), sourceCount))
        lastUpdate = now
    }

    suspend fun finish(): String {
        val answer = ModelOutputCleaner.visible(raw.toString(), sourceCount).trim()
        emit(answer)
        return answer
    }

    fun partial(): String = ModelOutputCleaner.streamingVisible(raw.toString(), sourceCount).trim()

    private suspend fun emit(answer: String) {
        if (answer == lastVisible) return
        lastVisible = answer
        publish(answer)
    }
}
