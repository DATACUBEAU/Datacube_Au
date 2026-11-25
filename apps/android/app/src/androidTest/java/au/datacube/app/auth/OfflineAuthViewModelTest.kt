package au.datacube.app.auth

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.lifecycle.viewModelScope
import androidx.test.core.app.ApplicationProvider
import au.datacube.app.DataCubeApp
import au.datacube.app.ui.auth.AuthViewModel
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.user.UserSession
import io.github.jan.supabase.createSupabaseClient
import io.ktor.client.engine.mock.MockEngine
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test

class OfflineAuthViewModelTest {
    @get:Rule val ui = createComposeRule()

    @Test fun expiredSessionOpensWorkspaceWithoutWaitingForRefresh() {
        val app = ApplicationProvider.getApplicationContext<DataCubeApp>()
        val manager = EncryptedSupabaseSessionManager(app)
        val store = AuthSessionStore(app)
        val session = Json { ignoreUnknownKeys = true }.decodeFromString(
            UserSession.serializer(),
            """{"access_token":"fixture-expired","refresh_token":"fixture-refresh","expires_in":3600,"expires_at":1000,"token_type":"bearer","user":{"id":"offline-account","aud":"authenticated"}}"""
        )
        runBlocking {
            store.clearLocalSession()
            manager.saveSession(session)
        }
        val supabase = createSupabaseClient("https://fixture.invalid", "fixture-public") {
            // Any network request remains unavailable for the entire test.
            httpEngine = MockEngine { awaitCancellation() }
            install(Auth) { sessionManager = manager; alwaysAutoRefresh = true }
        }
        val repository = AuthRepository(store) { supabase.auth }
        val model = ui.runOnUiThread { AuthViewModel(app, repository) }
        try {
            ui.waitUntil(10_000) { model.state.value.sessionRestored && !model.state.value.isLoading }
            assertEquals("offline-account", model.state.value.user?.id)
            assertFalse(model.state.value.isLoading)
        } finally {
            ui.runOnUiThread { model.viewModelScope.cancel() }
            runBlocking {
                supabase.close()
                store.clearLocalSession()
            }
        }
    }
}
