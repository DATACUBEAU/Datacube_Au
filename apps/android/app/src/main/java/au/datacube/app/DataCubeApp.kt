package au.datacube.app

import android.app.Application
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
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
    private val credentialManager by lazy { CredentialManager.create(this) }
    val authRepository by lazy {
        AuthRepository(authSessionStore, resetGoogleAccount = {
            credentialManager.clearCredentialState(ClearCredentialStateRequest())
        })
    }
    val database by lazy { DataCubeDatabase.get(this) }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().build()

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        lateinit var instance: DataCubeApp
            private set
    }
}
