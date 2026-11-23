package au.datacube.app.auth

import android.content.Context
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class EncryptedPendingMobileAuthorizationStoreTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val store = EncryptedPendingMobileAuthorizationStore(context)
    private val preferences = context.getSharedPreferences("datacube_mobile_authorization", Context.MODE_PRIVATE)
    private val value = PendingMobileAuthorization(
        requestId = "fixture-pending-sign-in-request",
        verifier = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
        pairingCode = "346723",
        expiresAt = 1_900_000_000_000L
    )

    @Test
    fun requestSurvivesReopeningAndCanBeCleared() = runBlocking {
        try {
            store.save(value)
            val first = encryptedValue()
            store.save(value)
            val second = encryptedValue()
            assertNotEquals(first, second)
            assertFalse(second.contains(value.verifier))
            assertFalse(value.toString().contains(value.verifier))

            val reopened = EncryptedPendingMobileAuthorizationStore(context)
            assertEquals(value, reopened.load())
            reopened.clear()
            assertNull(store.load())
        } finally {
            store.clear()
        }
    }

    @Test
    fun alteredCiphertextIsDiscardedAndTheNextRequestCanBeSaved() = runBlocking {
        try {
            store.save(value)
            val altered = Base64.decode(encryptedValue(), Base64.NO_WRAP)
            altered[altered.lastIndex] = (altered.last().toInt() xor 1).toByte()
            assertTrue(
                preferences.edit().putString(STORAGE_KEY, Base64.encodeToString(altered, Base64.NO_WRAP)).commit()
            )

            assertNull(store.load())
            assertFalse(preferences.contains(STORAGE_KEY))
            store.save(value)
            assertEquals(value, store.load())
        } finally {
            store.clear()
        }
    }

    private fun encryptedValue(): String = checkNotNull(preferences.getString(STORAGE_KEY, null))

    private companion object {
        const val STORAGE_KEY = "encrypted_pending_request"
    }
}
