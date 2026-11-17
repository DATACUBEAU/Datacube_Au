package au.datacube.app.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "local_jobs",
    indices = [Index(value = ["status", "createdAtEpochMs"])]
)
data class LocalJob(
    @PrimaryKey val id: String,
    val kind: String,
    val status: String,
    val payloadJson: String,
    val progress: Double,
    val attempts: Int,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long,
    val lastError: String? = null
)

object LocalJobKind {
    const val DOCUMENT_INTEGRITY_CHECK = "document.integrity_check"
    const val DOCUMENT_TEXT_EXTRACTION = "document.text_extraction"
}

object LocalJobStatus {
    const val QUEUED = "queued"
    const val RUNNING = "running"
    const val RETRYABLE = "retryable"
    const val COMPLETED = "completed"
    const val FAILED = "failed"
    const val CANCELLED = "cancelled"
}
