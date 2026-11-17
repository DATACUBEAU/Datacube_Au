package au.datacube.app.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface LocalDocumentDao {
    @Query("SELECT * FROM local_documents ORDER BY createdAtEpochMs DESC")
    fun observeAll(): Flow<List<LocalDocument>>

    @Query(
        """
        SELECT d.*,
               j.status AS extractionStatus,
               j.progress AS extractionProgress,
               j.lastError AS extractionError
        FROM local_documents AS d
        LEFT JOIN local_jobs AS j ON j.id = 'text-extract-' || d.id
        ORDER BY d.createdAtEpochMs DESC
        """
    )
    fun observeAllWithProcessing(): Flow<List<LocalDocumentProcessing>>

    @Query(
        """
        SELECT d.* FROM local_documents AS d
        WHERE lower(d.extension) IN ('txt', 'md')
          AND NOT EXISTS (
              SELECT 1 FROM local_jobs AS j
              WHERE j.id = 'text-extract-' || d.id
          )
        ORDER BY d.createdAtEpochMs ASC
        """
    )
    suspend fun findTextDocumentsMissingExtraction(): List<LocalDocument>

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(item: LocalDocument)

    @Query("SELECT * FROM local_documents WHERE id = :id LIMIT 1")
    suspend fun find(id: String): LocalDocument?

    @Query("UPDATE local_documents SET sha256 = :sha256 WHERE id = :id")
    suspend fun updateSha256(id: String, sha256: String): Int

    @Query("DELETE FROM local_documents WHERE id = :id")
    suspend fun delete(id: String)
}
