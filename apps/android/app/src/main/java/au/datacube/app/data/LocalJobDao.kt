package au.datacube.app.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface LocalJobDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(job: LocalJob)

    @Query("SELECT * FROM local_jobs WHERE id = :id LIMIT 1")
    suspend fun find(id: String): LocalJob?

    @Query(
        "SELECT * FROM local_jobs WHERE status IN ('queued', 'retryable', 'running') " +
            "ORDER BY createdAtEpochMs ASC"
    )
    suspend fun findRecoverable(): List<LocalJob>

    // A unique WorkManager job is the execution lease. Allow RUNNING here so
    // WorkManager can resume a job after Android kills the app process.
    @Query(
        "UPDATE local_jobs SET status = 'running', attempts = attempts + 1, " +
            "updatedAtEpochMs = :now, lastError = NULL " +
            "WHERE id = :id AND status IN ('queued', 'retryable', 'running')"
    )
    suspend fun claim(id: String, now: Long): Int

    @Query(
        "UPDATE local_jobs SET progress = :progress, updatedAtEpochMs = :now " +
            "WHERE id = :id AND status = 'running'"
    )
    suspend fun updateProgress(id: String, progress: Double, now: Long): Int

    @Query(
        "UPDATE local_jobs SET status = 'completed', progress = 1.0, " +
            "updatedAtEpochMs = :now, lastError = NULL " +
            "WHERE id = :id AND status = 'running'"
    )
    suspend fun markCompleted(id: String, now: Long): Int

    @Query(
        "UPDATE local_jobs SET status = 'retryable', lastError = :safeError, " +
            "updatedAtEpochMs = :now WHERE id = :id AND status = 'running'"
    )
    suspend fun markRetryable(id: String, safeError: String, now: Long): Int

    @Query(
        "UPDATE local_jobs SET status = 'failed', lastError = :safeError, " +
            "updatedAtEpochMs = :now WHERE id = :id AND status = 'running'"
    )
    suspend fun markFailed(id: String, safeError: String, now: Long): Int

    @Query(
        "UPDATE local_jobs SET status = 'cancelled', updatedAtEpochMs = :now " +
            "WHERE id = :id AND status IN ('queued', 'running', 'retryable')"
    )
    suspend fun markCancelled(id: String, now: Long): Int
}
