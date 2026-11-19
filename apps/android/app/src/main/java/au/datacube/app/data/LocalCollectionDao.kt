package au.datacube.app.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface LocalCollectionDao {
    @Query("""
        SELECT c.id, c.name, c.description, c.createdAtEpochMs, c.updatedAtEpochMs,
               COUNT(cd.documentId) AS documentCount
        FROM local_collections c
        LEFT JOIN local_collection_documents cd ON cd.collectionId = c.id
        GROUP BY c.id
        ORDER BY c.updatedAtEpochMs DESC
    """)
    fun observeAllWithCount(): Flow<List<LocalCollectionWithCount>>

    @Query("""
        SELECT d.* FROM local_documents d
        INNER JOIN local_collection_documents cd ON cd.documentId = d.id
        WHERE cd.collectionId = :collectionId
        ORDER BY d.createdAtEpochMs DESC
    """)
    fun observeDocuments(collectionId: String): Flow<List<LocalDocument>>

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(collection: LocalCollection)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun addDocuments(memberships: List<LocalCollectionDocument>)

    @Query("SELECT * FROM local_collections WHERE id = :id LIMIT 1")
    suspend fun find(id: String): LocalCollection?

    @Query("DELETE FROM local_collection_documents WHERE collectionId = :id")
    suspend fun clearMemberships(id: String)

    @Query("DELETE FROM local_collections WHERE id = :id")
    suspend fun delete(id: String)
}
