package au.datacube.app.ui.profile

import android.os.Build
import au.datacube.app.BuildConfig
import au.datacube.app.auth.SupabaseClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/** User-triggered only; no background worker, location or hardware identifier. */
internal object DeviceCompatibilityReport {
    suspend fun send(accountId: String, remove: Boolean): Boolean = withContext(Dispatchers.IO) {
        val session = SupabaseClient.auth.currentSessionOrNull() ?: return@withContext false
        if (session.user?.id != accountId || session.accessToken.isBlank()) return@withContext false
        val payload = JSONObject().put("action", if (remove) "remove" else "share")
        if (!remove) payload.put("manufacturer", Build.MANUFACTURER.take(60))
            .put("model", Build.MODEL.take(80))
            .put("androidVersion", Build.VERSION.RELEASE.take(30))
            .put("sdk", Build.VERSION.SDK_INT)
            .put("appVersion", BuildConfig.VERSION_NAME.take(40))
        val connection = URL("https://datacube.fabianodev.xyz/api/account/device-report").openConnection() as HttpsURLConnection
        try {
            connection.requestMethod = "POST"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10000
            connection.readTimeout = 10000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer " + session.accessToken)
            val bytes = payload.toString().toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
            connection.responseCode == 200
        } finally { connection.disconnect() }
    }
}
