package au.datacube.app.auth

import android.util.Log
import kotlinx.coroutines.CancellationException
import au.datacube.app.BuildConfig
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.SignOutScope
import io.github.jan.supabase.auth.user.UserSession
import kotlinx.datetime.Clock
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Browser-approved device sessions and secure restoration backed by Supabase Auth. */
class AuthRepository(
    private val sessionStore: AuthSessionStore,
    authProvider: () -> Auth = { SupabaseClient.auth }
) {
    private val auth by lazy(authProvider)
    private val displayAccountMutex = Mutex()

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

    suspend fun signOut(): AuthResult {
        try {
            // Explicit account sign-out also revokes this user's web and other AU sessions when online.
            auth.signOut(SignOutScope.GLOBAL)
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
        try {
            displayAccountMutex.withLock { sessionStore.clearLocalSession() }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            return AuthResult.Error("The app could not securely clear its local session. Please try again.")
        }
        return AuthResult.Success
    }

    internal suspend fun completeMobileSignIn(session: UserSession, expectedUserId: String?): AuthResult {
        val user = session.user
        if (expectedUserId.isNullOrBlank() || user == null || user.id != expectedUserId ||
            session.accessToken.isBlank() || session.refreshToken.isBlank() ||
            !session.tokenType.equals("bearer", ignoreCase = true) ||
            session.expiresIn <= 0 || session.expiresAt <= Clock.System.now()
        ) {
            Log.w(TAG, "mobile_session_invalid")
            return AuthResult.Error("Sign-in couldn’t finish. Please try again.")
        }

        return try {
            auth.importSession(session, autoRefresh = true)
            syncDisplayAccount()
            Log.i(TAG, "mobile_session_ready")
            AuthResult.Success
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            Log.w(TAG, "mobile_session_import_failed")
            AuthResult.Error("Sign-in couldn’t finish. Please try again.")
        }
    }

    suspend fun restoreSession(): Boolean {
        return try {
            if (configurationError() != null) return false
            auth.awaitInitialization()
            auth.currentUserOrNull() != null
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            Log.w(TAG, "Session restore failed")
            false
        }
    }

    // Local access is based on the encrypted record written by the authenticated SDK.
    // Do not import an expired token or use this identity to authorize server requests.
    internal suspend fun savedLocalUser() = sessionStore.localUser()

    internal suspend fun restoreLocalUser(): io.github.jan.supabase.auth.user.UserInfo? {
        savedLocalUser()?.let { return it }
        return if (restoreSession()) currentUser() else savedLocalUser()
    }

    // These preferences are display metadata. The SDK has already persisted the
    // authenticated session in the Keystore-backed session manager.
    internal suspend fun syncDisplayAccount() {
        try {
            displayAccountMutex.withLock { sessionStore.persist(auth.currentUserOrNull() ?: sessionStore.localUser()) }
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
