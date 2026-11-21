package au.datacube.app.auth

import android.util.Log
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.exceptions.ClearCredentialException
import kotlinx.coroutines.CancellationException
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
    private val sessionStore: AuthSessionStore,
    private val credentialManager: CredentialManager
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

    val sessionStatus get() = SupabaseClient.auth.sessionStatus

    fun currentUser() = runCatching {
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
        } catch (_: AuthRestException) {
            AuthResult.Error("Supabase rejected the Google sign-in. Check the provider configuration and try again.")
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            AuthResult.Error("Could not complete Google sign-in. Check your connection and retry.")
        }
    }

    suspend fun signOut(): AuthResult {
        try {
            SupabaseClient.auth.signOut()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            try {
                SupabaseClient.auth.clearSession()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                return AuthResult.Error("The app could not securely clear its local session. Please try again.")
            }
        }
        return try {
            sessionStore.clear()
            credentialManager.clearCredentialState(ClearCredentialStateRequest())
            AuthResult.Success
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: ClearCredentialException) {
            AuthResult.Error("Signed out of DataCube AU. Google could not reset its account selection.")
        } catch (_: Exception) {
            AuthResult.Error("Signed out of DataCube AU. Local account preferences could not be cleared.")
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
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            Log.w(TAG, "Session restore failed")
            false
        }
    }

    private companion object {
        const val TAG = "DataCubeAuth"
    }
}
