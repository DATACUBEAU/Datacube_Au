package au.datacube.app.auth

import android.util.Log
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.exception.AuthRestException
import io.github.jan.supabase.auth.providers.builtin.Email

/**
 * Authentication operations backed by the Supabase Auth SDK.
 *
 * All token handling is delegated to the SDK. This repository never reads,
 * stores or returns raw tokens — only user metadata and typed results.
 */
class AuthRepository(private val sessionStore: AuthSessionStore) {

    sealed class AuthResult {
        data object Success : AuthResult()
        data class Error(val message: String) : AuthResult()
    }

    /** Returns the currently authenticated user, or null if not signed in. */
    suspend fun currentUser() = runCatching {
        SupabaseClient.auth.currentUserOrNull()
    }.getOrNull()

    /** Sign in with email + password. Persists identity metadata on success. */
    suspend fun signIn(email: String, password: String): AuthResult = try {
        SupabaseClient.auth.signInWith(Email) {
            this.email = email
            this.password = password
        }
        sessionStore.persist(SupabaseClient.auth.currentUserOrNull())
        AuthResult.Success
    } catch (e: AuthRestException) {
        Log.w(TAG, "Sign-in failed: ${e.message}")
        AuthResult.Error(friendlyAuthError(e.message))
    } catch (e: Exception) {
        Log.e(TAG, "Sign-in error", e)
        AuthResult.Error("Could not reach the server. Check your connection.")
    }

    /** Register a new account. */
    suspend fun signUp(email: String, password: String): AuthResult = try {
        SupabaseClient.auth.signUpWith(Email) {
            this.email = email
            this.password = password
        }
        sessionStore.persist(SupabaseClient.auth.currentUserOrNull())
        AuthResult.Success
    } catch (e: AuthRestException) {
        Log.w(TAG, "Sign-up failed: ${e.message}")
        AuthResult.Error(friendlyAuthError(e.message))
    } catch (e: Exception) {
        Log.e(TAG, "Sign-up error", e)
        AuthResult.Error("Could not reach the server. Check your connection.")
    }

    /** Sign out and clear local session metadata. */
    suspend fun signOut(): AuthResult = try {
        SupabaseClient.auth.signOut()
        sessionStore.clear()
        AuthResult.Success
    } catch (e: Exception) {
        Log.e(TAG, "Sign-out error", e)
        // Clear local state regardless — the token is likely already expired.
        sessionStore.clear()
        AuthResult.Success
    }

    /** Attempt to restore a persisted session on cold start. */
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

    private fun friendlyAuthError(raw: String?): String = when {
        raw == null -> "Authentication failed. Please try again."
        raw.contains("invalid_credentials", ignoreCase = true) ||
            raw.contains("Invalid login credentials", ignoreCase = true) ->
            "Incorrect email or password."
        raw.contains("email_not_confirmed", ignoreCase = true) ->
            "Please confirm your email address before signing in."
        raw.contains("user_already_exists", ignoreCase = true) ->
            "An account with this email already exists."
        raw.contains("weak_password", ignoreCase = true) ->
            "Password is too weak. Use at least 8 characters."
        else -> "Authentication failed. Please try again."
    }
}
