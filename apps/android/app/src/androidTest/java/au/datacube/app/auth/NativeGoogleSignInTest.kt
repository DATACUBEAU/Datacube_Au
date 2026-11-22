package au.datacube.app.auth

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.AdaptiveIconDrawable
import android.os.ParcelFileDescriptor
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollToNode
import androidx.credentials.Credential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import au.datacube.app.BuildConfig
import au.datacube.app.DataCubeApp
import au.datacube.app.DataCubeRoot
import au.datacube.app.ui.DataCubeViewModel
import au.datacube.app.ui.auth.AuthViewModel
import au.datacube.app.ui.theme.DataCubeTheme
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.createSupabaseClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class NativeGoogleSignInTest {
    @get:Rule val ui = createComposeRule()
    private val app get() = ApplicationProvider.getApplicationContext<DataCubeApp>()
    private val storage get() = EncryptedSupabaseSessionManager(app)
    private val clients = mutableListOf<io.github.jan.supabase.SupabaseClient>()
    @Volatile private var exchanged = 0
    @Volatile private var logoutCalls = 0
    @Volatile private var googleCleared = false
    @Volatile private var hashedNonce = ""
    private val token = "controlled-google-response"

    @Before fun clean() { runBlocking { storage.deleteSession() } }
    @After fun finish() { runBlocking { clients.forEach { it.close() }; storage.deleteSession() } }

    private fun repository(reject: Boolean = false, includeUser: Boolean = true): AuthRepository {
        val engine = MockEngine { request ->
            val headers = headersOf(HttpHeaders.ContentType, "application/json")
            when (request.url.encodedPath) {
                "/auth/v1/token" -> {
                    assertEquals("id_token", request.url.parameters["grant_type"])
                    val body = Json.parseToJsonElement(request.body.toByteArray().decodeToString()).jsonObject
                    assertEquals("google", body.getValue("provider").jsonPrimitive.content)
                    assertEquals(token, body.getValue("id_token").jsonPrimitive.content)
                    val raw = body.getValue("nonce").jsonPrimitive.content
                    assertTrue(raw.isNotBlank())
                    val expected = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray()).joinToString("") { "%02x".format(it) }
                    assertEquals(expected, hashedNonce)
                    exchanged++
                    if (reject) respond("""{"code":400,"error_code":"validation_failed","msg":"controlled rejection"}""", HttpStatusCode.BadRequest, headers)
                    else {
                        val account = if (includeUser) ""","user":{"aud":"authenticated","id":"test-account"}""" else ""
                        respond("""{"access_token":"fixture-access","refresh_token":"fixture-refresh","expires_in":7200,"token_type":"bearer"$account}""", headers = headers)
                    }
                }
                "/auth/v1/logout" -> {
                    logoutCalls++
                    respond("{}", headers = headers)
                }
                else -> error("Unexpected fixture endpoint")
            }
        }
        val client = createSupabaseClient("https://fixture.invalid", "fixture-public") {
            httpEngine = engine
            install(Auth) { sessionManager = storage; alwaysAutoRefresh = false }
        }
        clients.add(client)
        return AuthRepository(AuthSessionStore(app), { googleCleared = true }) { client.auth }
    }

    private fun credential(request: GetCredentialRequest): Credential {
        val option = request.credentialOptions.single() as GetSignInWithGoogleOption
        assertEquals(BuildConfig.GOOGLE_WEB_CLIENT_ID, option.serverClientId)
        hashedNonce = requireNotNull(option.nonce)
        return GoogleIdTokenCredential.Builder().setId("fixture").setIdToken(token).build()
    }

    private fun mount(repo: AuthRepository, picker: suspend (GetCredentialRequest) -> Credential): AuthViewModel {
        val model = ui.runOnUiThread { AuthViewModel(app, repo) }
        val documents = ui.runOnUiThread { DataCubeViewModel(app) }
        ui.setContent { DataCubeTheme { DataCubeRoot(model, documents, picker) } }
        ui.waitUntil(10_000) { model.state.value.sessionRestored }
        return model
    }

    private fun waitForText(text: String, substring: Boolean = false) {
        ui.waitUntil(10_000) { ui.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test fun pickerExchangeHomeRestorationAndLogout() {
        mount(repository(), ::credential)
        val button = ui.onNodeWithText("Continue with Google")
        button.assertIsDisplayed()
        saveImage("login", ui.onRoot().captureToImage().asAndroidBitmap())
        button.performClick()
        waitForText("Active Documents")
        assertEquals(1, exchanged)
        saveImage("home", ui.onRoot().captureToImage().asAndroidBitmap())
        // A fresh SDK client and view model read the encrypted session without a second request.
        val reopened = ui.runOnUiThread { AuthViewModel(app, repository()) }
        ui.waitUntil(10_000) { reopened.state.value.sessionRestored }
        assertEquals("test-account", reopened.state.value.user?.id)
        ui.onNodeWithText("Profile").performClick()
        ui.onNode(hasScrollAction()).performScrollToNode(hasText("Sign out"))
        ui.onNodeWithText("Sign out").performClick()
        waitForText("Continue with Google")
        ui.waitUntil(10_000) { googleCleared }
        assertEquals(1, logoutCalls)
        assertNull(runBlocking { storage.loadSession() })
        val signedOut = ui.runOnUiThread { AuthViewModel(app, repository()) }
        ui.waitUntil(10_000) { signedOut.state.value.sessionRestored }
        assertNull(signedOut.state.value.user)
    }

    @Test fun providerCancellationIsVisibleAndRetryReachesHome() {
        var attempts = 0
        mount(repository()) { request ->
            if (++attempts == 1) throw GetCredentialCancellationException()
            credential(request)
        }
        ui.onNodeWithText("Continue with Google").performClick()
        waitForText("Couldn’t sign you in", substring = true)
        assertEquals(0, exchanged)
        ui.onNodeWithText("Continue with Google").performClick()
        waitForText("Active Documents")
        assertEquals(1, exchanged)
    }

    @Test fun interruptedPickerAfterProcessRecreationShowsRetry() {
        val pending = androidx.lifecycle.SavedStateHandle(mapOf("googleSignInPending" to true))
        val model = ui.runOnUiThread { AuthViewModel(app, repository(), pending) }
        ui.waitUntil(10_000) { model.state.value.sessionRestored }
        assertNull(model.state.value.user)
        assertNotNull(model.state.value.error)
        assertFalse(model.state.value.isLoading)
        assertEquals(0, exchanged)
    }

    @Test fun unexpectedCredentialShowsErrorWithoutExchange() {
        mount(repository()) { androidx.credentials.CustomCredential("fixture.unexpected", android.os.Bundle()) }
        ui.onNodeWithText("Continue with Google").performClick()
        waitForText("unexpected response", substring = true)
        assertEquals(0, exchanged)
    }

    @Test fun incompleteExchangeCannotLeaveAnInvisibleSession() {
        mount(repository(includeUser = false), ::credential)
        ui.onNodeWithText("Continue with Google").performClick()
        waitForText("Your account was selected", substring = true)
        assertEquals(1, exchanged)
        assertNull(runBlocking { storage.loadSession() })
    }

    @Test fun rejectedExchangeShowsFeedbackAndKeepsLogin() {
        mount(repository(reject = true), ::credential)
        ui.onNodeWithText("Continue with Google").performClick()
        waitForText("couldn’t verify", substring = true)
        ui.onNodeWithText("Continue with Google").assertIsDisplayed()
        assertEquals(1, exchanged)
        assertNull(runBlocking { storage.loadSession() })
    }

    @Test fun launcherUsesSystemMaskAndPreservesOriginalWhiteArtwork() {
        val icon = app.packageManager.getApplicationIcon(app.packageName)
        assertTrue(icon is AdaptiveIconDrawable)
        val bitmap = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888)
        icon.setBounds(0, 0, 256, 256)
        icon.draw(Canvas(bitmap))
        val whitePixels = (0 until 256).sumOf { y ->
            (0 until 256).count { x ->
                val p = bitmap.getPixel(x, y)
                android.graphics.Color.red(p) > 220 && android.graphics.Color.green(p) > 220 && android.graphics.Color.alpha(p) > 220
            }
        }
        assertTrue(whitePixels > 800)
        saveImage("launcher", bitmap)
    }

    private fun saveImage(name: String, bitmap: Bitmap) {
        val bytes = ByteArrayOutputStream().use { stream ->
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream))
            stream.toByteArray()
        }
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val shell = instrumentation.uiAutomation
        val devicePath = "/data/local/tmp/datacube-$name.png"
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            val pipes = shell.executeShellCommandRw("dd of=$devicePath")
            ParcelFileDescriptor.AutoCloseOutputStream(pipes[1]).use { it.write(bytes) }
            ParcelFileDescriptor.AutoCloseInputStream(pipes[0]).use { it.readBytes() }
        } else {
            val file = File(app.externalMediaDirs.first(), "datacube-$name.png")
            file.writeBytes(bytes)
            val result = shell.executeShellCommand("cp ${file.absolutePath} $devicePath")
            ParcelFileDescriptor.AutoCloseInputStream(result).use { it.readBytes() }
        }
        val stat = shell.executeShellCommand("stat -c %s $devicePath")
        val count = ParcelFileDescriptor.AutoCloseInputStream(stat).bufferedReader().use { it.readText().trim() }
        assertEquals(bytes.size.toString(), count)
    }
}
