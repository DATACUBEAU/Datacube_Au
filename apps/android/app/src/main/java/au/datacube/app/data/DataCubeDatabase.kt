package au.datacube.app.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import au.datacube.app.data.rag.SemanticVectorChunk
import au.datacube.app.data.rag.SemanticChunkDao
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [LocalDocument::class, LocalJob::class, LocalCollection::class, LocalCollectionDocument::class, SemanticVectorChunk::class],
    version = 4,
    exportSchema = true
)
abstract class DataCubeDatabase : RoomDatabase() {
    abstract fun documents(): LocalDocumentDao
    abstract fun jobs(): LocalJobDao
    abstract fun collections(): LocalCollectionDao
    abstract fun semanticChunks(): SemanticChunkDao

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

        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("""
                    CREATE TABLE IF NOT EXISTS local_collections (
                        id TEXT NOT NULL PRIMARY KEY,
                        name TEXT NOT NULL,
                        description TEXT NOT NULL,
                        createdAtEpochMs INTEGER NOT NULL,
                        updatedAtEpochMs INTEGER NOT NULL
                    )
                """.trimIndent())
                database.execSQL("CREATE INDEX IF NOT EXISTS index_local_collections_createdAtEpochMs ON local_collections (createdAtEpochMs)")
                database.execSQL("""
                    CREATE TABLE IF NOT EXISTS local_collection_documents (
                        collectionId TEXT NOT NULL,
                        documentId TEXT NOT NULL,
                        addedAtEpochMs INTEGER NOT NULL,
                        PRIMARY KEY(collectionId, documentId),
                        FOREIGN KEY(collectionId) REFERENCES local_collections(id) ON DELETE CASCADE,
                        FOREIGN KEY(documentId) REFERENCES local_documents(id) ON DELETE CASCADE
                    )
                """.trimIndent())
                database.execSQL("CREATE INDEX IF NOT EXISTS index_local_collection_documents_documentId ON local_collection_documents (documentId)")
            }
        }

        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("""
                    CREATE TABLE IF NOT EXISTS local_semantic_chunks (
                        documentId TEXT NOT NULL,
                        modelId TEXT NOT NULL,
                        ordinal INTEGER NOT NULL,
                        page INTEGER,
                        text TEXT NOT NULL,
                        sourceHash TEXT NOT NULL,
                        dimension INTEGER NOT NULL,
                        vectorBytes BLOB NOT NULL,
                        PRIMARY KEY(documentId, modelId, ordinal),
                        FOREIGN KEY(documentId) REFERENCES local_documents(id) ON DELETE CASCADE
                    )
                """.trimIndent())
                database.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_local_semantic_chunks_documentId_modelId " +
                        "ON local_semantic_chunks(documentId, modelId)"
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
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
                    .build()
                    .also { instance = it }
            }
    }
}
