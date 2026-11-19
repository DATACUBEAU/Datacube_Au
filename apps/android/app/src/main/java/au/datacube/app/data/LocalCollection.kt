package au.datacube.app.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.ForeignKey
import androidx.room.PrimaryKey

@Entity(tableName = "local_collections", indices = [Index("createdAtEpochMs")])
data class LocalCollection(
    @PrimaryKey val id: String,
    val name: String,
    val description: String = "",
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long
)

@Entity(
    tableName = "local_collection_documents",
    primaryKeys = ["collectionId", "documentId"],
    foreignKeys = [
        ForeignKey(entity = LocalCollection::class, parentColumns = ["id"], childColumns = ["collectionId"], onDelete = ForeignKey.CASCADE),
        ForeignKey(entity = LocalDocument::class, parentColumns = ["id"], childColumns = ["documentId"], onDelete = ForeignKey.CASCADE)
    ],
    indices = [Index("documentId")]
)
data class LocalCollectionDocument(
    val collectionId: String,
    val documentId: String,
    val addedAtEpochMs: Long
)

data class LocalCollectionWithCount(
    val id: String,
    val name: String,
    val description: String,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long,
    val documentCount: Int
)
