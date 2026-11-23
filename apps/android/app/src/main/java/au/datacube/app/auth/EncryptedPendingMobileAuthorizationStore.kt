package au.datacube.app.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
internal data class PendingMobileAuthorization(
    val requestId: String,
    val verifier: String,
    val pairingCode: String,
    val expiresAt: Long
) {
    override fun toString(): String = "PendingMobileAuthorization(expiresAt=$expiresAt)"
}

internal interface PendingMobileAuthorizationStore {
    suspend fun load(): PendingMobileAuthorization?
    suspend fun save(value: PendingMobileAuthorization)
    suspend fun clear()
}

internal class EncryptedPendingMobileAuthorizationStore(context: Context) : PendingMobileAuthorizationStore {
    private val preferences by lazy {
        context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    }

    override suspend fun load(): PendingMobileAuthorization? = withContext(Dispatchers.IO) {
        synchronized(lock) {
            try {
                val encoded = preferences.getString(STORAGE_KEY, null) ?: return@synchronized null
                val combined = Base64.decode(encoded, Base64.NO_WRAP)
                require(combined.size > IV_LENGTH)
                val cipher = Cipher.getInstance(TRANSFORMATION)
                val key = checkNotNull(openKeyStore().getKey(KEY_ALIAS, null) as? SecretKey)
                cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_LENGTH_BITS, combined, 0, IV_LENGTH))
                val plaintext = cipher.doFinal(combined, IV_LENGTH, combined.size - IV_LENGTH)
                Json.decodeFromString(PendingMobileAuthorization.serializer(), plaintext.toString(Charsets.UTF_8))
            } catch (_: Exception) {
                removePendingValue()
                runCatching { openKeyStore().deleteEntry(KEY_ALIAS) }
                    .onFailure { Log.w(TAG, "pending_sign_in_key_reset_failed") }
                null
            }
        }
    }

    override suspend fun save(value: PendingMobileAuthorization) = withContext(Dispatchers.IO) {
        synchronized(lock) {
            val plaintext = Json.encodeToString(PendingMobileAuthorization.serializer(), value)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            val combined = cipher.iv + cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
            val encrypted = Base64.encodeToString(combined, Base64.NO_WRAP)
            check(preferences.edit().putString(STORAGE_KEY, encrypted).commit()) {
                "Could not persist pending browser sign-in."
            }
        }
    }

    override suspend fun clear() = withContext(Dispatchers.IO) {
        synchronized(lock) { removePendingValue() }
    }

    private fun removePendingValue() {
        check(preferences.edit().remove(STORAGE_KEY).commit()) {
            "Could not clear pending browser sign-in."
        }
    }

    private fun openKeyStore(): KeyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }

    private fun getOrCreateKey(): SecretKey {
        val existing = openKeyStore().getKey(KEY_ALIAS, null) as? SecretKey
        if (existing != null) return existing

        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER).run {
            init(
                KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build()
            )
            generateKey()
        }
    }

    private companion object {
        val lock = Any()
        const val TAG = "DataCubeAuth"
        const val PREFERENCES_NAME = "datacube_mobile_authorization"
        const val STORAGE_KEY = "encrypted_pending_request"
        const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val KEY_ALIAS = "datacube.mobile.authorization.v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_LENGTH = 12
        const val TAG_LENGTH_BITS = 128
    }
}
