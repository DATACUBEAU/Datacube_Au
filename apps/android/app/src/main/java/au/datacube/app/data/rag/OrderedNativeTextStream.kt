package au.datacube.app.data.rag

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow

/** Native callbacks must not wait for Compose or silently lose a token.
 * Unlimited channel capacity is bounded by per-request character and event
 * limits checked before enqueueing. Only actual visible text enters the queue. */
internal class NativeStreamStalled(message: String) : IllegalStateException(message)

internal object OrderedNativeTextStream {
    fun read(
        maxChars: Int = 128_000,
        maxEvents: Int = 32_768,
        firstTimeoutMs: Long = 180_000L,
        idleTimeoutMs: Long = 60_000L,
        totalTimeoutMs: Long = 900_000L,
        start: (onText: (String) -> Unit, onDone: () -> Unit, onError: (Throwable) -> Unit) -> Unit
    ): Flow<String> = callbackFlow {
        require(maxChars > 0 && maxEvents > 0 && firstTimeoutMs > 0 && idleTimeoutMs > 0 && totalTimeoutMs > 0)
        val lock = Any()
        var chars = 0
        var events = 0
        var terminal = false
        val started = System.nanoTime()
        var lastProgress = started
        val watchdog = launch {
            val interval = minOf(250L, firstTimeoutMs, idleTimeoutMs, totalTimeoutMs).coerceAtLeast(1L)
            while (true) {
                delay(interval)
                val expired = synchronized(lock) {
                    if (terminal) true else {
                        val now = System.nanoTime()
                        val total = (now - started) / 1_000_000L
                        val idle = (now - lastProgress) / 1_000_000L
                        val limit = if (events == 0) firstTimeoutMs else idleTimeoutMs
                        if (total >= totalTimeoutMs || idle >= limit) {
                            terminal = true
                            close(NativeStreamStalled(if (events == 0)
                                "AU did not begin responding. Try again or select a smaller model."
                            else "AU stopped generating. Your partial answer is retained; retry to continue."))
                            true
                        } else false
                    }
                }
                if (expired) break
            }
        }
        try {
        start({ part ->
            synchronized(lock) {
                if (!terminal && part.isNotEmpty()) {
                    if (part.length > maxChars - chars || events >= maxEvents) {
                        terminal = true
                        close(IllegalStateException("Native answer exceeded the streaming safety limit."))
                    } else {
                        chars += part.length
                        events++
                        lastProgress = System.nanoTime()
                        val sent = trySend(part)
                        if (sent.isFailure) {
                            terminal = true
                            close(sent.exceptionOrNull() ?: IllegalStateException("Native answer queue closed unexpectedly."))
                        }
                    }
                }
            }
        }, {
            synchronized(lock) {
                if (!terminal) { terminal = true; close() }
            }
        }, { error ->
            synchronized(lock) {
                if (!terminal) { terminal = true; close(error) }
            }
        })
        awaitClose { synchronized(lock) { terminal = true } }
        } finally {
            synchronized(lock) { terminal = true }
            watchdog.cancel()
        }
    }.buffer(Channel.UNLIMITED)
}
