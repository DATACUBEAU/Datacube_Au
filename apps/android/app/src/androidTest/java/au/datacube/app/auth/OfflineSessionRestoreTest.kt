package au.datacube.app.auth

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import android.content.Context
import io.github.jan.supabase.auth.user.UserSession
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OfflineSessionRestoreTest {
    private val context get() = ApplicationProvider.getApplicationContext<Context>()
    private val store get() = AuthSessionStore(context)
    private val manager get() = EncryptedSupabaseSessionManager(context)

    private fun expiredSession(): UserSession = Json { ignoreUnknownKeys = true }.decodeFromString(
        UserSession.serializer(),
        """{"access_token":"fixture-expired","refresh_token":"fixture-refresh","expires_in":3600,"expires_at":1000,"token_type":"bearer","user":{"id":"offline-account","aud":"authenticated"}}"""
    )

    @Test fun expiredEncryptedSessionRestoresBeforeSdkOrNetworkInitialization() = runBlocking {
        manager.deleteSession()
        try {
            manager.saveSession(expiredSession())
            val repository = AuthRepository(store) { error("Offline restore must not wait for SDK initialization") }
            assertEquals("offline-account", repository.restoreLocalUser()?.id)
            assertEquals("offline-account", repository.savedLocalUser()?.id)
        } finally {
            store.clearLocalSession()
        }
    }

    @Test fun displayMetadataAloneNeverAuthorizesLocalWorkspace() = runBlocking {
        manager.deleteSession()
        try {
            store.persist(expiredSession().user)
            assertNull(store.localUser())
        } finally {
            store.clearLocalSession()
        }
    }

    @Test fun clearingSessionPreventsOfflineReentryAfterRestart() = runBlocking {
        try {
            manager.saveSession(expiredSession())
            assertEquals("offline-account", store.localUser()?.id)
            store.clearLocalSession()
            assertNull(AuthSessionStore(context).localUser())
            assertNull(EncryptedSupabaseSessionManager(context).loadSession())
        } finally {
            store.clearLocalSession()
        }
    }

    @Test fun incompleteCredentialsDoNotAuthorizeLocalWorkspace() = runBlocking {
        try {
            manager.saveSession(expiredSession().copy(refreshToken = ""))
            assertNull(store.localUser())
        } finally {
            store.clearLocalSession()
        }
    }
}
