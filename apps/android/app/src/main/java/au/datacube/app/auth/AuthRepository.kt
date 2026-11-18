package au.datacube.app.auth

import android.net.Uri
import android.util.Base64
import android.util.Log
import au.datacube.app.BuildConfig
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.exception.AuthRestException
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.request.post
import io.ktor.client.request.header
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Native authentication is handed off to the existing DataCube AU website.
 * The website issues a short-lived one-time code; this repository exchanges
 * it using the PKCE verifier kept in Android Keystore-protected storage.
 */
class AuthRepository(
    private val sessionStore: AuthSessionStore,
    private val pendingAuthStore: PendingMobileAuthStore
) {
    sealed class AuthResult {
        data object Success : AuthResult()
        data class Error(val message: String) : AuthResult()
    }

    private val httpClient = HttpClient(Android)
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun currentUser() = runCatching {
        SupabaseClient.auth.currentUserOrNull()
    }.getOrNull()

    fun createWebsiteLoginUrl(mode: String): String {
        require(mode == "login" || mode == "signup") { "Unsupported authentication mode." }
        val state = randomUrlSafe(32)
        val verifier = randomUrlSafe(32)
        val challenge = Base64.encodeToString(
            MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)),
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )
        pendingAuthStore.save(state, verifier)

        val redirect = Uri.parse(BuildConfig.AUTH_WEBSITE_URL)
            .buildUpon()
            .appendPath("mobile-auth")
            .appendPath("complete")
            .appendQueryParameter("state", state)
            .appendQueryParameter("code_challenge", challenge)
            .build()
            .toString()

        return Uri.parse(BuildConfig.AUTH_WEBSITE_URL)
            .buildUpon()
            .appendPath("login")
            .appendQueryParameter("mode", mode)
            .appendQueryParameter("redirectTo", redirect)
            .build()
            .toString()
    }

    suspend fun completeWebsiteAuthentication(code: String, state: String): AuthResult {
        return try {
            val pending = pendingAuthStore.load(state)
                ?: return AuthResult.Error("This sign-in request expired. Please sign in again.")

            val response = httpClient.post("${BuildConfig.AUTH_WEBSITE_URL.trimEnd('/')}/api/auth/mobile-handoff") {
                contentType(ContentType.Application.Json)
                header("Accept", "application/json")
                setBody(
                    """{"action":"exchange","code":"${jsonEscape(code)}","state":"${jsonEscape(state)}","codeVerifier":"${jsonEscape(pending.verifier)}"}"""
                )
            }
            val payload = json.parseToJsonElement(response.bodyAsText()).jsonObject
            if (payload["ok"]?.jsonPrimitive?.content != "true") {
                val message = payload["message"]?.jsonPrimitive?.content
                    ?: "The sign-in link expired or was already used. Please sign in again."
                pendingAuthStore.clear()
                return AuthResult.Error(message)
            }

            val refreshToken = payload["refreshToken"]?.jsonPrimitive?.content
            val expectedUserId = payload["userId"]?.jsonPrimitive?.content
            if (refreshToken.isNullOrBlank() || expectedUserId.isNullOrBlank()) {
                pendingAuthStore.clear()
                return AuthResult.Error("The secure app session was incomplete. Please sign in again.")
            }

            // Supabase SDK performs the refresh-token exchange and persists the
            // resulting native session using its configured session manager.
            SupabaseClient.auth.refreshSession(refreshToken = refreshToken)
            val user = SupabaseClient.auth.currentUserOrNull()
            if (user?.id != expectedUserId) {
                SupabaseClient.auth.signOut()
                pendingAuthStore.clear()
                return AuthResult.Error("The returned account could not be verified. Please sign in again.")
            }

            sessionStore.persist(user)
            pendingAuthStore.clear()
            AuthResult.Success
        } catch (e: AuthRestException) {
            pendingAuthStore.clear()
            Log.w(TAG, "Website handoff exchange failed: ${e.message}")
            AuthResult.Error("The sign-in link expired or could not be verified. Please sign in again.")
        } catch (e: Exception) {
            pendingAuthStore.clear()
            Log.e(TAG, "Website authentication handoff failed", e)
            AuthResult.Error("Could not complete sign-in. Check your connection and try again.")
        }
    }

    suspend fun signOut(): AuthResult = try {
        SupabaseClient.auth.signOut()
        sessionStore.clear()
        pendingAuthStore.clear()
        AuthResult.Success
    } catch (e: Exception) {
        Log.e(TAG, "Sign-out error", e)
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
    } catch (e: Exception) {
        Log.w(TAG, "Session restore failed", e)
        false
    }

    private fun randomUrlSafe(bytes: Int): String {
        val value = ByteArray(bytes)
        SecureRandom().nextBytes(value)
        return Base64.encodeToString(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }

    private fun jsonEscape(value: String): String = buildString {
        value.forEach { char ->
            when (char) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (char.code < 0x20) append("\\u%04x".format(char.code)) else append(char)
            }
        }
    }

    private companion object {
        const val TAG = "DataCubeAuth"
    }
}
