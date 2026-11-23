package au.datacube.app.data.rag

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface SemanticChunkDao {
    @Query("SELECT * FROM local_semantic_chunks WHERE documentId = :documentId AND modelId = :modelId ORDER BY ordinal")
    suspend fun chunks(documentId: String, modelId: String): List<SemanticVectorChunk>

    // Bound the vectors loaded into Android memory while answering a query.
    @Query("SELECT * FROM local_semantic_chunks WHERE documentId = :documentId AND modelId = :modelId ORDER BY ordinal LIMIT :pageSize OFFSET :offset")
    suspend fun chunkPage(documentId: String, modelId: String, pageSize: Int, offset: Int): List<SemanticVectorChunk>

    @Query("SELECT sourceHash FROM local_semantic_chunks WHERE documentId = :documentId AND modelId = :modelId LIMIT 1")
    suspend fun sourceHash(documentId: String, modelId: String): String?

    @Query("DELETE FROM local_semantic_chunks WHERE documentId = :documentId AND modelId = :modelId")
    suspend fun clear(documentId: String, modelId: String)

    @Query("DELETE FROM local_semantic_chunks WHERE documentId = :documentId")
    suspend fun clearDocument(documentId: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(chunks: List<SemanticVectorChunk>)
}
