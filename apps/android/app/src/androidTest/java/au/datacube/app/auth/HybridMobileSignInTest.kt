package au.datacube.app.auth

import android.net.Uri
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
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
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class HybridMobileSignInTest {
    @get:Rule val ui = createComposeRule()

    private val app get() = ApplicationProvider.getApplicationContext<DataCubeApp>()
    private val pendingStore get() = EncryptedPendingMobileAuthorizationStore(app)
    private val sessionStore get() = EncryptedSupabaseSessionManager(app)
    private val requestId = "A".repeat(43)
    private val pairingCode = "CUBE27AU"
    private val statusCalls = AtomicInteger()
    private val consumeCalls = AtomicInteger()
    private val cancelCalls = AtomicInteger()
    private val statusCancelled = CompletableDeferred<Unit>()
    private val heldStatus = CompletableDeferred<Unit>()
    @Volatile private var challenge: String? = null
    @Volatile private var approved = false
    @Volatile private var holdStatus = false
    @Volatile private var browserUri: Uri? = null

    private val supabase by lazy {
        createSupabaseClient("https://fixture.invalid", "fixture-public") {
            httpEngine = MockEngine { error("Importing a browser session must use the returned credentials") }
            install(Auth) { sessionManager = sessionStore; alwaysAutoRefresh = false }
        }
    }
    private val repository by lazy { AuthRepository(AuthSessionStore(app)) { supabase.auth } }
    private val httpClient by lazy {
        HttpClient(MockEngine { request ->
            assertEquals("/api/auth/mobile-authorization", request.url.encodedPath)
            assertTrue(request.url.parameters.isEmpty())
            assertNull(request.headers[HttpHeaders.Authorization])
            assertNull(request.headers[HttpHeaders.Cookie])
            val body = Json.parseToJsonElement(request.body.toByteArray().decodeToString()).jsonObject
            val action = body.getValue("action").jsonPrimitive.content
            if (action == "create") {
                assertEquals(setOf("action", "challenge"), body.keys)
                challenge = body.getValue("challenge").jsonPrimitive.content
                assertTrue(MobileAuthorizationRequestId.matches(requireNotNull(challenge)))
            } else {
                assertEquals(setOf("action", "requestId", "verifier"), body.keys)
                assertEquals(requestId, body.getValue("requestId").jsonPrimitive.content)
                val verifier = body.getValue("verifier").jsonPrimitive.content
                assertTrue(MobileAuthorizationRequestId.matches(verifier))
                assertEquals(challenge, mobileAuthorizationChallenge(verifier))
            }
            val response = when (action) {
                "create" -> """{"ok":true,"requestId":"$requestId","pairingCode":"$pairingCode","expiresAt":"${Instant.now().plusSeconds(300)}"}"""
                "status" -> {
                    statusCalls.incrementAndGet()
                    if (holdStatus) {
                        try {
                            heldStatus.await()
                        } catch (cancelled: CancellationException) {
                            statusCancelled.complete(Unit)
                            throw cancelled
                        }
                    }
                    if (approved) """{"ok":true,"status":"approved"}""" else """{"ok":true,"status":"pending"}"""
                }
                "consume" -> {
                    assertEquals(1, consumeCalls.incrementAndGet())
                    assertTrue(approved)
                    """{"ok":true,"status":"consumed","userId":"hybrid-account","session":{"access_token":"fixture-access","refresh_token":"fixture-refresh","expires_in":7200,"expires_at":${Instant.now().plusSeconds(7200).epochSecond},"token_type":"bearer","user":{"id":"hybrid-account","aud":"authenticated"}}}"""
                }
                "cancel" -> {
                    cancelCalls.incrementAndGet()
                    """{"ok":true,"status":"cancelled"}"""
                }
                else -> error("Unexpected hybrid sign-in action")
            }
            respond(response, headers = headersOf(HttpHeaders.ContentType, "application/json"))
        })
    }

    @Before fun clean() = runBlocking {
        pendingStore.clear()
        sessionStore.deleteSession()
    }

    @After fun close() = runBlocking {
        httpClient.close()
        supabase.close()
        pendingStore.clear()
        sessionStore.deleteSession()
    }

    private fun newModel(returnRequest: String? = null): AuthViewModel = ui.runOnUiThread {
        AuthViewModel(
            app,
            repository,
            mobileAuthorization = MobileAuthorizationClient("https://fixture.invalid", httpClient),
            pendingStore = pendingStore
        ).also { model -> returnRequest?.let(model::resumeMobileSignIn) }
    }

    private fun waitForRestore(model: AuthViewModel) {
        ui.waitUntil(10_000) { model.state.value.sessionRestored }
    }

    private fun openBrowserFromLogin() {
        val model = newModel()
        ui.setContent {
            DataCubeTheme {
                AuthScreen(model, { browserUri = it })
            }
        }
        waitForRestore(model)
        ui.onNodeWithText("Yo, welcome.").assertIsDisplayed()
        ui.onAllNodesWithText("Use Google on this device").assertCountEquals(0)
        ui.onNodeWithText("Continue with Google").performClick()
        ui.waitUntil(10_000) { browserUri != null }

        val uri = requireNotNull(browserUri)
        assertEquals("https", uri.scheme)
        assertEquals("fixture.invalid", uri.host)
        assertEquals("/login", uri.path)
        assertEquals(setOf("redirectTo", "forceReauth"), uri.queryParameterNames)
        assertEquals("1", uri.getQueryParameter("forceReauth"))
        assertEquals("/mobile-auth/approve?request=$requestId", uri.getQueryParameter("redirectTo"))
        ui.onNodeWithText(pairingCode).assertIsDisplayed()
        assertNotNull(runBlocking { pendingStore.load() })
    }

    @Test fun foregroundAndAppLinkShareOneConsumerAfterRestart() {
        openBrowserFromLogin()
        val reopened = newModel()
        waitForRestore(reopened)
        assertEquals(pairingCode, reopened.state.value.pairingCode)

        ui.runOnUiThread { reopened.resumeMobileSignIn("B".repeat(43)) }
        assertEquals(0, statusCalls.get())

        approved = true
        ui.runOnUiThread {
            reopened.resumeMobileSignIn()
            reopened.resumeMobileSignIn(requestId)
        }
        ui.waitUntil(10_000) { reopened.state.value.user?.id == "hybrid-account" && !reopened.state.value.isLoading }
        assertEquals(1, consumeCalls.get())
        assertNull(runBlocking { pendingStore.load() })
        assertEquals("hybrid-account", runBlocking { sessionStore.loadSession() }?.user?.id)
    }

    @Test fun appLinkWaitingDuringColdRestoreResumesTheApprovedRequest() {
        openBrowserFromLogin()
        approved = true
        val reopened = newModel(returnRequest = requestId)

        ui.waitUntil(10_000) { reopened.state.value.user?.id == "hybrid-account" && !reopened.state.value.isLoading }
        assertEquals(1, statusCalls.get())
        assertEquals(1, consumeCalls.get())
        assertNull(runBlocking { pendingStore.load() })
    }

    @Test fun pausingCancelsStatusPollingAndForegroundResumeFindsApproval() {
        openBrowserFromLogin()
        val reopened = newModel()
        waitForRestore(reopened)
        holdStatus = true
        ui.runOnUiThread { reopened.resumeMobileSignIn() }
        ui.waitUntil(10_000) { statusCalls.get() == 1 }

        ui.runOnUiThread { reopened.pauseMobileSignIn() }
        ui.waitUntil(10_000) { statusCancelled.isCompleted }
        assertEquals(0, consumeCalls.get())
        assertNotNull(runBlocking { pendingStore.load() })

        holdStatus = false
        approved = true
        ui.runOnUiThread { reopened.resumeMobileSignIn() }
        ui.waitUntil(10_000) { reopened.state.value.user?.id == "hybrid-account" && !reopened.state.value.isLoading }
        assertEquals(2, statusCalls.get())
        assertEquals(1, consumeCalls.get())
    }

    @Test fun cancellingClearsTheLocalRequestAndDoesNotLeaveAnAccount() {
        openBrowserFromLogin()
        ui.onNodeWithText("Check sign-in").performClick()
        ui.waitUntil(10_000) { statusCalls.get() > 0 }
        assertEquals(0, consumeCalls.get())
        ui.onNodeWithText("Cancel").performClick()
        ui.waitUntil(10_000) { cancelCalls.get() == 1 }
        ui.onNodeWithText("Continue with Google").assertIsDisplayed()
        assertNull(runBlocking { pendingStore.load() })
        assertNull(runBlocking { sessionStore.loadSession() })
        assertEquals(0, consumeCalls.get())
    }

    @Test fun expiredPendingRequestIsDiscardedWithoutContactingTheWebsite() {
        val expiresAt = System.currentTimeMillis() - 1
        runBlocking {
            pendingStore.save(PendingMobileAuthorization(requestId, newMobileAuthorizationVerifier(), pairingCode, expiresAt))
        }
        val model = newModel()
        waitForRestore(model)
        ui.runOnUiThread { model.resumeMobileSignIn(requestId) }

        assertNull(model.state.value.pairingCode)
        assertTrue(model.state.value.error.orEmpty().contains("expired"))
        assertFalse(model.state.value.isLoading)
        assertNull(runBlocking { pendingStore.load() })
        assertEquals(0, statusCalls.get())
    }
}
