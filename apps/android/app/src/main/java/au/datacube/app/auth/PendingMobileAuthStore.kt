package au.datacube.app.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keeps the in-progress browser authentication verifier inside app-private,
 * Android-Keystore-protected storage. The verifier never leaves this device.
 */
class PendingMobileAuthStore(context: Context) {
    data class PendingAuth(val state: String, val verifier: String)

    private val preferences = context.applicationContext.getSharedPreferences(
        "datacube_mobile_auth_pending",
        Context.MODE_PRIVATE
    )

    fun save(state: String, verifier: String) {
        val payload = JSONObject()
            .put("state", state)
            .put("verifier", verifier)
            .put("createdAt", System.currentTimeMillis())
            .toString()
            .toByteArray(Charsets.UTF_8)

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(payload)
        val combined = cipher.iv + encrypted
        check(preferences.edit().putString(STORAGE_KEY, Base64.encodeToString(combined, Base64.NO_WRAP)).commit()) {
            "Could not persist the pending authentication transaction."
        }
    }

    fun load(expectedState: String): PendingAuth? {
        val encoded = preferences.getString(STORAGE_KEY, null) ?: return null
        return try {
            val combined = Base64.decode(encoded, Base64.NO_WRAP)
            if (combined.size <= IV_LENGTH) return null

            val iv = combined.copyOfRange(0, IV_LENGTH)
            val encrypted = combined.copyOfRange(IV_LENGTH, combined.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(TAG_LENGTH_BITS, iv))
            val json = JSONObject(String(cipher.doFinal(encrypted), Charsets.UTF_8))
            val state = json.getString("state")
            val verifier = json.getString("verifier")
            val createdAt = json.getLong("createdAt")

            if (!state.toByteArray().contentEquals(expectedState.toByteArray())) return null
            if (System.currentTimeMillis() - createdAt > MAX_AGE_MS) return null
            if (verifier.length !in 43..128) return null
            PendingAuth(state, verifier)
        } catch (_: Exception) {
            null
        }
    }

    fun clear() {
        preferences.edit().remove(STORAGE_KEY).apply()
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
        if (existing != null) return existing

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
        return generator.generateKey()
    }

    private companion object {
        const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val KEY_ALIAS = "datacube.mobile.auth.handoff.v1"
        const val STORAGE_KEY = "pending_transaction"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_LENGTH = 12
        const val TAG_LENGTH_BITS = 128
        const val MAX_AGE_MS = 30L * 60L * 1000L
    }
}
