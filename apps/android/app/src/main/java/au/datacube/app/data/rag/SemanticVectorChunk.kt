package au.datacube.app.data.rag

import androidx.room.Entity
import androidx.room.Index
import androidx.room.ForeignKey
import au.datacube.app.data.LocalDocument

/** Versioned local vector data. Query and document vectors must share the same model. */
@Entity(
    tableName = "local_semantic_chunks",
    primaryKeys = ["documentId", "modelId", "ordinal"],
    indices = [Index(value = ["documentId", "modelId"])],
    foreignKeys = [ForeignKey(entity = LocalDocument::class, parentColumns = ["id"], childColumns = ["documentId"], onDelete = ForeignKey.CASCADE)]
)
data class SemanticVectorChunk(
    val documentId: String,
    val modelId: String,
    val ordinal: Int,
    val page: Int?,
    val text: String,
    val sourceHash: String,
    val dimension: Int,
    val vectorBytes: ByteArray
)
