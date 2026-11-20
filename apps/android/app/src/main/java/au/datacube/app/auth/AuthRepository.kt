package au.datacube.app.auth

import android.net.Uri
import android.util.Base64
import android.util.Log
import au.datacube.app.BuildConfig
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.Google
import io.github.jan.supabase.auth.providers.IDToken
import io.github.jan.supabase.auth.exception.AuthRestException
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.request.post
import io.ktor.client.request.header
import io.ktor.client.request.setBody
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.security.MessageDigest
import java.security.SecureRandom
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout

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

    private val httpClient = HttpClient(Android) {
        expectSuccess = false
        install(HttpTimeout) {
            connectTimeoutMillis = 10_000
            requestTimeoutMillis = 25_000
            socketTimeoutMillis = 25_000
        }
    }

    fun configurationError(): String? {
        if (!BuildConfig.SUPABASE_URL.startsWith("https://") || BuildConfig.SUPABASE_ANON_KEY.isBlank()) {
            return "This app build is missing its Supabase connection settings. Install a correctly configured DataCube AU APK."
        }
        return null
    }
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
        configurationError()?.let { throw IllegalStateException(it) }
        pendingAuthStore.clear()
        pendingAuthStore.save(state, verifier)

        // redirectTo is a local website path. The login page accepts this
        // directly and safely normalizes same-origin absolute URLs from older APKs.
        val redirect = Uri.parse("/mobile-auth/complete")
            .buildUpon()
            .appendQueryParameter("state", state)
            .appendQueryParameter("code_challenge", challenge)
            .build()
            .toString()

        return Uri.parse(BuildConfig.AUTH_WEBSITE_URL)
            .buildUpon()
            .appendPath("login")
            .appendQueryParameter("mode", mode)
            .appendQueryParameter("redirectTo", redirect)
            .appendQueryParameter("forceReauth", "1")
            .build()
            .toString()
    }

    suspend fun completeWebsiteAuthentication(code: String, state: String): AuthResult {
        configurationError()?.let { return AuthResult.Error(it) }
        return try {
            withTimeout(HANDOFF_TIMEOUT_MS) {
                val pending = pendingAuthStore.load(state)
                    ?: return@withTimeout AuthResult.Error("This sign-in request expired. Start Google sign-in again.")

                val response = httpClient.post("${BuildConfig.AUTH_WEBSITE_URL.trimEnd('/')}/api/auth/mobile-handoff") {
                    contentType(ContentType.Application.Json)
                    header("Accept", "application/json")
                    setBody(
                        """{"action":"exchange","code":"${jsonEscape(code)}","state":"${jsonEscape(state)}","codeVerifier":"${jsonEscape(pending.verifier)}"}"""
                    )
                }

                val responseBody = response.bodyAsText()
                val payload = runCatching { json.parseToJsonElement(responseBody).jsonObject }.getOrNull()
                if (response.status.value !in 200..299) {
                    pendingAuthStore.clear()
                    val serverMessage = payload?.get("message")?.jsonPrimitive?.content
                    return@withTimeout AuthResult.Error(
                        serverMessage ?: "The authentication server returned HTTP ${response.status.value}. Please retry."
                    )
                }

                if (payload == null) {
                    pendingAuthStore.clear()
                    return@withTimeout AuthResult.Error("The authentication server returned an unreadable response. Please retry.")
                }

                if (payload["ok"]?.jsonPrimitive?.content != "true") {
                    val message = payload["message"]?.jsonPrimitive?.content
                        ?: "The server response was not a valid app-session confirmation."
                    pendingAuthStore.clear()
                    return@withTimeout AuthResult.Error(message)
                }

                val refreshToken = payload["refreshToken"]?.jsonPrimitive?.content
                val expectedUserId = payload["userId"]?.jsonPrimitive?.content
                if (refreshToken.isNullOrBlank() || expectedUserId.isNullOrBlank()) {
                    pendingAuthStore.clear()
                    return@withTimeout AuthResult.Error("The server did not return a complete native session.")
                }

                // Exchange the one-time server token with Supabase and verify that
                // the resulting native identity is the same account authenticated in Chrome.
                SupabaseClient.auth.refreshSession(refreshToken = refreshToken)
                val user = SupabaseClient.auth.currentUserOrNull()
                if (user?.id != expectedUserId) {
                    SupabaseClient.auth.signOut()
                    pendingAuthStore.clear()
                    return@withTimeout AuthResult.Error("Supabase created a session, but the account identity did not match.")
                }

                sessionStore.persist(user)
                pendingAuthStore.clear()
                AuthResult.Success
            }
        } catch (e: TimeoutCancellationException) {
            pendingAuthStore.clear()
            Log.w(TAG, "Mobile handoff timed out")
            AuthResult.Error("The secure sign-in took too long. Check your connection and retry.")
        } catch (e: AuthRestException) {
            pendingAuthStore.clear()
            Log.w(TAG, "Supabase rejected the native session: ${e.message}")
            AuthResult.Error("Supabase rejected the app session: ${e.message ?: "authentication error"}. Please sign in again.")
        } catch (e: Exception) {
            pendingAuthStore.clear()
            Log.e(TAG, "Website authentication handoff failed", e)
            val detail = e.message?.take(180)?.takeIf { it.isNotBlank() }
            AuthResult.Error(
                if (detail != null) "Secure app sign-in failed: $detail"
                else "The app could not reach Supabase (${e.javaClass.simpleName}). Check its connection settings and retry."
            )
        }
    }


    /**
     * Completes native Google authentication using the ID token obtained from
     * Android Credential Manager. No browser callback or website handoff is used.
     */
    suspend fun signInWithGoogle(idToken: String, rawNonce: String): AuthResult {
        configurationError()?.let { return AuthResult.Error(it) }
        if (BuildConfig.GOOGLE_WEB_CLIENT_ID.isBlank()) {
            return AuthResult.Error(
                "Native Google sign-in is not configured. Add GOOGLE_WEB_CLIENT_ID (the Google Web OAuth client ID) to the Android build configuration."
            )
        }
        if (idToken.isBlank() || rawNonce.isBlank()) {
            return AuthResult.Error("Google did not return a valid identity token. Please try again.")
        }
        return try {
            SupabaseClient.auth.signInWith(IDToken) {
                this.idToken = idToken
                provider = Google
                nonce = rawNonce
            }
            val user = SupabaseClient.auth.currentUserOrNull()
                ?: return AuthResult.Error("Supabase did not return an authenticated user. Please try again.")
            sessionStore.persist(user)
            AuthResult.Success
        } catch (e: AuthRestException) {
            Log.w(TAG, "Supabase rejected Google ID token: ${e.message}")
            AuthResult.Error("Google sign-in was rejected: ${e.message ?: "authentication error"}. Check the Google provider configuration.")
        } catch (e: Exception) {
            Log.e(TAG, "Native Google authentication failed", e)
            AuthResult.Error(e.message?.take(180)?.takeIf { it.isNotBlank() }
                ?: "Could not complete native Google sign-in. Check your connection and retry.")
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

    suspend fun restoreSession(): Boolean {
        return try {
            if (configurationError() != null) return false
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
        const val HANDOFF_TIMEOUT_MS = 25_000L
    }
}
