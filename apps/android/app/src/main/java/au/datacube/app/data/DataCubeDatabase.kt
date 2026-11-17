package au.datacube.app.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [LocalDocument::class, LocalJob::class],
    version = 2,
    exportSchema = true
)
abstract class DataCubeDatabase : RoomDatabase() {
    abstract fun documents(): LocalDocumentDao
    abstract fun jobs(): LocalJobDao

    companion object {
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("ALTER TABLE local_documents ADD COLUMN sha256 TEXT")
                database.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS local_jobs (
                        id TEXT NOT NULL,
                        kind TEXT NOT NULL,
                        status TEXT NOT NULL,
                        payloadJson TEXT NOT NULL,
                        progress REAL NOT NULL,
                        attempts INTEGER NOT NULL,
                        createdAtEpochMs INTEGER NOT NULL,
                        updatedAtEpochMs INTEGER NOT NULL,
                        lastError TEXT,
                        PRIMARY KEY(id)
                    )
                    """.trimIndent()
                )
                database.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_local_jobs_status_createdAtEpochMs " +
                        "ON local_jobs (status, createdAtEpochMs)"
                )
            }
        }

        @Volatile
        private var instance: DataCubeDatabase? = null

        fun get(context: Context): DataCubeDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    DataCubeDatabase::class.java,
                    "datacube-local.db"
                )
                    .addMigrations(MIGRATION_1_2)
                    .build()
                    .also { instance = it }
            }
    }
}
