package au.datacube.app.data.rag

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow

/** Native callbacks must not wait for Compose or silently lose a token.
 * Unlimited channel capacity is bounded by per-request character and event
 * limits checked before enqueueing. Only actual visible text enters the queue. */
internal object OrderedNativeTextStream {
    fun read(
        maxChars: Int = 128_000,
        maxEvents: Int = 32_768,
        start: (onText: (String) -> Unit, onDone: () -> Unit, onError: (Throwable) -> Unit) -> Unit
    ): Flow<String> = callbackFlow {
        require(maxChars > 0 && maxEvents > 0)
        val lock = Any()
        var chars = 0
        var events = 0
        var terminal = false
        start({ part ->
            synchronized(lock) {
                if (!terminal && part.isNotEmpty()) {
                    if (part.length > maxChars - chars || events >= maxEvents) {
                        terminal = true
                        close(IllegalStateException("Native answer exceeded the streaming safety limit."))
                    } else {
                        chars += part.length
                        events++
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
    }.buffer(Channel.UNLIMITED)
}
