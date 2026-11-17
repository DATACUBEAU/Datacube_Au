package au.datacube.app.work

import android.content.Context
import androidx.room.withTransaction
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import au.datacube.app.data.DataCubeDatabase
import au.datacube.app.data.ExtractedTextStore
import au.datacube.app.data.LocalJobKind
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.data.PlainTextDocumentExtractor
import au.datacube.app.data.TextExtractionRejectedException
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

        return try {
            val documentId = JSONObject(job.payloadJson)
                .optString("documentId")
                .takeIf { it.isNotBlank() }
                ?: throw TextExtractionRejectedException("The document reference is missing.")
            val document = database.documents().find(documentId)
                ?: throw TextExtractionRejectedException("The imported document no longer exists.")
            if (document.extension.lowercase() !in SUPPORTED_EXTENSIONS) {
                throw TextExtractionRejectedException(
                    "Text extraction is not yet supported for this file type."
                )
            }

            val source = File(document.privatePath)
            if (!source.isFile || source.length() != document.sizeBytes) {
                throw TextExtractionRejectedException("The private document file is unavailable.")
            }

            val destination = ExtractedTextStore.fileFor(applicationContext.filesDir, documentId)
            PlainTextDocumentExtractor().extract(source, destination) { progress ->
                database.jobs().updateProgress(
                    jobId,
                    progress.coerceIn(0.0, 0.95),
                    System.currentTimeMillis()
                )
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
        }
    }

    companion object {
        const val KEY_JOB_ID = "job_id"
        private const val MAX_RETRIES = 3
        private val SUPPORTED_EXTENSIONS = setOf("txt", "md")
    }
}
