package au.datacube.app.ui.auth

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import au.datacube.app.DataCubeApp
import au.datacube.app.auth.AuthRepository
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.user.UserInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
            val configurationError = repository.configurationError()
            if (configurationError != null) {
                _state.value = AuthState(
                    isLoading = false,
                    user = null,
                    sessionRestored = true,
                    error = configurationError
                )
                return@launch
            }
            val restored = repository.restoreSession()
            val user = if (restored) repository.currentUser() else null
            _state.value = AuthState(
                isLoading = false,
                user = user,
                sessionRestored = true
            )
            repository.sessionStatus.collect { status ->
                when (status) {
                    is SessionStatus.Authenticated -> _state.value = _state.value.copy(user = status.session.user)
                    is SessionStatus.NotAuthenticated -> _state.value = _state.value.copy(user = null)
                    is SessionStatus.RefreshFailure -> _state.value = _state.value.copy(
                        user = null,
                        error = "Session refresh is unavailable. Reconnecting to Supabase."
                    )
                    SessionStatus.Initializing -> Unit
                }
            }
        }
    }

    fun signInWithGoogle(idToken: String, rawNonce: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            when (val result = repository.signInWithGoogle(idToken, rawNonce)) {
                is AuthRepository.AuthResult.Success -> {
                    val user = repository.currentUser()
                    _state.value = AuthState(
                        isLoading = false,
                        user = user,
                        sessionRestored = true,
                        error = if (user == null) "Your Google session could not be restored. Please try again." else null
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

    fun showError(message: String) {
        _state.value = _state.value.copy(isLoading = false, error = message)
    }

    fun signOut() {
        if (_state.value.isLoading) return
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true)
            val result = repository.signOut()
            _state.value = AuthState(
                user = repository.currentUser(),
                sessionRestored = true,
                error = (result as? AuthRepository.AuthResult.Error)?.message
            )
        }
    }
}
