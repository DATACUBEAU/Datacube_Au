package au.datacube.app.data
import androidx.room.*
import kotlinx.coroutines.flow.Flow
@Dao interface LocalDocumentDao {
 @Query("SELECT * FROM local_documents ORDER BY createdAtEpochMs DESC") fun observeAll(): Flow<List<LocalDocument>>
 @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun insert(item: LocalDocument)
 @Query("SELECT * FROM local_documents WHERE id = :id LIMIT 1") suspend fun find(id: String): LocalDocument?
 @Query("DELETE FROM local_documents WHERE id = :id") suspend fun delete(id: String)
}
