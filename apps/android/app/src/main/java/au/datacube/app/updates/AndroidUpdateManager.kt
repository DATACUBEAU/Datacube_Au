package au.datacube.app.updates

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.StatFs
import android.provider.Settings
import androidx.core.content.FileProvider
import au.datacube.app.BuildConfig
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONObject

data class AndroidUpdateRelease(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val sizeBytes: Long,
    val sha256: String,
    val notes: String
)

enum class InstallStatus { OPENED_INSTALLER, PERMISSION_REQUIRED }

/** Opt-in full APK updates; no background APK downloads or silent installs. */
object AndroidUpdateManager {
    private const val MAX_APK_BYTES = 500L * 1024 * 1024
    private const val MAX_MANIFEST_BYTES = 16 * 1024
    private const val MIN_FREE_RESERVE = 64L * 1024 * 1024
    private val releaseUrl = Regex(
        """https://github\.com/DATACUBEAU/Datacube_Au/releases/download/android-test-[a-f0-9]{12}/DataCube-AU-Android-arm64\.apk"""
    )
    private val checksumFormat = Regex("[a-f0-9]{64}")

    fun installedVersion(): Int = BuildConfig.VERSION_CODE

    /** HTTPS metadata only: a small public JSON served by the user's website. */
    suspend fun check(context: Context): AndroidUpdateRelease? = withContext(Dispatchers.IO) {
        // Independent of authentication callbacks: use the official domain first,
        // retain the legacy endpoint for existing deployments and recovery.
        val origins = listOf("https://datacube.fabianodev.xyz", BuildConfig.AUTH_WEBSITE_URL.trimEnd('/')).distinct()
        val sources: List<suspend () -> AndroidUpdateRelease?> =
            origins.map { origin -> suspend { checkOrigin(origin) } } +
                listOf(suspend { GithubUpdateFallback.check(installedVersion(), ::parseManifest) })
        resolveUpdateSources(sources)
    }

    private suspend fun checkOrigin(origin: String): AndroidUpdateRelease? = withContext(Dispatchers.IO) {
        val url = URL(origin + "/api/android-update")
        require(url.protocol == "https") { "Update metadata requires HTTPS." }
        val connection = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 12_000
            requestMethod = "GET"
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
        }
        try {
            if (connection.responseCode == 404) error("No published APK metadata is available yet.")
            check(connection.responseCode == 200) { "Update server is unavailable." }
            val output = java.io.ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(2048)
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val n = input.read(buffer)
                    if (n < 0) break
                    check(output.size() + n <= MAX_MANIFEST_BYTES) { "Update metadata is too large." }
                    output.write(buffer, 0, n)
                }
            }
            val release = parseManifest(JSONObject(output.toString(Charsets.UTF_8.name())))
            release.takeIf { it.versionCode > installedVersion() }
        } finally {
            connection.disconnect()
        }
    }

    private fun parseManifest(json: JSONObject): AndroidUpdateRelease {
        require(json.optInt("schema") == 1) { "Unsupported update metadata." }
        val code = json.getInt("versionCode")
        val size = json.getLong("sizeBytes")
        val hash = json.getString("sha256").lowercase(Locale.ROOT)
        val link = json.getString("apkUrl")
        require(code in 4..2_100_000_000 && size in 1_000_000L..MAX_APK_BYTES &&
            checksumFormat.matches(hash) && releaseUrl.matches(link)) {
            "Update verification failed. Try again later."
        }
        return AndroidUpdateRelease(
            versionCode = code,
            versionName = json.optString("versionName", "Update $code").take(36),
            apkUrl = link,
            sizeBytes = size,
            sha256 = hash,
            notes = json.optString("notes", "New improvements").take(500)
        )
    }

    private fun updateFile(context: Context, release: AndroidUpdateRelease): File {
        val base = File(context.cacheDir, "updates")
        check(base.isDirectory || base.mkdirs()) { "Cannot create temporary update storage." }
        return File(base, "datacube-${release.versionCode}.apk")
    }

    fun existingDownload(context: Context, release: AndroidUpdateRelease): Boolean {
        val file = updateFile(context, release)
        return file.isFile && file.length() == release.sizeBytes
    }

    /** Full APK download starts only from an explicit user tap. */
    suspend fun download(
        context: Context,
        release: AndroidUpdateRelease,
        onProgress: suspend (Int) -> Unit = {}
    ): File = withContext(Dispatchers.IO) {
        require(release.versionCode > BuildConfig.VERSION_CODE &&
            releaseUrl.matches(release.apkUrl) &&
            release.sizeBytes in 1_000_000L..MAX_APK_BYTES &&
            checksumFormat.matches(release.sha256)) { "Invalid update request." }
        val destination = updateFile(context, release)
        if (destination.isFile && destination.length() == release.sizeBytes) {
            if (hashFile(destination) == release.sha256) {
                try {
                    verifyPackage(context, destination, release.versionCode)
                    onProgress(100)
                    return@withContext destination
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { destination.delete() }
            }
            destination.delete()
        }
        val available = StatFs(context.cacheDir.absolutePath).availableBytes
        check(available >= release.sizeBytes + MIN_FREE_RESERVE) {
            "Not enough free space for this update. Free up storage and try again."
        }
        val partial = File(destination.parentFile, destination.name + ".partial")
        partial.delete()
        val url = URL(release.apkUrl)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            requestMethod = "GET"
            setRequestProperty("Accept-Encoding", "identity")
        }
        try {
            check(connection.responseCode == 200) {
                "Could not download the verified update (HTTP ${connection.responseCode})."
            }
            check(connection.url.protocol == "https") { "Unsecured APK download refused." }
            val digest = MessageDigest.getInstance("SHA-256")
            var received = 0L
            var lastNotified = 0L
            connection.inputStream.buffered().use { input ->
                partial.outputStream().buffered().use { out ->
                    val data = ByteArray(64 * 1024)
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val n = input.read(data)
                        if (n < 0) break
                        received += n
                        check(received <= release.sizeBytes) { "Update exceeds declared size." }
                        digest.update(data, 0, n)
                        out.write(data, 0, n)
                        if (received - lastNotified >= 1024L * 1024 || received == release.sizeBytes) {
                            onProgress((100L * received / release.sizeBytes).toInt().coerceIn(0, 100))
                            lastNotified = received
                        }
                    }
                }
            }
            check(received == release.sizeBytes &&
                digest.digest().joinToString("") { "%02x".format(it) } == release.sha256) {
                "The update download was incomplete or failed its SHA-256 check."
            }
            check(partial.renameTo(destination)) { "Could not finalize the verified APK." }
            try { verifyPackage(context, destination, release.versionCode) }
            catch (failure: Exception) { destination.delete(); throw failure }
            destination
        } catch (cancelled: CancellationException) {
            throw cancelled
        } finally {
            partial.delete()
            connection.disconnect()
        }
    }

    private suspend fun hashFile(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val data = ByteArray(64 * 1024)
            while (true) {
                currentCoroutineContext().ensureActive()
                val n = input.read(data)
                if (n < 0) break
                digest.update(data, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    @Suppress("DEPRECATION")
    private fun verifyPackage(context: Context, apk: File, requestedVersion: Int) {
        val info = context.packageManager.getPackageArchiveInfo(
            apk.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES
        ) ?: error("Downloaded update is not a valid Android package.")
        require(info.packageName == context.packageName) { "Update is for a different app." }
        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode
            else info.versionCode.toLong()
        require(code == requestedVersion.toLong() && code > BuildConfig.VERSION_CODE) {
            "Update version did not match the published release."
        }
        // The platform installer is the final authority for signature compatibility.
        // It never silently overwrites a package signed with a different key.
    }

    fun launchInstaller(context: Context, release: AndroidUpdateRelease): InstallStatus {
        val file = updateFile(context, release)
        check(file.isFile && file.length() == release.sizeBytes) {
            "The update has not been downloaded yet."
        }
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
            return InstallStatus.PERMISSION_REQUIRED
        }
        val uri = FileProvider.getUriForFile(context,
            context.packageName + ".updates", file)
        context.startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        return InstallStatus.OPENED_INSTALLER
    }

    fun openInstallPermissionSettings(context: Context) {
        val uri = Uri.parse("package:" + context.packageName)
        context.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, uri)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    /** A one-shot notice when the operating system has replaced the installed APK. */
    fun consumeUpdatedOnLaunch(context: Context): Boolean {
        val preferences = context.getSharedPreferences("datacube_updates", Context.MODE_PRIVATE)
        val previous = preferences.getInt("installed_version", 0)
        val current = BuildConfig.VERSION_CODE
        if (previous != current) preferences.edit().putInt("installed_version", current).apply()
        return previous > 0 && current > previous
    }
}
