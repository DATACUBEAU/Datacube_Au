package au.datacube.app.models

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.StatFs
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/**
 * A real model file downloader, NOT an inference engine.
 * - immutable HTTPS publisher URL and upstream SHA-256, never caller-provided URLs
 * - resumable byte-range requests with verified Content-Range
 * - bounded private staging, cancellation, and WorkManager foreground progress
 * - atomic move to the same installed directory used by model backups
 */
class VerifiedModelDownloadWorker(
    context: Context, params: WorkerParameters
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val id = inputData.getString(KEY_MODEL_ID).orEmpty()
        val artifact = VerifiedModelDownloads.find(id)
            ?: return@withContext Result.failure(workDataOf(KEY_ERROR to "Unknown model."))
        try {
            // Installation is not completion: a previous run may have been stopped
            // while writing the external ZIP. Never skip the backup on restart.
            if (!LocalModelLibrary(applicationContext).installed(id)) {
                download(artifact)
            }
            savePortableCopy(artifact)
            runCatching { au.datacube.app.notifications.LocalNotificationService(applicationContext)
                .showAiReady("model-$id", "Model installed and backup verified") }
            Result.success(workDataOf(KEY_BACKUP_VERIFIED to true, KEY_STAGE to "Installed · backup verified"))
        } catch (cancelled: CancellationException) {
            // Keep the partial file for explicit Pause -> Resume and process recovery.
            throw cancelled
        } catch (rejected: ModelDownloadRejected) {
            runCatching { au.datacube.app.notifications.LocalNotificationService(applicationContext)
                .showAiReady("model-$id", "Model download needs attention. Open Models to review.") }
            setProgress(workDataOf(KEY_ERROR to (rejected.message ?: "Model download refused.")))
            Result.failure(workDataOf(KEY_ERROR to (rejected.message ?: "Model download refused.")))
        } catch (failure: IOException) {
            if (runAttemptCount < MAX_NETWORK_RETRIES) {
                setProgress(workDataOf(KEY_ERROR to "Connection interrupted. Retrying the download."))
                Result.retry()
            } else {
                runCatching { au.datacube.app.notifications.LocalNotificationService(applicationContext)
                    .showAiReady("model-$id", "Model download interrupted. Open Models to retry.") }
                Result.failure(workDataOf(KEY_ERROR to "Connection repeatedly interrupted. Partial download retained; retry when connected."))
            }
        } catch (failure: Exception) {
            runCatching { au.datacube.app.notifications.LocalNotificationService(applicationContext)
                .showAiReady("model-$id", "Model download needs attention. Open Models to review.") }
            Result.failure(workDataOf(KEY_ERROR to (failure.message ?: "Cannot download this model.")))
        }
    }

    private suspend fun download(artifact: VerifiedModelArtifact) {
        val id = artifact.modelId
        val partial = partialFile(applicationContext, id)
        val etag = etagFile(applicationContext, id)
        check(partial.parentFile?.mkdirs() == true || partial.parentFile?.isDirectory == true) {
            "Cannot create private model storage."
        }

        if (partial.length() > artifact.maximumBytes) {
            partial.delete()
            etag.delete()
        }
        var offset = if (partial.exists()) partial.length() else 0L
        val free = StatFs(partial.parentFile!!.absolutePath).availableBytes
        require(free >= (artifact.maximumBytes - offset + STORAGE_HEADROOM).coerceAtLeast(STORAGE_HEADROOM)) {
            "Not enough free space. Free up storage before downloading the model."
        }

        publishProgress(artifact, offset, -1L)
        var connection = openConnection(artifact.url, offset, etag.takeIf { it.isFile }?.readText())
        try {
            var code = connection.responseCode
            if (code == 416 && offset > 0L) {
                connection.disconnect()
                partial.delete()
                etag.delete()
                offset = 0L
                connection = openConnection(artifact.url, 0L, null)
                code = connection.responseCode
            }
            if (code == 401 || code == 403) {
                throw ModelDownloadRejected("Publisher access required. Open the model page to review its terms.")
            }
            if (code == 404) throw ModelDownloadRejected("Publisher model file is unavailable.")
            if (code == 429 || code in 500..599) throw IOException("Publisher is temporarily unavailable.")
            if (code != 200 && code != 206) {
                throw ModelDownloadRejected("Download failed (HTTP $code).")
            }
            if (offset > 0L && code == 206) {
                val range = connection.getHeaderField("Content-Range").orEmpty()
                val start = Regex("""bytes (\d+)-\d+/\d+""").matchEntire(range)
                    ?.groupValues?.get(1)?.toLongOrNull()
                if (start != offset) {
                    throw ModelDownloadRejected("The server returned an invalid resume range.")
                }
            } else if (code == 206) {
                throw ModelDownloadRejected("The server returned an unexpected partial response.")
            } else if (offset > 0L) {
                // Server does not support Range: restart from byte zero with its full 200 response.
                offset = 0L
                etag.delete()
                partial.delete()
            }
            if (offset == 0L) {
                connection.getHeaderField("ETag")
                    ?.takeIf { it.startsWith('"') && it.endsWith('"') && it.length < 180 }
                    ?.let { etag.writeText(it) }
            }

            val responseLength = connection.contentLengthLong
            val expectedTotal = if (responseLength > 0L) responseLength + offset else -1L
            if (expectedTotal > artifact.maximumBytes) {
                throw ModelDownloadRejected("The publisher file is larger than the verified download limit.")
            }
            var downloaded = offset
            var lastReport = android.os.SystemClock.elapsedRealtime()
            connection.inputStream.use { input ->
                FileOutputStream(partial, offset > 0L).buffered().use { output ->
                    val buffer = ByteArray(128 * 1024)
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        if (isStopped) throw CancellationException("Model download stopped.")
                        val read = input.read(buffer)
                        if (read < 0) break
                        if (read == 0) continue
                        downloaded += read.toLong()
                        if (downloaded > artifact.maximumBytes) {
                            throw ModelDownloadRejected("The download exceeded the verified model size limit.")
                        }
                        output.write(buffer, 0, read)
                        val now = android.os.SystemClock.elapsedRealtime()
                        if (now - lastReport >= 800L) {
                            publishProgress(artifact, downloaded, expectedTotal)
                            lastReport = now
                        }
                    }
                }
            }
            if (expectedTotal > 0 && downloaded != expectedTotal) {
                throw IOException("Incomplete publisher response.")
            }
            publishProgress(artifact, downloaded, downloaded, verifying = true)
            currentCoroutineContext().ensureActive()
            val hash = sha256(partial)
            if (!hash.equals(artifact.sha256, ignoreCase = true)) {
                partial.delete()
                etag.delete()
                throw ModelDownloadRejected("Integrity check failed. Model files were rejected.")
            }
            publishInstalled(artifact, partial, hash)
            etag.delete()
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun savePortableCopy(artifact: VerifiedModelArtifact) {
        // Set foreground even when a restarted worker has no network work to do.
        publishProgress(artifact, 0L, -1L, stageOverride = "Preparing external backup")
        var stage = "Preparing external backup"
        try {
            ModelVaultStore(applicationContext).save(
                modelId = artifact.modelId,
                onProgress = { bytes, total ->
                    publishProgress(artifact, bytes, total, stageOverride = stage)
                },
                onStage = { next ->
                    stage = next
                    publishProgress(artifact, 0L, -1L, stageOverride = stage)
                }
            )
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            throw ModelDownloadRejected("Model installed, but backup is not complete. " +
                "Retry backup without downloading the model again. " +
                (failure.message ?: "Check your selected folder and available space."))
        }
        setProgress(workDataOf(KEY_PROGRESS to 100, KEY_STAGE to "Installed · backup verified"))
    }

    private suspend fun publishInstalled(artifact: VerifiedModelArtifact, partial: File, hash: String) {
        val modelsRoot = File(applicationContext.filesDir, "models")
        val installedRoot = File(modelsRoot, "installed")
        check(installedRoot.mkdirs() || installedRoot.isDirectory) { "Cannot open installed-model folder." }
        val destination = File(installedRoot, artifact.modelId)
        if (destination.exists()) throw ModelDownloadRejected("Model directory already exists; no files were overwritten.")
        val stage = File(modelsRoot, ".install-" + UUID.randomUUID())
        check(stage.mkdir()) { "Cannot stage verified model." }
        try {
            val modelFile = File(stage, artifact.fileName)
            check(partial.renameTo(modelFile)) { "Cannot move the verified model to private storage." }
            File(stage, "local-manifest.txt").writeText(
                artifact.fileName + "\t" + modelFile.length() + "\t" + hash + "\n"
            )
            currentCoroutineContext().ensureActive()
            check(stage.renameTo(destination)) { "Cannot finalize verified model." }
        } finally {
            if (stage.exists()) {
                // Preserve model bytes for retry if atomic directory promotion was interrupted.
                if (!partial.exists()) {
                    File(stage, artifact.fileName).takeIf { it.isFile }?.renameTo(partial)
                }
                stage.deleteRecursively()
            }
        }
    }

    private suspend fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).buffered().use { stream ->
            val buffer = ByteArray(128 * 1024)
            while (true) {
                currentCoroutineContext().ensureActive()
                val count = stream.read(buffer)
                if (count < 0) break
                if (count > 0) digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private suspend fun publishProgress(
        artifact: VerifiedModelArtifact, downloaded: Long, total: Long, verifying: Boolean = false,
        stageOverride: String? = null
    ) {
        val percent = if (total > 0L) (downloaded * 100 / total).toInt().coerceIn(0, 99) else -1
        val stage = stageOverride ?: if (verifying) "Checking download integrity" else "Downloading"
        setProgress(workDataOf(
            KEY_STAGE to stage, KEY_PROGRESS to percent, KEY_BYTES to downloaded, KEY_TOTAL to total
        ))
        val notification = Notification.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("DataCube AU · " + artifact.modelId)
            .setContentText(if (stageOverride != null) stage + if (percent >= 0) " · $percent%" else ""
                else if (verifying) "Verifying model..." else if (percent >= 0) "$percent% downloaded" else "Downloading model...")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100, percent.coerceAtLeast(0), percent < 0 || verifying)
            .build()
        val channel = NotificationChannel(CHANNEL_ID, "Model downloads", NotificationManager.IMPORTANCE_LOW)
        applicationContext.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        val info = if (Build.VERSION.SDK_INT >= 29) {
            ForegroundInfo(
                NOTIFICATION_BASE + (artifact.modelId.hashCode() and 0x3fff),
                notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            ForegroundInfo(NOTIFICATION_BASE + (artifact.modelId.hashCode() and 0x3fff), notification)
        }
        setForeground(info)
    }

    private fun openConnection(url: String, from: Long, savedEtag: String?): HttpURLConnection {
        var target = URL(url)
        repeat(6) {
            if (target.protocol != "https" || target.userInfo != null) {
                throw ModelDownloadRejected("Unsafe model download redirect.")
            }
            val conn = (target.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 20_000
                readTimeout = 30_000
                setRequestProperty("Accept-Encoding", "identity")
                setRequestProperty("User-Agent", "DataCubeAU-Android-ModelDownloader/1")
                if (from > 0L) {
                    setRequestProperty("Range", "bytes=$from-")
                    savedEtag?.let { setRequestProperty("If-Range", it) }
                }
            }
            val code = conn.responseCode
            if (code in 300..399) {
                val location = conn.getHeaderField("Location")
                    ?: throw ModelDownloadRejected("Publisher sent an invalid redirect.")
                val next = URL(target, location)
                conn.disconnect()
                target = next
            } else {
                return conn
            }
        }
        throw ModelDownloadRejected("Too many model download redirects.")
    }

    private class ModelDownloadRejected(message: String) : Exception(message)

    companion object {
        const val KEY_MODEL_ID = "modelId"
        const val KEY_PROGRESS = "percentage"
        const val KEY_BYTES = "downloadedBytes"
        const val KEY_TOTAL = "totalBytes"
        const val KEY_STAGE = "stage"
        const val KEY_ERROR = "error"
        const val KEY_BACKUP_VERIFIED = "backupVerified"
        private const val CHANNEL_ID = "datacube_verified_downloads"
        private const val NOTIFICATION_BASE = 50_000
        private const val MAX_NETWORK_RETRIES = 6
        private const val STORAGE_HEADROOM = 160L * 1024L * 1024L

        fun partialFile(context: Context, id: String): File =
            File(context.filesDir, "models/.downloads/$id.part")

        fun etagFile(context: Context, id: String): File =
            File(context.filesDir, "models/.downloads/$id.etag")
    }
}
