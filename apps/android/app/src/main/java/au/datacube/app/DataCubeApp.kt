package au.datacube.app

import android.app.Application
import androidx.core.splashscreen.SplashScreen
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
class DataCubeApp : Application() {

    lateinit var authSessionStore: AuthSessionStore
        private set

    lateinit var authRepository: AuthRepository
        private set

    lateinit var database: DataCubeDatabase
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        authSessionStore = AuthSessionStore(this)
        authRepository = AuthRepository(authSessionStore)
        database = DataCubeDatabase.get(this)
    }

    companion object {
        lateinit var instance: DataCubeApp
            private set
    }
}
