package au.datacube.app.work

import android.content.Context
import androidx.room.withTransaction
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import au.datacube.app.data.DataCubeDatabase
import au.datacube.app.data.LocalJobKind
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.notifications.LocalNotificationService
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONObject

class DocumentIntegrityWorker(
    context: Context,
    parameters: WorkerParameters
) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val jobId = inputData.getString(KEY_JOB_ID)?.takeIf { it.isNotBlank() }
            ?: return Result.failure()
        val database = DataCubeDatabase.get(applicationContext)
        val job = database.jobs().find(jobId) ?: return Result.success()

        if (job.status in setOf(
                LocalJobStatus.COMPLETED,
                LocalJobStatus.FAILED,
                LocalJobStatus.CANCELLED
            )
        ) {
            return Result.success()
        }

        // WorkManager unique work prevents concurrent workers for the same job.
        // RUNNING is accepted so a persisted job can resume after process death.
        if (database.jobs().claim(jobId, System.currentTimeMillis()) != 1) {
            return Result.success()
        }

        if (job.kind != LocalJobKind.DOCUMENT_INTEGRITY_CHECK) {
            database.jobs().markFailed(
                jobId,
                "Unsupported local processing task.",
                System.currentTimeMillis()
            )
            return Result.failure()
        }

        return try {
            val documentId = JSONObject(job.payloadJson)
                .optString("documentId")
                .takeIf { it.isNotBlank() }
                ?: throw PermanentJobException("The document reference is missing.")

            val document = database.documents().find(documentId)
                ?: throw PermanentJobException("The imported document no longer exists.")
            val file = File(document.privatePath)
            if (!file.isFile || document.sizeBytes <= 0L) {
                throw PermanentJobException("The private document file is unavailable.")
            }
            if (file.length() != document.sizeBytes) {
                throw PermanentJobException("The private document file failed its size check.")
            }

            val fingerprint = withContext(Dispatchers.IO) {
                val digest = MessageDigest.getInstance("SHA-256")
                FileInputStream(file).use { input ->
                    val buffer = ByteArray(64 * 1024)
                    var totalRead = 0L
                    var lastCheckpoint = 0L
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        digest.update(buffer, 0, count)
                        totalRead += count
                        if (totalRead - lastCheckpoint >= CHECKPOINT_BYTES ||
                            totalRead == document.sizeBytes
                        ) {
                            database.jobs().updateProgress(
                                jobId,
                                (totalRead.toDouble() / document.sizeBytes).coerceIn(0.0, 0.99),
                                System.currentTimeMillis()
                            )
                            lastCheckpoint = totalRead
                        }
                    }
                    if (totalRead != document.sizeBytes) {
                        throw PermanentJobException("The private document changed during verification.")
                    }
                }
                digest.digest().joinToString("") { byte ->
                    "%02x".format(byte.toInt() and 0xff)
                }
            }

            val completedAt = System.currentTimeMillis()
            val committed = database.withTransaction {
                if (database.documents().find(documentId) == null ||
                    database.jobs().markCompleted(jobId, completedAt) != 1) {
                    false
                } else {
                    database.documents().updateSha256(document.id, fingerprint)
                    true
                }
            }
            if (committed) {
                LocalNotificationService(applicationContext)
                    .showDocumentCheckComplete(jobId, documentId)
            }
            Result.success()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: IOException) {
            if (runAttemptCount < MAX_RETRIES) {
                database.jobs().markRetryable(
                    jobId,
                    "Temporary local file access issue.",
                    System.currentTimeMillis()
                )
                Result.retry()
            } else {
                database.jobs().markFailed(
                    jobId,
                    "The local file could not be verified after retries.",
                    System.currentTimeMillis()
                )
                Result.failure()
            }
        } catch (error: PermanentJobException) {
            database.jobs().markFailed(
                jobId,
                error.message ?: "Local document verification failed.",
                System.currentTimeMillis()
            )
            Result.failure()
        } catch (error: Exception) {
            database.jobs().markFailed(
                jobId,
                "Local document verification failed.",
                System.currentTimeMillis()
            )
            Result.failure()
        }
    }

    private class PermanentJobException(message: String) : Exception(message)

    companion object {
        const val KEY_JOB_ID = "job_id"
        private const val CHECKPOINT_BYTES = 4L * 1024L * 1024L
        private const val MAX_RETRIES = 3
    }
}
