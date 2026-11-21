package au.datacube.app.ui.auth

import android.util.Log
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.credentials.CustomCredential
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import au.datacube.app.BuildConfig
import au.datacube.app.R
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.CancellationException
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch

private val AuthBlue = Color(0xFF318BFF)
private val AuthMuted = Color(0xFFB8C9DE)

/** Native Android Google authentication. No website or browser callback is involved. */
@Composable
fun AuthScreen(viewModel: AuthViewModel) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var acquiringCredential by remember { mutableStateOf(false) }

    val startGoogleSignIn: () -> Unit = {
        if (BuildConfig.GOOGLE_WEB_CLIENT_ID.isBlank()) {
            viewModel.showError("Google sign-in is not configured yet. The app build needs the Google Web OAuth client ID.")
        } else if (!acquiringCredential && !state.isLoading) {
            acquiringCredential = true
            scope.launch {
                try {
                    val rawNonce = UUID.randomUUID().toString()
                    val hashedNonce = MessageDigest.getInstance("SHA-256")
                        .digest(rawNonce.toByteArray())
                        .joinToString("") { "%02x".format(it) }

                    val googleOption = GetSignInWithGoogleOption.Builder(BuildConfig.GOOGLE_WEB_CLIENT_ID)
                        .setNonce(hashedNonce)
                        .build()
                    val request = GetCredentialRequest.Builder()
                        .addCredentialOption(googleOption)
                        .build()
                    val result = CredentialManager.create(context).getCredential(
                        request = request,
                        context = context
                    )
                    val credential = result.credential
                    if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                        viewModel.showError("Google returned an unexpected credential. Please try again.")
                        return@launch
                    }
                    val googleCredential = GoogleIdTokenCredential.createFrom(credential.data)
                    viewModel.signInWithGoogle(googleCredential.idToken, rawNonce)
                } catch (_: GetCredentialCancellationException) {
                    // Cancellation is a normal user action; leave the auth screen unchanged.
                } catch (_: GetCredentialException) {
                    Log.w("DataCubeAuth", "Google credential acquisition failed")
                    viewModel.showError("Google account sign-in could not start. Check Google Play services and try again.")
                } catch (_: GoogleIdTokenParsingException) {
                    Log.w("DataCubeAuth", "Google returned an unreadable ID token")
                    viewModel.showError("Google returned an invalid identity token. Please try again.")
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    viewModel.showError("Native Google sign-in failed. Check your connection and retry.")
                } finally {
                    acquiringCredential = false
                }
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF06101F), Color(0xFF0A1B32), Color(0xFF071426))))
            .padding(horizontal = 28.dp, vertical = 36.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Image(
                painter = painterResource(R.drawable.datacube_logo),
                contentDescription = "DataCube AU",
                modifier = Modifier.size(104.dp)
            )
            Spacer(Modifier.height(16.dp))
            Text(
                "DATACUBE AU",
                color = Color(0xFF78D5FF),
                fontWeight = FontWeight.Bold,
                letterSpacing = 3.sp,
                style = MaterialTheme.typography.labelLarge
            )
            Spacer(Modifier.height(18.dp))
            Text(
                "Welcome back.",
                color = Color.White,
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.headlineLarge,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Your knowledge. One connected space.",
                color = AuthMuted,
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(38.dp))
            Button(
                onClick = startGoogleSignIn,
                enabled = !acquiringCredential && !state.isLoading,
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(18.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF247CEB),
                    contentColor = Color.White
                )
            ) {
                if (state.isLoading) {
                    CircularProgressIndicator(Modifier.size(19.dp), color = Color.White, strokeWidth = 2.dp)
                    Spacer(Modifier.size(10.dp))
                }
                Text("Continue with Google", fontWeight = FontWeight.SemiBold)
            }
            state.error?.let { message ->
                Spacer(Modifier.height(18.dp))
                Text(
                    message,
                    color = Color(0xFFFFB8B8),
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
            }
            Spacer(Modifier.height(24.dp))
            Text("Secure native sign-in", color = AuthMuted.copy(alpha = 0.7f), style = MaterialTheme.typography.labelSmall)
        }
    }
}
