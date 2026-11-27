package au.datacube.app

import android.app.Application
import au.datacube.app.audio.SmoothOfflineNarration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.work.Configuration
import au.datacube.app.auth.AuthRepository
import au.datacube.app.auth.AuthSessionStore
import au.datacube.app.data.DataCubeDatabase

/**
 * Application entry point.
 *
 * Owns the shared singleton graph. The app intentionally stays lightweight —
 * no DI framework is introduced; singletons are accessed directly through
 * named companion/object fields to keep the architecture maintainable for
 * a single developer.
 */
class DataCubeApp : Application(), Configuration.Provider {
    val authSessionStore by lazy { AuthSessionStore(this) }
    val authRepository by lazy { AuthRepository(authSessionStore) }
    val database by lazy { DataCubeDatabase.get(this) }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().build()

    private val voiceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate() {
        super.onCreate()
        instance = this
        voiceScope.launch {
            delay(1200)
            SmoothOfflineNarration.warm(this@DataCubeApp)
        }
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
            voiceScope.launch { SmoothOfflineNarration.releaseIdle() }
        }
    }

    companion object {
        lateinit var instance: DataCubeApp
            private set
    }
}
