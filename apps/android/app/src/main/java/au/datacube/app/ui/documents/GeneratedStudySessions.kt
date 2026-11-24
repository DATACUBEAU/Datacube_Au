package au.datacube.app.ui.documents

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import au.datacube.app.data.ExtractedTextStore
import au.datacube.app.data.PdfDocumentTextExtractor
import au.datacube.app.data.PlainTextDocumentExtractor
import au.datacube.app.data.rag.GroundedRagPlanner
import au.datacube.app.data.rag.LocalGenerativeEngine
import au.datacube.app.data.rag.LocalPassageIndex
import au.datacube.app.data.rag.ModelOutputCleaner
import au.datacube.app.data.rag.RagEvidence
import au.datacube.app.data.rag.RagTextChunker
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.os.SystemClock

enum class GeneratedStudyMode { NOTES, REVISION }
internal data class GeneratedStudySection(val topic: String, val details: String)

/** Only represent sections actually emitted by AU; no fabricated concepts. */
internal object GeneratedStudySectionParser {
    fun parse(text: String): List<GeneratedStudySection> {
        if (text.isBlank()) return emptyList()
        val marker = Regex("""(?im)^(?:#{1,3}\s*)?(?:TOPIC|PRIORITY):\s*(.+?)\s*$""")
        val matches = marker.findAll(text).toList()
        if (matches.isEmpty()) {
            return text.split(Regex("""\n\s*\n"""))
                .map { it.trim() }.filter { it.isNotEmpty() }
                .take(12).mapIndexed { index, paragraph ->
                    GeneratedStudySection(
                        "Section ${index + 1}",
                        paragraph.take(1_800)
                    )
                }
        }
        return matches.take(12).mapIndexed { index, match ->
            val nextStart = matches.getOrNull(index + 1)?.range?.first ?: text.length
            GeneratedStudySection(
                topic = match.groupValues[1].trim().take(110),
                details = text.substring(match.range.last + 1, nextStart).trim().take(2_400)
            )
        }
    }
}

class GeneratedStudySession {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var generation: Job? = null
    var response by mutableStateOf("")
        private set
    var working by mutableStateOf(false)
        private set
    var stage by mutableStateOf("")
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var sources by mutableStateOf<List<SourceSnippet>>(emptyList())
        private set
    var attachmentLabel by mutableStateOf<String?>(null)
        private set
    var attachmentText by mutableStateOf<String?>(null)
        private set
    var attaching by mutableStateOf(false)
        private set

    fun generate(
        context: Context, documentId: String, documentName: String,
        textPreview: String, mode: GeneratedStudyMode
    ) {
        if (working || !LocalGenerativeEngine.installed(context)) {
            if (!working) error = "Select an installed AU model in Models to generate content."
            return
        }
        generation?.cancel()
        val app = context.applicationContext
        working = true
        error = null
        stage = "Preparing verified passages"
        response = ""
        sources = emptyList()
        val attached = attachmentText
        generation = scope.launch {
            try {
                val excerpts = runCatching {
                    val index = LocalPassageIndex(app)
                    try {
                        val source = ExtractedTextStore.fileFor(app.filesDir, documentId)
                        index.overview(documentId, source, limit = 10).map { passage ->
                            SourceSnippet(passage.text, passage.page)
                        }
                    } finally {
                        index.close()
                    }
                }.getOrDefault(emptyList()).ifEmpty {
                    RagTextChunker(maxChunks = 40)
                        .chunk(documentId, textPreview.take(240_000))
                        .take(10).map { SourceSnippet(it.text, it.page) }
                }
                require(excerpts.isNotEmpty()) {
                    "No readable evidence is available yet. Finish document processing first."
                }
                sources = excerpts
                val task = if (mode == GeneratedStudyMode.NOTES) {
                    "Create structured, detailed study notes from the provided document evidence. " +
                        "Use 4-8 sections in this exact format: TOPIC: short name, followed by " +
                        "2-5 clear sentences explaining what the source actually says and a concise " +
                        "example only when the evidence supports it. Avoid repeated disclaimers. " +
                        "Do not invent source citations, facts or topics."
                } else {
                    "Generate a revision forecast and realistic practice questions from the provided " +
                        "document evidence. This is NOT a prediction of actual examination questions. " +
                        "Use 4-8 sections, each starting PRIORITY: topic name, followed by what " +
                        "to revise, one practice question, and why its source passage is relevant. " +
                        "Use any additional user-attached reference as distinct evidence. " +
                        "Do not claim exam probabilities or fabricate missing facts."
                }
                val grounded = GroundedRagPlanner.build(
                    task, emptyList(), excerpts.map { RagEvidence(it.text, it.page) }
                )
                val prompt = grounded.value +
                    if (mode == GeneratedStudyMode.REVISION && !attached.isNullOrBlank()) {
                        "\n\nADDITIONAL USER-ATTACHED REFERENCE (separate from main document):\n" +
                            attached.take(12_000)
                    } else ""
                withContext(Dispatchers.Main) { stage = "AU is generating" }
                val answer = StringBuilder()
                var last = 0L
                LocalGenerativeEngine.generate(app, prompt.take(19_000)) { chunk ->
                    answer.append(chunk)
                    val now = SystemClock.elapsedRealtime()
                    if (now - last >= 120) {
                        val shown = ModelOutputCleaner.visible(answer.toString(), excerpts.size).take(16_000)
                        withContext(Dispatchers.Main) { response = shown }
                        last = now
                    }
                }
                val complete = ModelOutputCleaner.visible(answer.toString(), excerpts.size).trim()
                check(complete.isNotBlank()) { "AU did not produce readable study content." }
                withContext(Dispatchers.Main) {
                    response = complete.take(18_000)
                    stage = "Completed with source evidence"
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                withContext(Dispatchers.Main) {
                    error = failure.message ?: "AU could not generate study content."
                }
            } finally {
                withContext(Dispatchers.Main) { working = false }
            }
        }
    }

    fun stop() {
        generation?.cancel()
        working = false
        stage = "Stopped"
    }

    /** Optional PDF/TXT/MD attachment, chosen explicitly by the user. */
    fun attach(context: Context, uri: Uri) {
        if (attaching || working) return
        attaching = true
        error = null
        scope.launch {
            val app = context.applicationContext
            val workDir = File(app.cacheDir, "study-references")
            val id = UUID.randomUUID().toString()
            var original: File? = null
            var extracted: File? = null
            try {
                require(uri.scheme == "content") { "Use Android's file picker to attach a document." }
                val label = app.contentResolver.query(
                    uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
                )?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                } ?: "Additional reference"
                val extension = label.substringAfterLast('.', "").lowercase()
                require(extension in setOf("pdf", "txt", "md")) {
                    "Only PDF, TXT and Markdown reference files are supported."
                }
                check(workDir.isDirectory || workDir.mkdirs())
                original = File(workDir, "$id.$extension")
                extracted = File(workDir, "$id.txt")
                val maxBytes = if (extension == "pdf") 30L * 1024 * 1024
                    else 20L * 1024 * 1024
                val input = app.contentResolver.openInputStream(uri)
                    ?: error("Could not open attached reference.")
                var copied = 0L
                input.use { source ->
                    original!!.outputStream().buffered().use { output ->
                        val chunk = ByteArray(64 * 1024)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val count = source.read(chunk)
                            if (count < 0) break
                            copied += count
                            require(copied <= maxBytes) { "The reference file is too large." }
                            output.write(chunk, 0, count)
                        }
                    }
                }
                require(copied > 0) { "The reference file is empty." }
                val extractor = if (extension == "pdf")
                    PdfDocumentTextExtractor() else PlainTextDocumentExtractor()
                extractor.extract(original!!, extracted!!) { }
                val chars = CharArray(20_000)
                val read = extracted!!.bufferedReader().use { it.read(chars) }
                require(read > 40) { "The attachment has too little readable text." }
                withContext(Dispatchers.Main) {
                    attachmentLabel = label.take(90)
                    attachmentText = String(chars, 0, read)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                withContext(Dispatchers.Main) {
                    error = failure.message ?: "Could not read the additional reference."
                }
            } finally {
                original?.delete()
                extracted?.delete()
                withContext(Dispatchers.Main) { attaching = false }
            }
        }
    }
    fun removeAttachment() {
        if (working || attaching) return
        attachmentText = null
        attachmentLabel = null
    }
}

/** Session state survives switching between tools while the Android process remains alive. */
object GeneratedStudySessions {
    private val active = linkedMapOf<String, GeneratedStudySession>()
    @Synchronized fun get(documentId: String, mode: GeneratedStudyMode): GeneratedStudySession {
        val key = "$documentId:${mode.name}"
        return active.getOrPut(key) { GeneratedStudySession() }
    }
    @Synchronized fun clear(documentId: String) {
        active.keys.filter { it.startsWith("$documentId:") }.forEach { key ->
            active.remove(key)?.stop()
        }
    }
}
