package au.datacube.app.ui.chat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import au.datacube.app.data.PdfDocumentTextExtractor
import au.datacube.app.data.PlainTextDocumentExtractor
import java.io.ByteArrayOutputStream
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal sealed interface GistAttachment {
    val label: String
    data class Photo(override val label: String, val bytes: ByteArray) : GistAttachment
    data class Document(override val label: String, val excerpt: String, val truncated: Boolean) : GistAttachment
}

/** The picker is explicit, local-only, and does not import attachments into the library. */
@Composable
internal fun GistAttachmentMenu(
    enabled: Boolean,
    supportsImages: Boolean,
    onPreparing: (Boolean) -> Unit,
    onAttachment: (GistAttachment) -> Unit,
    onError: (String) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var expanded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val latestEnabled by rememberUpdatedState(enabled)
    val latestSupportsImages by rememberUpdatedState(supportsImages)
    val latestAttachment by rememberUpdatedState(onAttachment)
    val latestError by rememberUpdatedState(onError)
    val latestPreparing by rememberUpdatedState(onPreparing)

    fun prepare(image: Boolean = false, load: suspend () -> GistAttachment) {
        if (busy || !latestEnabled || (image && !latestSupportsImages)) return
        busy = true
        latestPreparing(true)
        scope.launch {
            try {
                val attachment = withContext(Dispatchers.IO) { load() }
                currentCoroutineContext().ensureActive()
                latestAttachment(attachment)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                latestError("Could not prepare this attachment. Choose a readable PDF, TXT, Markdown or image file.")
            } finally {
                busy = false
                latestPreparing(false)
            }
        }
    }

    val document = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) prepare { readDocument(context, uri) }
    }
    val image = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) prepare(image = true) { readPhoto(context, uri) }
    }
    // TakePicturePreview avoids broad storage permissions and supplies a small camera bitmap.
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        if (bitmap != null) prepare(image = true) { GistAttachment.Photo("Camera photo", encodePhoto(bitmap)) }
    }
    Box {
        IconButton(onClick = { expanded = true }, enabled = enabled && !busy) {
            Icon(Icons.Outlined.Add, contentDescription = "Add attachment")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(text = { Text("Attach file") }, onClick = {
                expanded = false
                try { document.launch(arrayOf("application/pdf", "text/plain", "text/markdown")) }
                catch (_: Exception) { latestError("No file picker available.") }
            })
            DropdownMenuItem(text = { Text("Choose image") }, enabled = supportsImages, onClick = {
                expanded = false
                try { image.launch("image/*") } catch (_: Exception) { latestError("No image picker available.") }
            })
            DropdownMenuItem(text = { Text("Take photo (preview)") }, enabled = supportsImages, onClick = {
                expanded = false
                try { camera.launch(null) } catch (_: Exception) { latestError("Camera unavailable. Choose an image instead.") }
            })
            if (!supportsImages) {
                Text("Images require Gemma 4 E2B or E4B", style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(12.dp))
            }
        }
    }
}

private fun name(context: Context, uri: Uri, fallback: String): String =
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) it.getString(0) else null
    }?.filterNot { it.isISOControl() }?.take(100)?.ifBlank { fallback } ?: fallback

private suspend fun copyBounded(context: Context, uri: Uri, file: File, max: Long) {
    require(uri.scheme == "content")
    val stream = context.contentResolver.openInputStream(uri) ?: error("Unreadable attachment")
    stream.use { input ->
        file.outputStream().buffered().use { out ->
            val buffer = ByteArray(32 * 1024)
            var total = 0L
            while (true) {
                currentCoroutineContext().ensureActive()
                val n = input.read(buffer)
                if (n < 0) break
                total += n
                require(total <= max)
                out.write(buffer, 0, n)
            }
            require(total > 0)
        }
    }
}

private suspend fun readDocument(context: Context, uri: Uri): GistAttachment.Document {
    val label = name(context, uri, "Attached file")
    val mime = context.contentResolver.getType(uri)
    val pdf = mime == "application/pdf" || label.endsWith(".pdf", ignoreCase = true)
    require(pdf || mime in setOf("text/plain", "text/markdown") ||
        label.endsWith(".txt", true) || label.endsWith(".md", true))
    val source = File.createTempFile("gist-input-", if (pdf) ".pdf" else ".txt", context.cacheDir)
    val extracted = File(source.path + ".extracted")
    try {
        copyBounded(context, uri, source, 12L * 1024 * 1024)
        val extractor = if (pdf) PdfDocumentTextExtractor() else PlainTextDocumentExtractor()
        extractor.extract(source, extracted) {}
        val excerpt = extracted.bufferedReader().use { reader ->
            val out = StringBuilder()
            val buffer = CharArray(4096)
            while (out.length < 6001) {
                currentCoroutineContext().ensureActive()
                val n = reader.read(buffer, 0, minOf(buffer.size, 6001 - out.length))
                if (n < 0) break
                out.append(buffer, 0, n)
            }
            out.toString()
        }
        require(excerpt.isNotBlank())
        return GistAttachment.Document(label, excerpt.take(6000), excerpt.length > 6000)
    } finally {
        source.delete()
        extracted.delete()
    }
}

private suspend fun readPhoto(context: Context, uri: Uri): GistAttachment.Photo {
    val label = name(context, uri, "Attached image")
    val source = File.createTempFile("gist-photo-", ".image", context.cacheDir)
    try {
        copyBounded(context, uri, source, 16L * 1024 * 1024)
        val bitmap = if (Build.VERSION.SDK_INT >= 28) {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(source)) { decoder, info, _ ->
                val size = info.size
                require(size.width > 0 && size.height > 0)
                val ratio = minOf(1.0, 1024.0 / maxOf(size.width, size.height))
                decoder.setTargetSize(maxOf(1, (size.width * ratio).toInt()), maxOf(1, (size.height * ratio).toInt()))
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } else {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(source.path, bounds)
            require(bounds.outWidth > 0 && bounds.outHeight > 0)
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1024) sample *= 2
            BitmapFactory.decodeFile(source.path, BitmapFactory.Options().apply { inSampleSize = sample })
                ?: error("Unreadable image")
        }
        return GistAttachment.Photo(label, encodePhoto(bitmap))
    } finally {
        source.delete()
    }
}

private fun encodePhoto(bitmap: Bitmap): ByteArray {
    val ratio = minOf(1.0, 1024.0 / maxOf(bitmap.width, bitmap.height))
    val scaled = if (ratio < 1.0) Bitmap.createScaledBitmap(bitmap,
        maxOf(1, (bitmap.width * ratio).toInt()), maxOf(1, (bitmap.height * ratio).toInt()), true) else bitmap
    return try {
        ByteArrayOutputStream().use { out ->
            check(scaled.compress(Bitmap.CompressFormat.JPEG, 85, out))
            out.toByteArray().also { require(it.size in 1..2_000_000) }
        }
    } finally {
        if (scaled !== bitmap) scaled.recycle()
        bitmap.recycle()
    }
}
