package au.datacube.app.data
import androidx.room.Entity
import androidx.room.PrimaryKey
@Entity(tableName = "local_documents")
data class LocalDocument(
 @PrimaryKey val id: String,
 val name: String,
 val extension: String,
 val mimeType: String,
 val sizeBytes: Long,
 val privatePath: String,
 val createdAtEpochMs: Long
)
