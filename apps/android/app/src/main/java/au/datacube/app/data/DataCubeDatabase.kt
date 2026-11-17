package au.datacube.app.data
import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
@Database(entities = [LocalDocument::class], version = 1, exportSchema = true)
abstract class DataCubeDatabase : RoomDatabase() {
 abstract fun documents(): LocalDocumentDao
 companion object {
  @Volatile private var instance: DataCubeDatabase? = null
  fun get(context: Context): DataCubeDatabase = instance ?: synchronized(this) {
   instance ?: Room.databaseBuilder(context.applicationContext, DataCubeDatabase::class.java, "datacube-local.db").build().also { instance = it }
  }
 }
}
