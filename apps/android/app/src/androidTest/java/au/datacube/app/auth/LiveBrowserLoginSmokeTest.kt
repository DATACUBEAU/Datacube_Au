package au.datacube.app.auth

import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import au.datacube.app.DataCubeApp
import au.datacube.app.ui.auth.AuthScreen
import au.datacube.app.ui.auth.AuthViewModel
import au.datacube.app.ui.theme.DataCubeTheme
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.createSupabaseClient
import io.ktor.client.engine.mock.MockEngine
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test

/**
 * Live production smoke test on a real Android emulator networking stack.
 * Never signs in a user. The pending device approval is cancelled after the test.
 * Diagnoses the previously untested Android -> Vercel -> Supabase create path.
 */
class LiveBrowserLoginSmokeTest {
    @get:Rule val ui = createComposeRule()

    private val app get() = ApplicationProvider.getApplicationContext<DataCubeApp>()
    @Volatile private var launchedUri: Uri? = null
    @Volatile private var createFailure: Throwable? = null

    @Test fun continueWithGoogleCreatesRealRequestAndOffersBrowserNavigation() {
        val pendingStore = EncryptedPendingMobileAuthorizationStore(app)
        val sessionStore = EncryptedSupabaseSessionManager(app)
        runBlocking { pendingStore.clear(); sessionStore.deleteSession() }
        val supabase = createSupabaseClient("https://fixture.invalid", "fixture-public") {
            httpEngine = MockEngine { error("Unexpected fixture network request") }
            install(Auth) { sessionManager = sessionStore; alwaysAutoRefresh = false }
        }
        val repository = AuthRepository(AuthSessionStore(app)) { supabase.auth }
        val live = MobileAuthorizationClient("https://datacube-au.vercel.app")
        val gateway = object : MobileAuthorizationGateway by live {
            override suspend fun create(challenge: String): MobileAuthorizationCreated {
                return try { live.create(challenge) } catch (error: Throwable) {
                    createFailure = error
                    Log.e("DCAU_LIVE_SMOKE", "create_failure_kind=" + error.javaClass.name, error)
                    throw error
                }
            }
        }
        val model = ui.runOnUiThread {
            AuthViewModel(app, repository, mobileAuthorization = gateway, pendingStore = pendingStore)
        }
        try {
            ui.setContent {
                DataCubeTheme { AuthScreen(model, { uri -> launchedUri = uri }) }
            }
            ui.waitUntil(20_000) { model.state.value.sessionRestored }
            ui.onNodeWithText("Yo, welcome.").assertIsDisplayed()
            ui.onNodeWithText("Continue with Google").performClick()
            ui.waitUntil(45_000) { launchedUri != null || model.state.value.error != null }
            val state = model.state.value
            assertNull("Browser sign-in failed: " + state.error + "; network exception: " +
                createFailure?.javaClass?.name + ": " + createFailure?.message, state.error)
            val destination = requireNotNull(launchedUri) { "App did not generate browser intent" }
            assertEquals("https", destination.scheme)
            assertEquals("datacube-au.vercel.app", destination.host)
            assertEquals("/login", destination.path)
            assertEquals("1", destination.getQueryParameter("forceReauth"))
            assertTrue(Regex("/mobile-auth/approve\\?request=[A-Za-z0-9_-]{43}").matches(destination.getQueryParameter("redirectTo").orEmpty()))
            assertNotNull("Device code was not shown", state.pairingCode)
            val browser = Intent(Intent.ACTION_VIEW, destination).addCategory(Intent.CATEGORY_BROWSABLE)
            // PackageManager browser discovery may be hidden by Android 11+ package visibility,
            // even though starting ACTION_VIEW would work on a user's browser-equipped phone.
            assertEquals(Intent.ACTION_VIEW, browser.action)
            assertEquals(destination, browser.data)
            Log.i("DCAU_LIVE_SMOKE", "Passed: actual UI tap -> live API -> encrypted pending save -> resolvable browser")
        } finally {
            val pending = runBlocking { pendingStore.load() }
            if (pending != null) {
                runBlocking { live.cancel(pending) }
            }
            runBlocking {
                pendingStore.clear()
                sessionStore.deleteSession()
                supabase.close()
            }
        }
    }
}
