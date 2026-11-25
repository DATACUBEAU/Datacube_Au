package au.datacube.app.ui.auth

import android.app.Application
import android.net.Uri
import android.util.Log
import java.io.IOException
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import au.datacube.app.DataCubeApp
import au.datacube.app.auth.AuthRepository
import au.datacube.app.auth.EncryptedPendingMobileAuthorizationStore
import au.datacube.app.auth.MobileAuthorizationClient
import au.datacube.app.auth.MobileAuthorizationGateway
import au.datacube.app.auth.MobileAuthorizationLifetimeMillis
import au.datacube.app.auth.MobileAuthorizationRequestId
import au.datacube.app.auth.MobileAuthorizationStatus
import au.datacube.app.auth.MobileAuthorizationUnavailable
import au.datacube.app.auth.MobileAuthorizationHttpFailure
import au.datacube.app.auth.PendingMobileAuthorization
import au.datacube.app.auth.PendingMobileAuthorizationStore
import au.datacube.app.auth.mobileAuthorizationChallenge
import au.datacube.app.auth.newMobileAuthorizationVerifier
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.user.UserInfo
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class AuthState(
    val isLoading: Boolean = false,
    val user: UserInfo? = null,
    val sessionRestored: Boolean = false,
    val error: String? = null,
    val pairingCode: String? = null
)

class AuthViewModel internal constructor(
    app: Application,
    private val repository: AuthRepository,
    private val savedState: SavedStateHandle = SavedStateHandle(),
    private val mobileAuthorization: MobileAuthorizationGateway = mobileAuthorizationClient,
    private val pendingStore: PendingMobileAuthorizationStore = EncryptedPendingMobileAuthorizationStore(app),
    private val now: () -> Long = System::currentTimeMillis
) : AndroidViewModel(app) {
    constructor(app: Application, savedState: SavedStateHandle) : this(app, (app as DataCubeApp).authRepository, savedState)

    private val _state = MutableStateFlow(AuthState())
    val state: StateFlow<AuthState> = _state.asStateFlow()
    private var pending: PendingMobileAuthorization? = null
    private var mobileCompletion: Job? = null
    private var restartMobileCompletion = false
    private var queuedForegroundResume = false
    private var queuedCallbackId: String? = null

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
            val user = withContext(Dispatchers.IO) {
                repository.restoreLocalUser()
            }
            val savedRequest = loadPendingRequest()
            val expired = savedRequest != null && savedRequest.expiresAt <= now()
            if (savedRequest != null && (expired || user != null)) clearPendingStorage()
            pending = savedRequest.takeUnless { expired || user != null }
            _state.value = AuthState(
                isLoading = false,
                user = user,
                sessionRestored = true,
                error = when {
                    expired && user == null -> expiredSignInMessage
                    else -> null
                },
                pairingCode = pending?.pairingCode
            )
            launch(Dispatchers.IO) { repository.syncDisplayAccount() }
            if (queuedForegroundResume) resumeMobileSignIn() else queuedCallbackId?.let(::resumeMobileSignIn)
            queuedForegroundResume = false
            queuedCallbackId = null
            repository.sessionStatus.collect { status ->
                when (status) {
                    is SessionStatus.Authenticated -> _state.value = _state.value.copy(
                        user = status.session.user, error = null
                    )
                    is SessionStatus.NotAuthenticated -> {
                        // The SDK can transiently have no in-memory session. Only its
                        // durable removal (or explicit local sign-out) locks the workspace.
                        val saved = withContext(Dispatchers.IO) { repository.savedLocalUser() }
                        _state.value = _state.value.copy(user = saved)
                    }
                    is SessionStatus.RefreshFailure -> {
                        // Server tokens are not valid for online requests during this state.
                        // The encrypted local account still permits on-device work.
                        val saved = withContext(Dispatchers.IO) { repository.savedLocalUser() }
                        _state.value = _state.value.copy(user = saved, error = null)
                    }
                    SessionStatus.Initializing -> Unit
                }
            }
        }
    }

    fun startMobileSignIn(openBrowser: (Uri) -> Unit) {
        if (!canStartSignIn()) return
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            var stage = "api"
            try {
                val verifier = newMobileAuthorizationVerifier()
                val created = mobileAuthorization.create(mobileAuthorizationChallenge(verifier))
                val currentTime = now()
                val request = PendingMobileAuthorization(
                    created.requestId,
                    verifier,
                    created.pairingCode,
                    minOf(created.expiresAt, currentTime + MobileAuthorizationLifetimeMillis)
                )
                check(request.expiresAt > currentTime)
                stage = "secure_storage"
                pendingStore.save(request)
                pending = request
                _state.value = _state.value.copy(isLoading = false, pairingCode = request.pairingCode)
                openPendingSignIn(openBrowser)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                val status = (failure as? MobileAuthorizationHttpFailure)?.statusCode
                val reason = failure.javaClass.simpleName
                // No credentials, request identifiers, device verifiers or raw exception bodies in logs.
                Log.w(TAG, "mobile_request_creation_failed stage=$stage reason=$reason status=${status ?: 0}")
                val feedback = when {
                    stage == "secure_storage" -> "Couldn’t securely save sign-in (STORAGE). Restart the app and retry."
                    status != null -> "Sign-in server returned HTTP $status. Please retry or report this code."
                    failure is MobileAuthorizationUnavailable -> "Sign-in server rejected the request (AUTH). Try again."
                    failure is IOException || reason.contains("Timeout", ignoreCase = true) ->
                        "Couldn’t reach the sign-in server (NETWORK). Try Wi-Fi or mobile data."
                    else -> "Couldn’t start sign-in (APP). Please report this code."
                }
                _state.value = _state.value.copy(isLoading = false, error = feedback)
            }
        }
    }

    fun openPendingSignIn(openBrowser: (Uri) -> Unit) {
        val request = pending ?: return
        if (_state.value.isLoading || _state.value.user != null) return
        if (request.expiresAt <= now()) {
            resumeMobileSignIn()
            return
        }
        try {
            _state.value = _state.value.copy(error = null)
            openBrowser(mobileAuthorization.approvalPage(request.requestId))
        } catch (_: Exception) {
            Log.w(TAG, "mobile_browser_unavailable")
            _state.value = _state.value.copy(error = "Couldn’t open your browser. Check your browser settings, then try again.")
        }
    }

    fun resumeMobileSignIn(requestId: String? = null) {
        if (requestId != null && !MobileAuthorizationRequestId.matches(requestId)) return
        if (!_state.value.sessionRestored) {
            if (requestId == null) queuedForegroundResume = true else queuedCallbackId = requestId
            return
        }
        val request = pending ?: return
        if (requestId != null && request.requestId != requestId) return
        val completion = mobileCompletion
        if (completion != null && !completion.isCompleted) {
            if (completion.isCancelled) restartMobileCompletion = true
            return
        }
        if (_state.value.isLoading || _state.value.user != null) return
        mobileCompletion = viewModelScope.launch(start = CoroutineStart.LAZY) {
            try {
                completePendingSignIn(request)
            } finally {
                mobileCompletion = null
                if (restartMobileCompletion) {
                    restartMobileCompletion = false
                    resumeMobileSignIn()
                }
            }
        }
        mobileCompletion?.start()
    }

    fun pauseMobileSignIn() {
        queuedForegroundResume = false
        queuedCallbackId = null
        restartMobileCompletion = false
        mobileCompletion?.cancel()
    }

    fun cancelMobileSignIn() {
        val request = pending ?: return
        if (_state.value.isLoading) return
        val completion = mobileCompletion
        pending = null
        restartMobileCompletion = false
        completion?.cancel()
        _state.value = _state.value.copy(isLoading = true, pairingCode = null, error = null)
        viewModelScope.launch {
            completion?.join()
            clearPendingStorage()
            _state.value = _state.value.copy(isLoading = false)
            try {
                mobileAuthorization.cancel(request)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                Log.w(TAG, "mobile_cancel_unavailable")
            }
        }
    }

    private suspend fun completePendingSignIn(request: PendingMobileAuthorization) {
        var hadConnectionError = false
        var backoff = 0L
        repeat(maxCompletionChecks) {
            delay(minOf(backoff, (request.expiresAt - now()).coerceAtLeast(0)))
            if (request.expiresAt <= now()) {
                finishPendingSignIn(expiredSignInMessage)
                return
            }
            try {
                val status = mobileAuthorization.status(request)
                if (status == MobileAuthorizationStatus.APPROVED) {
                    if (consumePendingSignIn(request)) return
                } else if (status != MobileAuthorizationStatus.PENDING) {
                    finishPendingSignIn(status.feedback())
                    return
                }
                hadConnectionError = false
            } catch (_: MobileAuthorizationUnavailable) {
                finishPendingSignIn("This sign-in request is no longer available. Please try again.")
                return
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                hadConnectionError = true
            }
            backoff = if (backoff == 0L) 500L else minOf(backoff * 2, maxCompletionBackoffMillis)
        }
        if (hadConnectionError) {
            _state.value = _state.value.copy(error = "Couldn’t check sign-in. Check your connection and try again.")
        }
    }

    private suspend fun consumePendingSignIn(request: PendingMobileAuthorization): Boolean {
        _state.value = _state.value.copy(isLoading = true, error = null)
        try {
            // Complete the encrypted session write after the server has consumed the proof.
            return withContext(NonCancellable) {
                val response = mobileAuthorization.consume(request)
                when {
                    response.session != null && response.status == MobileAuthorizationStatus.CONSUMED -> {
                        val result = repository.completeMobileSignIn(response.session, response.userId)
                        finishPendingSignIn((result as? AuthRepository.AuthResult.Error)?.message)
                        true
                    }
                    response.status == MobileAuthorizationStatus.APPROVED || response.status == MobileAuthorizationStatus.PENDING -> false
                    else -> {
                        finishPendingSignIn(response.status.feedback())
                        true
                    }
                }
            }
        } finally {
            _state.value = _state.value.copy(isLoading = false)
        }
    }

    private suspend fun finishPendingSignIn(error: String?) {
        clearPendingStorage()
        pending = null
        _state.value = _state.value.copy(
            isLoading = false,
            user = repository.currentUser(),
            pairingCode = null,
            error = error
        )
    }

    private suspend fun loadPendingRequest(): PendingMobileAuthorization? = try {
        pendingStore.load()
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        Log.w(TAG, "mobile_pending_read_failed")
        null
    }

    private suspend fun clearPendingStorage() {
        try {
            pendingStore.clear()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            Log.w(TAG, "mobile_pending_write_failed")
        }
    }

    private fun MobileAuthorizationStatus.feedback(): String = when (this) {
        MobileAuthorizationStatus.DENIED -> "Sign-in wasn’t approved. You can try again."
        MobileAuthorizationStatus.EXPIRED -> expiredSignInMessage
        MobileAuthorizationStatus.CANCELLED -> "Sign-in was cancelled. You can try again."
        else -> "Sign-in couldn’t finish. Please try again."
    }

    private fun canStartSignIn(): Boolean = _state.value.let {
        it.sessionRestored && !it.isLoading && it.user == null && pending == null && repository.configurationError() == null
    }

    fun signOut() {
        if (_state.value.isLoading) return
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true)
            val result = repository.signOut()
            _state.value = AuthState(
                user = if (result is AuthRepository.AuthResult.Success) null else repository.savedLocalUser(),
                sessionRestored = true,
                error = (result as? AuthRepository.AuthResult.Error)?.message
            )
        }
    }

    private companion object {
        const val TAG = "DataCubeAuth"
        const val expiredSignInMessage = "This sign-in request expired. Please try again."
        val mobileAuthorizationClient = MobileAuthorizationClient()
        const val maxCompletionChecks = 25
        const val maxCompletionBackoffMillis = 15_000L
    }
}
