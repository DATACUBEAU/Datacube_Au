package au.datacube.app.work

import android.content.Context
import androidx.room.withTransaction
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import au.datacube.app.data.DataCubeDatabase
import au.datacube.app.data.DocumentTextExtractor
import au.datacube.app.data.ExtractedTextStore
import au.datacube.app.data.LocalJobKind
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.data.PdfDocumentTextExtractor
import au.datacube.app.data.PlainTextDocumentExtractor
import au.datacube.app.data.TextExtractionRejectedException
import au.datacube.app.notifications.LocalNotificationService
import au.datacube.app.data.rag.LexicalIndexWorker
import java.io.File
import java.io.IOException
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

class DocumentTextExtractionWorker(
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
        if (database.jobs().claim(jobId, System.currentTimeMillis()) != 1) {
            return Result.success()
        }
        if (job.kind != LocalJobKind.DOCUMENT_TEXT_EXTRACTION) {
            database.jobs().markFailed(
                jobId,
                "Unsupported local processing task.",
                System.currentTimeMillis()
            )
            return Result.failure()
        }

        val notifications = LocalNotificationService(applicationContext)
        var trackedDocumentId: String? = null
        var indexDocumentId: String? = null
        val outcome = try {
            val documentId = JSONObject(job.payloadJson)
                .optString("documentId")
                .takeIf { it.isNotBlank() }
                ?: throw TextExtractionRejectedException("The document reference is missing.")
            trackedDocumentId = documentId
            val document = database.documents().find(documentId)
                ?: throw TextExtractionRejectedException("The imported document no longer exists.")
            val extractor: DocumentTextExtractor = when (document.extension.lowercase()) {
                "pdf" -> PdfDocumentTextExtractor()
                "txt", "md" -> PlainTextDocumentExtractor()
                else -> null
            } ?: run {
                throw TextExtractionRejectedException(
                    "Text extraction is not yet supported for this file type."
                )
            }

            val source = File(document.privatePath)
            if (!source.isFile || source.length() != document.sizeBytes) {
                throw TextExtractionRejectedException("The private document file is unavailable.")
            }

            val destination = ExtractedTextStore.fileFor(applicationContext.filesDir, documentId)
            var lastNotified = -5
            val foreground = notifications.startDocumentWorker(this, "Extracting document text · 0%", 0)
            notifications.updateDocumentWorker(this, documentId, foreground, "Extracting document text · 0%", 0)
            extractor.extract(source, destination) { progress ->
                val bounded = progress.coerceIn(0.0, 0.95)
                database.jobs().updateProgress(jobId, bounded, System.currentTimeMillis())
                val percentage = (bounded * 100).toInt()
                if (percentage - lastNotified >= 5 || percentage >= 95 && lastNotified < 95) {
                    // Replaces the same silent status, not dozens of notification dots.
                    setProgress(workDataOf("percentage" to percentage))
                    notifications.updateDocumentWorker(this, documentId, foreground, "Extracting document text · $percentage%", percentage)
                    lastNotified = percentage
                }
            }

            val completed = database.withTransaction {
                if (database.documents().find(documentId) == null) {
                    false
                } else {
                    database.jobs().markCompleted(jobId, System.currentTimeMillis()) == 1
                }
            }
            if (!completed) {
                destination.delete()
                database.jobs().markFailed(
                    jobId,
                    "The document was removed before extraction completed.",
                    System.currentTimeMillis()
                )
            } else {
                notifications.showTextReady(documentId)
                indexDocumentId = documentId
            }
            Result.success()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (rejected: TextExtractionRejectedException) {
            database.jobs().markFailed(
                jobId,
                rejected.message ?: "Local text extraction is unavailable.",
                System.currentTimeMillis()
            )
            Result.failure()
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
                    "The local text file could not be extracted after retries.",
                    System.currentTimeMillis()
                )
                Result.failure()
            }
        } catch (error: Exception) {
            database.jobs().markFailed(
                jobId,
                "Local text extraction failed.",
                System.currentTimeMillis()
            )
            Result.failure()
        } finally {
            trackedDocumentId?.let(notifications::clearDocumentProgress)
        }
        // Start follow-up indexing only after extraction clears its own
        // notification; the two workers must not cancel each other's status.
        indexDocumentId?.let { id ->
            try { LexicalIndexWorker.schedule(applicationContext, id) }
            catch (_: Exception) { notifications.showDocumentFailed(id) }
        }
        // Use the persisted task outcome, not WorkManager's restricted Result implementation.
        if (database.jobs().find(jobId)?.status == LocalJobStatus.FAILED) trackedDocumentId?.let { id ->
            if (database.documents().find(id) != null) notifications.showDocumentFailed(id)
        }
        return outcome
    }

    companion object {
        const val KEY_JOB_ID = "job_id"
        private const val MAX_RETRIES = 3
    }
}
