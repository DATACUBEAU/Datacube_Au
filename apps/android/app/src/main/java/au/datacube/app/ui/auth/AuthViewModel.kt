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
            _state.value = AuthState(isLoading = false, user = user, sessionRestored = true)
        }
    }

    fun signIn(email: String, password: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            when (val result = repository.signIn(email.trim(), password)) {
                is AuthRepository.AuthResult.Success -> {
                    val user = repository.currentUser()
                    _state.value = AuthState(isLoading = false, user = user, sessionRestored = true)
                }
                is AuthRepository.AuthResult.Error -> {
                    _state.value = _state.value.copy(isLoading = false, error = result.message)
                }
            }
        }
    }

    fun signUp(email: String, password: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            when (val result = repository.signUp(email.trim(), password)) {
                is AuthRepository.AuthResult.Success -> {
                    val user = repository.currentUser()
                    _state.value = AuthState(
                        isLoading = false,
                        user = user,
                        sessionRestored = true,
                        error = if (user == null) "Check your email to confirm your account." else null
                    )
                }
                is AuthRepository.AuthResult.Error -> {
                    _state.value = _state.value.copy(isLoading = false, error = result.message)
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

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }
}
