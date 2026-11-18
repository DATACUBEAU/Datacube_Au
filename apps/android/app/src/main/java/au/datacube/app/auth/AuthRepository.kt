package au.datacube.app.auth

import android.net.Uri
import android.util.Base64
import au.datacube.app.BuildConfig
import io.github.jan.supabase.auth.auth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom

private const val TAG = "AuthRepository"

/**
 * Supabase remains the identity provider, but users authenticate on the existing
 * Next.js website. Android exchanges a short-lived, PKCE-bound handoff for the
 * same account's Supabase session.
 */
class AuthRepository(
    private val sessionStore: AuthSessionStore,
    private val pendingAuthStore: PendingMobileAuthStore
) {
    sealed class AuthResult {
        data object Success : AuthResult()
        data class Error(val message: String) : AuthResult()
    }

    suspend fun currentUser() = runCatching {
        SupabaseClient.auth.currentUserOrNull()
    }.getOrNull()

    fun createWebsiteLoginUrl(mode: String): String {
        require(mode == "login" || mode == "signup") { "Invalid authentication mode." }

        val state = randomBase64Url(32)
        val verifier = randomBase64Url(32)
        val challenge = base64Url(
            MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
        )
        pendingAuthStore.save(state, verifier)

        val redirectTo = Uri.Builder()
            .path("/mobile-auth/complete")
            .appendQueryParameter("state", state)
            .appendQueryParameter("code_challenge", challenge)
            .build()
            .toString()

        val website = BuildConfig.AUTH_WEBSITE_URL.trimEnd('/')
        val websiteUri = Uri.parse(website)
        require(websiteUri.scheme == "https" && !websiteUri.host.isNullOrBlank()) {
            "The configured DataCube AU website URL must use HTTPS."
        }

        return Uri.parse("$website/login")
            .buildUpon()
            .appendQueryParameter("mode", mode)
            .appendQueryParameter("redirectTo", redirectTo)
            .build()
            .toString()
    }

    suspend fun completeWebsiteAuthentication(code: String, state: String): AuthResult = try {
        if (code.length !in 40..64 || state.length !in 40..64) {
            throw IllegalArgumentException("The sign-in return link is incomplete.")
        }
        val pending = pendingAuthStore.load(state)
            ?: throw IllegalStateException("The sign-in request expired. Please start again.")

        val exchange = postJson(
            "/api/auth/mobile-handoff",
            JSONObject()
                .put("action", "exchange")
                .put("code", code)
                .put("state", state)
                .put("codeVerifier", pending.verifier)
        )
        val refreshToken = exchange.getString("refreshToken")
        val expectedUserId = exchange.getString("userId")

        // The SDK redeems the one-time refresh token and persists the resulting
        // session using its own session manager.
        val session = SupabaseClient.auth.refreshSession(refreshToken)
        val actualUserId = session.user?.id
        if (actualUserId.isNullOrBlank() || actualUserId != expectedUserId) {
            runCatching { SupabaseClient.auth.signOut() }
            throw IllegalStateException("The authenticated account could not be verified.")
        }

        // refreshSession() retrieves and rotates the refresh token; importSession()
        // explicitly makes the returned session the SDK's persisted local session.
        SupabaseClient.auth.importSession(session)
        sessionStore.persist(session.user)
        pendingAuthStore.clear()
        AuthResult.Success
    } catch (error: Exception) {
        AuthResult.Error(
            error.message?.takeIf { it.isNotBlank() }
                ?: "Authentication could not be completed. Please try again."
        )
    }

    suspend fun signOut(): AuthResult = try {
        SupabaseClient.auth.signOut()
        sessionStore.clear()
        pendingAuthStore.clear()
        AuthResult.Success
    } catch (_: Exception) {
        sessionStore.clear()
        pendingAuthStore.clear()
        AuthResult.Success
    }

    suspend fun restoreSession(): Boolean = try {
        SupabaseClient.auth.awaitInitialization()
        val user = SupabaseClient.auth.currentUserOrNull()
        if (user != null) {
            sessionStore.persist(user)
            true
        } else {
            sessionStore.clear()
            false
        }
    } catch (_: Exception) {
        false
    }

    private suspend fun postJson(path: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val base = BuildConfig.AUTH_WEBSITE_URL.trimEnd('/')
        val connection = (URL("$base$path").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 20_000
            doOutput = true
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Cache-Control", "no-store")
            instanceFollowRedirects = false
        }

        try {
            connection.outputStream.use { output ->
                output.write(body.toString().toByteArray(Charsets.UTF_8))
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val response = if (responseText.isBlank()) JSONObject() else JSONObject(responseText)
            if (status !in 200..299 || response.optBoolean("ok") != true) {
                throw IllegalStateException(
                    response.optString("message").ifBlank {
                        "Secure sign-in could not be completed. Please start again."
                    }
                )
            }
            response
        } finally {
            connection.disconnect()
        }
    }

    private fun randomBase64Url(byteCount: Int): String {
        val bytes = ByteArray(byteCount)
        SecureRandom().nextBytes(bytes)
        return base64Url(bytes)
    }

    private fun base64Url(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
}
