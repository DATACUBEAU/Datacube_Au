package au.datacube.app.data.rag

import kotlinx.coroutines.sync.Mutex

/**
 * Process-wide admission control for heavyweight native model execution.
 * Playback of already rendered PCM and lexical search do not need this gate.
 * Callers must never acquire it recursively or hold it across unrelated I/O.
 */
internal object LocalComputeGate {
    val mutex = Mutex()
}
