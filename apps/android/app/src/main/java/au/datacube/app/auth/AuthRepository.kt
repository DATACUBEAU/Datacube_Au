package au.datacube.app.auth

import android.util.Log
import au.datacube.app.BuildConfig
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.exception.AuthRestException
import io.github.jan.supabase.auth.providers.Google
import io.github.jan.supabase.auth.providers.builtin.IDToken

/**
 * Native Android authentication backed by Supabase Auth.
 * Google credentials are acquired by Android Credential Manager in AuthScreen;
 * only the resulting ID token is exchanged with Supabase.
 */
class AuthRepository(
    private val sessionStore: AuthSessionStore
) {
    sealed class AuthResult {
        data object Success : AuthResult()
        data class Error(val message: String) : AuthResult()
    }

    fun configurationError(): String? {
        if (!BuildConfig.SUPABASE_URL.startsWith("https://") || BuildConfig.SUPABASE_ANON_KEY.isBlank()) {
            return "This app build is missing its Supabase connection settings. Install a correctly configured DataCube AU APK."
        }
        return null
    }

    suspend fun currentUser() = runCatching {
        SupabaseClient.auth.currentUserOrNull()
    }.getOrNull()

    suspend fun signInWithGoogle(idToken: String, rawNonce: String): AuthResult {
        if (!BuildConfig.SUPABASE_URL.startsWith("https://") || BuildConfig.SUPABASE_ANON_KEY.isBlank()) {
            return AuthResult.Error("This app build is missing its Supabase connection settings.")
        }
        if (BuildConfig.GOOGLE_WEB_CLIENT_ID.isBlank()) {
            return AuthResult.Error("Native Google sign-in is not configured. Add GOOGLE_WEB_CLIENT_ID to the Android build configuration.")
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
        AuthResult.Success
    } catch (e: Exception) {
        Log.e(TAG, "Sign-out error", e)
        val localClearError = runCatching {
            SupabaseClient.auth.clearSession()
            sessionStore.clear()
        }.exceptionOrNull()
        if (localClearError == null) {
            AuthResult.Success
        } else {
            AuthResult.Error("The app could not securely clear its local session. Please try again.")
        }
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

    private companion object {
        const val TAG = "DataCubeAuth"
    }
}
