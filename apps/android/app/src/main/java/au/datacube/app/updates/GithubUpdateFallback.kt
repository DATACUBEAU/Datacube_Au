package au.datacube.app.updates

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** A stale but otherwise valid website response must not suppress recovery discovery. */
internal suspend fun resolveUpdateSources(
    sources: List<suspend () -> AndroidUpdateRelease?>
): AndroidUpdateRelease? {
    require(sources.isNotEmpty())
    for ((index, source) in sources.withIndex()) {
        try {
            val found = source()
            if (found != null || index == sources.lastIndex) return found
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            if (index == sources.lastIndex) throw failure
        }
    }
    return null
}

/** Public metadata only. No GitHub token, automatic APK download, or custom install path. */
internal object GithubUpdateFallback {
    private const val RELEASE_ROOT = "https://github.com/DATACUBEAU/Datacube_Au/releases/download/"
    private const val CATALOG = "https://api.github.com/repos/DATACUBEAU/Datacube_Au/releases?per_page=10"
    private const val APK = "DataCube-AU-Android-arm64.apk"
    private const val MANIFEST = "datacube-update.json"
    private const val MAX_CATALOG = 512 * 1024
    private const val MAX_MANIFEST = 16 * 1024
    private val tagPattern = Regex("android-test-[a-f0-9]{12}")
    private val shaPattern = Regex("[a-f0-9]{40}")
    private val hosts = setOf("api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com")

    private data class Candidate(val tag: String, val manifest: String, val apk: String, val size: Long)

    private fun candidate(release: JSONObject): Candidate? {
        val tag = release.optString("tag_name")
        if (release.optBoolean("draft") || !tagPattern.matches(tag)) return null
        val assets = release.optJSONArray("assets") ?: return null
        val items = (0 until assets.length()).mapNotNull { assets.optJSONObject(it) }
        val manifest = items.firstOrNull { it.optString("name") == MANIFEST } ?: return null
        val apk = items.firstOrNull { it.optString("name") == APK } ?: return null
        val manifestUrl = "$RELEASE_ROOT$tag/$MANIFEST"
        val apkUrl = "$RELEASE_ROOT$tag/$APK"
        val size = apk.optLong("size")
        if (manifest.optString("browser_download_url") != manifestUrl ||
            apk.optString("browser_download_url") != apkUrl ||
            manifest.optLong("size") !in 1L..MAX_MANIFEST.toLong() ||
            size !in 1_000_000L..500_000_000L) return null
        return Candidate(tag, manifestUrl, apkUrl, size)
    }

    suspend fun check(
        installedVersion: Int,
        parseManifest: (JSONObject) -> AndroidUpdateRelease
    ): AndroidUpdateRelease? = withContext(Dispatchers.IO) {
        val catalog = JSONArray(read(CATALOG, MAX_CATALOG, "application/vnd.github+json"))
        val candidates = (0 until minOf(catalog.length(), 10))
            .mapNotNull { catalog.optJSONObject(it)?.let(::candidate) }
        if (candidates.isEmpty()) error("No complete Android release metadata found on GitHub.")
        val results = candidates.chunked(5).flatMap { batch ->
            coroutineScope {
                batch.map { item ->
                    async {
                        try {
                            val json = JSONObject(read(item.manifest, MAX_MANIFEST, "application/json"))
                            val sha = json.optString("releaseSha")
                            require(shaPattern.matches(sha) && sha.startsWith(item.tag.removePrefix("android-test-")))
                            val release = parseManifest(json)
                            require(release.apkUrl == item.apk && release.sizeBytes == item.size)
                            release
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (_: Exception) {
                            null
                        }
                    }
                }.awaitAll()
            }
        }
        val best = results.filterNotNull().maxByOrNull { it.versionCode }
            ?: error("No verified Android release metadata found on GitHub.")
        if (best.versionCode > installedVersion) best
        else {
            // Do not report up-to-date when an unreadable release could be newer.
            check(results.none { it == null }) { "Some Android release metadata could not be verified." }
            null
        }
    }

    private suspend fun read(address: String, limit: Int, accept: String): String {
        var url = URL(address)
        repeat(4) {
            currentCoroutineContext().ensureActive()
            require(url.protocol == "https" && url.host in hosts && url.userInfo == null &&
                (url.port == -1 || url.port == 443)) { "Untrusted update metadata destination." }
            val connection = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 8_000
                readTimeout = 10_000
                requestMethod = "GET"
                instanceFollowRedirects = false
                setRequestProperty("Accept", accept)
                setRequestProperty("User-Agent", "DataCube-AU-Android-Updater")
            }
            try {
                val code = connection.responseCode
                if (code in listOf(301, 302, 303, 307, 308)) {
                    val location = connection.getHeaderField("Location")
                        ?: error("Invalid update redirect.")
                    url = URL(url, location)
                } else {
                    check(code == 200) { "GitHub update metadata unavailable (HTTP $code)." }
                    val out = ByteArrayOutputStream()
                    connection.inputStream.use { input ->
                        val buffer = ByteArray(4096)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val count = input.read(buffer)
                            if (count < 0) break
                            check(out.size() + count <= limit) { "Update metadata exceeds size limit." }
                            out.write(buffer, 0, count)
                        }
                    }
                    return out.toString(Charsets.UTF_8.name())
                }
            } finally {
                connection.disconnect()
            }
        }
        error("Too many update metadata redirects.")
    }
}
