package au.datacube.app.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import io.github.jan.supabase.auth.SessionManager
import io.github.jan.supabase.auth.user.UserSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class EncryptedSupabaseSessionManager(context: Context) : SessionManager {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE
    )
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun saveSession(session: UserSession) = withContext(Dispatchers.IO) {
        val plaintext = json.encodeToString(UserSession.serializer(), session)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val combined = cipher.iv + cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        check(
            preferences.edit()
                .putString(STORAGE_KEY, Base64.encodeToString(combined, Base64.NO_WRAP))
                .commit()
        ) {
            "Could not persist the encrypted Supabase session."
        }
    }

    override suspend fun loadSession(): UserSession? = withContext(Dispatchers.IO) {
        val encoded = preferences.getString(STORAGE_KEY, null) ?: return@withContext null
        try {
            val combined = Base64.decode(encoded, Base64.NO_WRAP)
            require(combined.size > IV_LENGTH) { "Invalid encrypted session." }
            val iv = combined.copyOfRange(0, IV_LENGTH)
            val ciphertext = combined.copyOfRange(IV_LENGTH, combined.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                GCMParameterSpec(TAG_LENGTH_BITS, iv)
            )
            val plaintext = String(cipher.doFinal(ciphertext), Charsets.UTF_8)
            json.decodeFromString(UserSession.serializer(), plaintext)
        } catch (_: Exception) {
            Log.w(TAG, "Stored Supabase session is unreadable; a new sign-in is required.")
            check(preferences.edit().remove(STORAGE_KEY).commit()) {
                "Could not clear the unreadable encrypted Supabase session."
            }
            // A permanently invalidated or replaced Keystore key cannot decrypt old
            // ciphertext. Remove the unusable alias as well, so the next successful
            // sign-in can generate a fresh key instead of failing on every save.
            runCatching { deleteKey() }
                .onFailure { Log.e(TAG, "keystore_reset_failed") }
            null
        }
    }

    override suspend fun deleteSession() = withContext(Dispatchers.IO) {
        check(preferences.edit().remove(STORAGE_KEY).commit()) {
            "Could not clear the encrypted Supabase session."
        }
    }

    private fun deleteKey() {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        if (keyStore.containsAlias(KEY_ALIAS)) {
            keyStore.deleteEntry(KEY_ALIAS)
        }
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
        if (existing != null) return existing

        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            KEYSTORE_PROVIDER
        )
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
        return generator.generateKey()
    }

    private companion object {
        const val TAG = "DataCubeAuth"
        const val PREFERENCES_NAME = "datacube_supabase_session"
        const val STORAGE_KEY = "encrypted_sdk_session"
        const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val KEY_ALIAS = "datacube.supabase.session.v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_LENGTH = 12
        const val TAG_LENGTH_BITS = 128
    }
}
