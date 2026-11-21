package au.datacube.app.ui.auth

import android.app.Application
import android.util.Log
import androidx.credentials.Credential
import androidx.credentials.GetCredentialRequest
import au.datacube.app.auth.PickerFailure
import au.datacube.app.auth.chooseGoogleAccount
import kotlinx.coroutines.CancellationException
import androidx.lifecycle.SavedStateHandle
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

class AuthViewModel(
    app: Application,
    private val repository: AuthRepository,
    private val savedState: SavedStateHandle = SavedStateHandle()
) : AndroidViewModel(app) {
    constructor(app: Application, savedState: SavedStateHandle) : this(app, (app as DataCubeApp).authRepository, savedState)

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
            val interrupted = savedState.remove<Boolean>("googleSignInPending") == true && user == null
            _state.value = AuthState(
                isLoading = false,
                user = user,
                sessionRestored = true,
                error = if (interrupted) "Sign-in was interrupted. Please try again." else null
            )
            repository.sessionStatus.collect { status ->
                when (status) {
                    is SessionStatus.Authenticated -> _state.value = _state.value.copy(user = status.session.user)
                    is SessionStatus.NotAuthenticated -> _state.value = _state.value.copy(user = null)
                    is SessionStatus.RefreshFailure -> _state.value = _state.value.copy(
                        user = null,
                        error = "Your session couldn’t be refreshed. Check your connection and sign in again."
                    )
                    SessionStatus.Initializing -> Unit
                }
            }
        }
    }

    fun signInWithGoogle(getCredential: suspend (GetCredentialRequest) -> Credential) {
        if (_state.value.isLoading || !_state.value.sessionRestored || _state.value.user != null) return
        savedState["googleSignInPending"] = true
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            try {
                Log.i("DataCubeAuth", "picker_started")
                val account = chooseGoogleAccount(getCredential)
                Log.i("DataCubeAuth", "credential_received")
                val result = repository.signInWithGoogle(account.token, account.rawNonce)
                val user = repository.currentUser()
                val error = when (result) {
                    AuthRepository.AuthResult.Success -> if (user == null) "Your sign-in didn’t finish. Please try again." else null
                    is AuthRepository.AuthResult.Error -> result.message
                }
                _state.value = AuthState(user = user, sessionRestored = true, error = error)
            } catch (failure: PickerFailure) {
                Log.w("DataCubeAuth", failure.diagnostic)
                _state.value = _state.value.copy(isLoading = false, error = failure.feedback)
            } catch (cancelled: CancellationException) {
                _state.value = _state.value.copy(isLoading = false, error = "Sign-in was interrupted. Please try again.")
                throw cancelled
            } catch (_: Exception) {
                Log.w("DataCubeAuth", "sign_in_interrupted")
                _state.value = _state.value.copy(isLoading = false, error = "Sign-in couldn’t finish. Please try again.")
            } finally {
                savedState.remove<Boolean>("googleSignInPending")
            }
        }
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
