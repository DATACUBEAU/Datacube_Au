package au.datacube.app.auth

import androidx.credentials.Credential
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialInterruptedException
import androidx.credentials.exceptions.NoCredentialException
import au.datacube.app.BuildConfig
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import java.security.MessageDigest
import java.util.UUID

internal class PickerFailure(val diagnostic: String, val feedback: String) : Exception()

internal fun googleNonceDigest(raw: String): String =
    MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

internal class GoogleAccount(val token: String, val rawNonce: String)

internal suspend fun chooseGoogleAccount(
    getCredential: suspend (GetCredentialRequest) -> Credential
): GoogleAccount {
    val rawNonce = UUID.randomUUID().toString()
    val googleOption = GetSignInWithGoogleOption.Builder(BuildConfig.GOOGLE_WEB_CLIENT_ID)
        .setNonce(googleNonceDigest(rawNonce))
        .build()
    val request = GetCredentialRequest.Builder().addCredentialOption(googleOption).build()
    val credential = try {
        getCredential(request)
    } catch (_: GetCredentialCancellationException) {
        // Play services can also return cancellation after the user selects an account.
        throw PickerFailure("picker_closed", "Google sign-in didn’t finish. Try again. If this happens after choosing an account, this build’s Google sign-in settings may need updating.")
    } catch (_: NoCredentialException) {
        throw PickerFailure("no_account", "Google couldn’t find an available account. Check the Google accounts on this device and try again.")
    } catch (_: GetCredentialInterruptedException) {
        throw PickerFailure("picker_interrupted", "Google sign-in was interrupted. Please try again.")
    } catch (_: GetCredentialException) {
        throw PickerFailure("picker_unavailable", "Google couldn’t finish sign-in on this device. Check Google Play services and try again.")
    }
    if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
        throw PickerFailure("credential_type", "Google returned an unexpected response. Please try again.")
    }
    val token = try {
        GoogleIdTokenCredential.createFrom(credential.data).idToken
    } catch (_: GoogleIdTokenParsingException) {
        throw PickerFailure("credential_unreadable", "Google’s response couldn’t be read. Please try again.")
    }
    if (token.isBlank()) throw PickerFailure("credential_empty", "Google didn’t finish verifying the account. Please try again.")
    return GoogleAccount(token, rawNonce)
}
