package au.datacube.app.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.jan.supabase.auth.user.UserSession
import org.junit.Assert.assertEquals
import java.security.KeyStore
import javax.crypto.KeyGenerator
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class EncryptedSupabaseSessionManagerTest {

    @Test
    fun savedSessionSurvivesReopeningAndIsRemovedOnLogout() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val session = UserSession("test-access", "test-refresh", expiresIn = 3600, tokenType = "bearer")
        val manager = EncryptedSupabaseSessionManager(context)
        try {
            manager.saveSession(session)
            val reopened = EncryptedSupabaseSessionManager(context)
            assertEquals(session, reopened.loadSession())
            reopened.deleteSession()
            assertNull(manager.loadSession())
        } finally {
            manager.deleteSession()
        }
    }

    @Test
    fun unreadableCiphertextClearsStoredSessionAndUnusableKeystoreKey() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        keyStore.deleteEntry(KEY_ALIAS)

        // Create the same AES-GCM key the session manager uses, then store a
        // structurally valid but unauthentic ciphertext (12-byte IV + 16-byte tag).
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        generator.generateKey()
        preferences.edit()
            .putString(STORAGE_KEY, Base64.encodeToString(ByteArray(28), Base64.NO_WRAP))
            .commit()

        val manager = EncryptedSupabaseSessionManager(context)
        assertNull(manager.loadSession())

        assertFalse("Unreadable encrypted session must be removed", preferences.contains(STORAGE_KEY))
        val refreshedKeyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        assertTrue("Unusable encryption key must be removed so a later sign-in can create a new one",
            !refreshedKeyStore.containsAlias(KEY_ALIAS))
    }

    private companion object {
        const val PREFERENCES_NAME = "datacube_supabase_session"
        const val STORAGE_KEY = "encrypted_sdk_session"
        const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val KEY_ALIAS = "datacube.supabase.session.v1"
    }
}
