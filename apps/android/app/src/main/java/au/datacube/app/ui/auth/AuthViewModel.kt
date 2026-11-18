package au.datacube.app.ui.auth

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import au.datacube.app.DataCubeApp
import au.datacube.app.auth.AuthRepository
import io.github.jan.supabase.auth.user.UserInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class AuthState(
    val isLoading: Boolean = false,
    val user: UserInfo? = null,
    val sessionRestored: Boolean = false,
    val error: String? = null
)

class AuthViewModel(app: Application) : AndroidViewModel(app) {
    private val repository: AuthRepository = (app as DataCubeApp).authRepository

    private val _state = MutableStateFlow(AuthState())
    val state: StateFlow<AuthState> = _state.asStateFlow()

    init {
        restoreSession()
    }

    private fun restoreSession() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true)
            val restored = repository.restoreSession()
            val user = if (restored) repository.currentUser() else null
            _state.value = AuthState(
                isLoading = false,
                user = user,
                sessionRestored = true
            )
        }
    }

    fun createWebsiteLoginUrl(mode: String): String? = try {
        _state.value = _state.value.copy(error = null)
        repository.createWebsiteLoginUrl(mode)
    } catch (error: Exception) {
        _state.value = _state.value.copy(
            error = error.message ?: "Could not open the DataCube AU sign-in page."
        )
        null
    }

    fun completeWebsiteAuthentication(code: String?, state: String?) {
        if (code.isNullOrBlank() || state.isNullOrBlank()) {
            _state.value = _state.value.copy(
                isLoading = false,
                sessionRestored = true,
                error = "The sign-in return link is invalid. Please sign in again."
            )
            return
        }

        viewModelScope.launch {
            // The initial Supabase SDK session restore and the incoming mobile
            // handoff must not mutate the same auth client concurrently.
            _state.first { it.sessionRestored }
            _state.value = _state.value.copy(isLoading = true, error = null)
            when (val result = repository.completeWebsiteAuthentication(code, state)) {
                is AuthRepository.AuthResult.Success -> {
                    val user = repository.currentUser()
                    _state.value = AuthState(
                        isLoading = false,
                        user = user,
                        sessionRestored = true,
                        error = if (user == null) "Your session could not be restored. Please sign in again." else null
                    )
                }
                is AuthRepository.AuthResult.Error -> {
                    _state.value = _state.value.copy(
                        isLoading = false,
                        sessionRestored = true,
                        error = result.message
                    )
                }
            }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true)
            repository.signOut()
            _state.value = AuthState(isLoading = false, user = null, sessionRestored = true)
        }
    }
}
