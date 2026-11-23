package au.datacube.app.auth

import android.util.Log
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.exceptions.ClearCredentialException
import kotlinx.coroutines.CancellationException
import au.datacube.app.BuildConfig
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.user.UserInfo
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.auth.providers.Google
import io.github.jan.supabase.auth.providers.builtin.IDToken

/**
 * Native Android authentication backed by Supabase Auth.
 * Google credentials are acquired by Android Credential Manager in AuthScreen;
 * only the resulting ID token is exchanged with Supabase.
 */
class AuthRepository(
    private val sessionStore: AuthSessionStore,
    private val resetGoogleAccount: suspend () -> Unit,
    authProvider: () -> Auth = { SupabaseClient.auth }
) {
    private val auth by lazy(authProvider)

    constructor(store: AuthSessionStore, manager: CredentialManager) :
        this(store, { manager.clearCredentialState(ClearCredentialStateRequest()) })

    sealed class AuthResult {
        data object Success : AuthResult()
        data class Error(val message: String) : AuthResult()
    }

    fun configurationError(): String? {
        if (!BuildConfig.SUPABASE_URL.startsWith("https://") || BuildConfig.SUPABASE_ANON_KEY.isBlank()) {
            return "This copy of DataCube AU is missing its sign-in settings."
        }
        return null
    }

    val sessionStatus get() = auth.sessionStatus

    fun currentUser() = runCatching {
        auth.currentUserOrNull()
    }.getOrNull()

    suspend fun signInWithGoogle(idToken: String, rawNonce: String): AuthResult {
        configurationError()?.let { return AuthResult.Error(it) }
        if (idToken.isBlank() || rawNonce.isBlank()) return AuthResult.Error("Google didn't finish verifying the account. Please try again.")

        return try {
            Log.i(TAG, "exchange_started")
            auth.signInWith(IDToken) {
                this.idToken = idToken
                provider = Google
                nonce = rawNonce
            }
            val user = auth.currentUserOrNull()
                ?: run {
                    Log.w(TAG, "session_missing")
                    auth.clearSession()
                    return AuthResult.Error("Your account was selected, but sign-in didn’t finish. Please try again.")
                }
            saveDisplayAccount(user)
            Log.i(TAG, "session_ready")
            AuthResult.Success
        } catch (error: RestException) {
            Log.w(TAG, "exchange_rejected status=${error.statusCode}")
            val feedback = when (error.statusCode) {
                429 -> "Too many sign-in attempts. Wait a moment and try again."
                in 500..599 -> "DataCube AU couldn’t complete sign-in right now. Please try again shortly."
                else -> "DataCube AU couldn’t verify this Google sign-in. Try again or contact support if it continues."
            }
            AuthResult.Error(feedback)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            Log.w(TAG, "exchange_failed")
            AuthResult.Error("Sign-in couldn’t finish. Check your connection and try again.")
        }
    }

    suspend fun signOut(): AuthResult {
        try {
            auth.signOut()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            try {
                auth.clearSession()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                return AuthResult.Error("The app could not securely clear its local session. Please try again.")
            }
        }
        return try {
            saveDisplayAccount(null)
            resetGoogleAccount()
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
            auth.awaitInitialization()
            val user = auth.currentUserOrNull()
            if (user != null) {
                saveDisplayAccount(user)
                true
            } else {
                saveDisplayAccount(null)
                false
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            Log.w(TAG, "Session restore failed")
            false
        }
    }

    // These preferences are display metadata. The SDK has already persisted the
    // authenticated session in the Keystore-backed session manager.
    private suspend fun saveDisplayAccount(user: UserInfo?) {
        try {
            sessionStore.persist(user)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            Log.w(TAG, "display_account_write_failed")
        }
    }

    private companion object {
        const val TAG = "DataCubeAuth"
    }
}
