package au.datacube.app.data.rag

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.File
import java.security.MessageDigest
import java.util.Locale
import java.util.PriorityQueue
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

data class IndexedPassage(
    val text: String,
    val page: Int?,
    val ordinal: Int,
    val score: Int
)

internal data class PassageIndexSnapshot(val sourceHash: String, val count: Int)
internal data class PassageIndexRow(val rowId: Long, val passage: IndexedPassage)

/**
 * Persistent on-device FTS4 passage store. This deliberately lives in a
 * separate SQLite database so no existing Room schema/data migration changes.
 * The full extracted source is streamed, not the first 48k/240k characters.
 * Data stays in app-private storage and no AI model is needed to build it.
 */
class LocalPassageIndex(context: Context) :
    SQLiteOpenHelper(context.applicationContext, DB_NAME, null, 2) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS indexed_documents (" +
                "documentId TEXT PRIMARY KEY NOT NULL, sourceBytes INTEGER NOT NULL," +
                "sourceModified INTEGER NOT NULL, sourceSha256 TEXT NOT NULL," +
                "passageCount INTEGER NOT NULL, indexVersion INTEGER NOT NULL DEFAULT 1)"
        )
        db.execSQL(
            "CREATE VIRTUAL TABLE IF NOT EXISTS passages USING fts4(" +
                "documentId, ordinal, page, body, " +
                "notindexed=documentId, notindexed=ordinal, notindexed=page, tokenize=unicode61)"
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion == 1 && newVersion == 2) {
            // Keep existing indexes available for rollback; rebuild lazily from extracted text.
            db.execSQL("ALTER TABLE indexed_documents ADD COLUMN indexVersion INTEGER NOT NULL DEFAULT 1")
        } else check(oldVersion == newVersion) { "Unsupported search-index schema upgrade." }
    }

    fun hasCurrent(documentId: String, source: File): Boolean {
        if (!validId(documentId) || !source.isFile || source.length() <= 0L) return false
        readableDatabase.rawQuery(
            "SELECT sourceBytes, sourceModified, passageCount, indexVersion FROM indexed_documents WHERE documentId = ?",
            arrayOf(documentId)
        ).use { cursor ->
            return cursor.moveToFirst() &&
                cursor.getLong(0) == source.length() &&
                cursor.getLong(1) == source.lastModified() &&
                cursor.getInt(2) > 0 && cursor.getInt(3) == INDEX_VERSION
        }
    }

    suspend fun build(
        documentId: String,
        source: File,
        onProgress: (Int) -> Unit = {}
    ): Int {
        require(validId(documentId)) { "Invalid document ID." }
        require(source.isFile && source.length() in 1L..MAX_SOURCE_BYTES) {
            "The extracted document is too large or not available for indexing."
        }
        val bytes = source.length()
        val modified = source.lastModified()
        val hash = hashFile(source)
        // Android SQLite transactions are thread-affine: do not suspend once begun.
        val indexingContext = currentCoroutineContext()
        indexingContext.ensureActive()
        if (hasCurrent(documentId, source) && hasMatchingHash(documentId, hash)) {
            return passageCount(documentId)
        }

        val db = writableDatabase
        var publishedCount = 0
        db.beginTransactionNonExclusive()
        try {
            db.execSQL("DELETE FROM passages WHERE documentId = ?", arrayOf(documentId))
            db.execSQL("DELETE FROM indexed_documents WHERE documentId = ?", arrayOf(documentId))

            val insert = db.compileStatement(
                "INSERT INTO passages(documentId, ordinal, page, body) VALUES (?, ?, ?, ?)"
            )
            val marker = Regex("""^----- Page (\d+) -----$""")
            val whitespace = Regex("""\s+""")
            val buffer = StringBuilder()
            var page: Int? = null
            var ordinal = 0
            var overlapPrefix = 0

            fun publish(text: String) {
                val cleaned = text.trim()
                if (cleaned.isBlank()) return
                check(ordinal < MAX_PASSAGES) {
                    "This document exceeds the local search-index passage limit."
                }
                insert.clearBindings()
                insert.bindString(1, documentId)
                insert.bindLong(2, ordinal.toLong())
                if (page == null) insert.bindNull(3)
                else insert.bindLong(3, page!!.toLong())
                insert.bindString(4, cleaned)
                insert.executeInsert()
                ordinal += 1
                if (ordinal % 100 == 0) {
                    indexingContext.ensureActive()
                    onProgress(ordinal)
                }
            }

            fun flush(finishPage: Boolean) {
                while (buffer.length >= TARGET_CHARS) {
                    var end = TARGET_CHARS
                    val space = buffer.lastIndexOf(' ', TARGET_CHARS)
                    if (space > TARGET_CHARS / 2) end = space
                    publish(buffer.substring(0, end))
                    buffer.delete(0, (end - OVERLAP_CHARS).coerceAtLeast(1))
                    overlapPrefix = minOf(OVERLAP_CHARS, buffer.length)
                }
                if (finishPage) {
                    if (buffer.length > overlapPrefix) {
                        publish(buffer.toString())
                    }
                    buffer.setLength(0)
                    overlapPrefix = 0
                }
            }

            fun acceptTextLine(raw: String) {
                val text = raw.trim()
                val found = marker.matchEntire(text)
                if (found != null) {
                    flush(true)
                    page = found.groupValues[1].toIntOrNull()
                    return
                }
                if (text.isBlank()) return
                if (buffer.isNotEmpty()) buffer.append(' ')
                buffer.append(text.replace(whitespace, " "))
                flush(false)
            }

            // Never allocate a whole unbounded line: some extracted PDFs contain
            // enormous newline-free text streams.
            source.bufferedReader(Charsets.UTF_8).use { reader ->
                val block = CharArray(4096)
                val line = StringBuilder(4096)
                while (true) {
                    indexingContext.ensureActive()
                    val read = reader.read(block)
                    if (read < 0) break
                    for (i in 0 until read) {
                        when (val ch = block[i]) {
                            '\n' -> {
                                acceptTextLine(line.toString())
                                line.setLength(0)
                            }
                            '\r' -> Unit
                            else -> {
                                line.append(ch)
                                if (line.length >= 4096) {
                                    acceptTextLine(line.toString())
                                    line.setLength(0)
                                }
                            }
                        }
                    }
                }
                if (line.isNotEmpty()) acceptTextLine(line.toString())
            }
            flush(true)
            check(ordinal > 0) { "No readable passages found for indexing." }
            check(source.length() == bytes && source.lastModified() == modified) {
                "Document changed while the search index was being built."
            }
            db.execSQL(
                "INSERT INTO indexed_documents (documentId, sourceBytes, sourceModified, sourceSha256, passageCount, indexVersion)" +
                    " VALUES (?, ?, ?, ?, ?, ?)",
                arrayOf<Any>(documentId, bytes, modified, hash, ordinal, INDEX_VERSION)
            )
            indexingContext.ensureActive()
            db.setTransactionSuccessful()
            publishedCount = ordinal
        } finally {
            db.endTransaction()
        }
        // Completion runs only after the transaction has committed and closed.
        onProgress(publishedCount)
        return publishedCount
    }

    /** Embeddings consume the complete, committed lexical index in bounded pages. */
    internal fun snapshot(documentId: String, source: File): PassageIndexSnapshot? {
        if (!hasCurrent(documentId, source)) return null
        return readableDatabase.rawQuery(
            "SELECT sourceSha256, passageCount FROM indexed_documents WHERE documentId = ?",
            arrayOf(documentId)
        ).use { cursor ->
            if (cursor.moveToFirst()) PassageIndexSnapshot(cursor.getString(0), cursor.getInt(1)) else null
        }
    }

    internal fun rowIdForOrdinal(documentId: String, ordinal: Int): Long? =
        readableDatabase.rawQuery(
            "SELECT rowid FROM passages WHERE documentId = ? AND CAST(ordinal AS INTEGER) = CAST(? AS INTEGER) LIMIT 1",
            arrayOf(documentId, ordinal.toString())
        ).use { if (it.moveToFirst()) it.getLong(0) else null }

    internal fun batchAfter(documentId: String, after: Long, limit: Int = 64): List<PassageIndexRow> {
        require(validId(documentId) && limit in 1..128)
        return readableDatabase.rawQuery(
            "SELECT rowid, ordinal, page, body FROM passages WHERE documentId = ? AND rowid > ? ORDER BY rowid LIMIT ?",
            arrayOf(documentId, after.toString(), limit.toString())
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    add(PassageIndexRow(cursor.getLong(0), IndexedPassage(cursor.getString(3),
                        cursor.getString(2)?.toIntOrNull(), cursor.getString(1).toInt(), 0)))
                }
            }
        }
    }

    suspend fun search(documentId: String, question: String, source: File, limit: Int = 5): List<IndexedPassage> {
        require(limit in 1..12)
        if (!hasCurrent(documentId, source)) return emptyList()
        val terms = keywords(question)
        if (terms.isEmpty()) return emptyList()
        val expression = terms.joinToString(" OR ") { "\"" + it + "\"" }
        val termSet = terms.toSet()
        // No arbitrary first-400 cutoff: rank all matching candidates, retain only top K.
        val best = PriorityQueue<IndexedPassage>(
            compareBy<IndexedPassage> { it.score }.thenByDescending { it.ordinal }
        )
        val cancellation = currentCoroutineContext()
        readableDatabase.rawQuery(
            "SELECT ordinal, page, body FROM passages WHERE documentId = ? AND passages MATCH ?",
            arrayOf(documentId, expression)
        ).use { cursor ->
            while (cursor.moveToNext()) {
                cancellation.ensureActive()
                val ordinal = cursor.getString(0).toIntOrNull() ?: continue
                val page = cursor.getString(1)?.toIntOrNull()
                val text = cursor.getString(2) ?: continue
                val frequency = mutableMapOf<String, Int>()
                termRegex.findAll(text.lowercase(Locale.ROOT)).forEach { match ->
                    val token = match.value
                    if (token in termSet) frequency[token] = minOf(5, (frequency[token] ?: 0) + 1)
                }
                // Exact token coverage dominates repeated keyword frequency.
                val score = frequency.size * 10 + frequency.values.sum()
                if (score <= 0) continue
                val hit = IndexedPassage(text, page, ordinal, score)
                val weakest = best.peek()
                if (best.size < limit) best.add(hit)
                else if (weakest != null && (score > weakest.score ||
                        (score == weakest.score && ordinal < weakest.ordinal))) {
                    best.poll()
                    best.add(hit)
                }
            }
        }
        return best.sortedWith(compareByDescending<IndexedPassage> { it.score }.thenBy { it.ordinal })
    }

    /** Representative start/middle/end passages for grounded overviews. */
    fun overview(documentId: String, source: File, limit: Int = 8): List<IndexedPassage> {
        require(limit in 1..12)
        if (!hasCurrent(documentId, source)) return emptyList()
        val count = passageCount(documentId)
        val desired = minOf(limit, count)
        if (desired <= 0) return emptyList()
        val result = mutableListOf<IndexedPassage>()
        for (i in 0 until desired) {
            val position = if (desired == 1) 0 else (count - 1) * i / (desired - 1)
            readableDatabase.rawQuery(
                "SELECT ordinal, page, body FROM passages WHERE documentId = ? ORDER BY rowid LIMIT 1 OFFSET ?",
                arrayOf(documentId, position.toString())
            ).use { cursor ->
                if (cursor.moveToFirst()) {
                    result += IndexedPassage(
                        text = cursor.getString(2),
                        page = cursor.getString(1)?.toIntOrNull(),
                        ordinal = cursor.getString(0).toIntOrNull() ?: position,
                        score = 0
                    )
                }
            }
        }
        return result
    }

    fun remove(documentId: String) {
        if (!validId(documentId)) return
        writableDatabase.beginTransaction()
        try {
            writableDatabase.execSQL("DELETE FROM passages WHERE documentId = ?", arrayOf(documentId))
            writableDatabase.execSQL("DELETE FROM indexed_documents WHERE documentId = ?", arrayOf(documentId))
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    private fun hasMatchingHash(documentId: String, hash: String): Boolean =
        readableDatabase.rawQuery(
            "SELECT sourceSha256 FROM indexed_documents WHERE documentId = ?", arrayOf(documentId)
        ).use { it.moveToFirst() && it.getString(0) == hash }

    private fun passageCount(documentId: String): Int =
        readableDatabase.rawQuery(
            "SELECT passageCount FROM indexed_documents WHERE documentId = ?", arrayOf(documentId)
        ).use { if (it.moveToFirst()) it.getInt(0) else 0 }

    private suspend fun hashFile(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val block = ByteArray(64 * 1024)
            while (true) {
                currentCoroutineContext().ensureActive()
                val count = input.read(block)
                if (count < 0) break
                digest.update(block, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    companion object {
        private const val DB_NAME = "datacube-passages.db"
        private const val INDEX_VERSION = 2
        private const val TARGET_CHARS = 800
        private const val OVERLAP_CHARS = 120
        private const val MAX_PASSAGES = 400_000
        private const val MAX_SOURCE_BYTES = 100L * 1024 * 1024
        private val termRegex = Regex("""[\p{L}\p{N}]{2,}""")
        private val stopWords = setOf(
            "this", "that", "the", "and", "for", "from", "with", "what", "where",
            "does", "could", "would", "should", "your", "about", "please",
            "document", "documents", "explain", "summarize", "are", "you",
            "is", "it", "of", "to", "in", "on", "as", "at", "be", "by", "an", "or", "do", "me", "how", "why"
        )

        private fun validId(id: String): Boolean =
            id.matches(Regex("[A-Za-z0-9_-]{1,80}"))

        internal fun keywords(question: String): List<String> =
            termRegex.findAll(question.lowercase(Locale.ROOT))
                .map { it.value }.filter { it !in stopWords }
                .distinct().take(8).toList()
    }
}
