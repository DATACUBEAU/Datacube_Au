package au.datacube.app.data.rag

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import kotlinx.coroutines.sync.Mutex

/**
 * Process-wide admission control for heavyweight native model execution.
 * Playback of already rendered PCM and lexical search do not need this gate.
 * Callers must never acquire it recursively or hold it across unrelated I/O.
 */
internal object LocalComputeGate {
    val mutex = Mutex()

    enum class Engine { CHAT, EMBEDDING, SPEECH }

    /** Called only while holding the gate. Close idle competing model caches
     * on constrained devices before allocating new weights. Never interrupt
     * a live generation or delete model files. */
    suspend fun prepare(context: Context, engine: Engine) {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (Build.VERSION.SDK_INT >= 29 && power != null &&
            power.currentThermalStatus >= PowerManager.THERMAL_STATUS_SEVERE) {
            throw DeviceComputePressure("Device is too warm for local AI. Allow it to cool before retrying.")
        }
        if (manager != null) {
            val memory = ActivityManager.MemoryInfo().also { manager.getMemoryInfo(it) }
            if (AuEffort.MAXIMUM.forMemory(memory.totalMem, memory.availMem,
                    manager.isLowRamDevice || memory.lowMemory) != AuEffort.MAXIMUM) {
                if (engine != Engine.CHAT) LocalGenerativeEngine.releaseAdmitted()
                if (engine != Engine.EMBEDDING) LocalEmbeddingRuntime.closeAdmitted()
            }
            manager.getMemoryInfo(memory)
            if (memory.lowMemory) throw DeviceComputePressure("Device memory is critically low. Close other apps or select a smaller model.")
        }
    }
}

internal class DeviceComputePressure(message: String) : IllegalStateException(message)
