package au.datacube.app.models

import android.content.Context
import android.net.Uri
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import java.util.zip.Deflater
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class ModelBackupSummary(
    val modelCount: Int,
    val fileCount: Int,
    val totalBytes: Long
)

/**
 * Exports installed on-device model files to a user-selected document and restores
 * them from that document. The backup is a portable ZIP archive, not app-private
 * storage, so a user-selected Documents, SD card, USB or cloud-provider destination
 * can survive an app uninstall.
 *
 * The model downloader must install complete models under:
 * filesDir/models/installed/<model-id>/
 * Temporary downloads must live outside that directory (for example in a sibling
 * staging/downloads directory) so incomplete files are never included in backups.
 */
class ModelBackupManager(context: Context) {
    private val appContext = context.applicationContext
    private val modelRoot = File(appContext.filesDir, "models/installed")
    private val modelsParent = File(appContext.filesDir, "models")

    suspend fun exportBackup(destination: Uri): ModelBackupSummary = withContext(Dispatchers.IO) {
        val models = installedModelFiles()
        require(models.isNotEmpty()) { "There are no installed models to back up yet." }

        val fileRecords = models.flatMap { model ->
            model.files.map { file ->
                val digest = digestFile(file)
                BackupFileRecord(
                    modelId = model.id,
                    relativePath = relativePath(model.directory, file),
                    size = digest.first,
                    sha256 = digest.second
                )
            }
        }
        require(fileRecords.size <= MAX_FILES) { "Too many model files for one backup." }
        val totalBytes = fileRecords.sumOf { it.size }
        require(totalBytes <= MAX_TOTAL_BYTES) { "The installed models exceed the supported backup size." }

        val output = appContext.contentResolver.openOutputStream(destination, "wt")
            ?: error("The selected backup destination could not be opened.")

        output.use { raw ->
            ZipOutputStream(BufferedOutputStream(raw)).use { zip ->
                zip.setLevel(Deflater.BEST_SPEED)
                val manifest = encodeManifest(fileRecords)
                zip.putNextEntry(ZipEntry(MANIFEST_NAME))
                zip.write(manifest)
                zip.closeEntry()

                for (record in fileRecords) {
                    val modelDirectory = File(modelRoot, record.modelId).canonicalFile
                    val file = File(modelDirectory, record.relativePath).canonicalFile
                    require(file.path.startsWith(modelDirectory.path + File.separator)) {
                        "A model file resolved outside its model directory."
                    }
                    require(file.isFile) { "A model file changed during backup. Try again." }

                    val entryName = archivePath(record.modelId, record.relativePath)
                    zip.putNextEntry(ZipEntry(entryName))
                    val digest = MessageDigest.getInstance("SHA-256")
                    var copied = 0L
                    FileInputStream(file).buffered().use { input ->
                        val buffer = ByteArray(BUFFER_SIZE)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            zip.write(buffer, 0, count)
                            digest.update(buffer, 0, count)
                            copied += count
                        }
                    }
                    zip.closeEntry()
                    require(copied == record.size && digest.toHex() == record.sha256) {
                        "A model file changed during backup. Try again."
                    }
                }
                zip.finish()
            }
        }

        ModelBackupSummary(
            modelCount = fileRecords.map { it.modelId }.distinct().size,
            fileCount = fileRecords.size,
            totalBytes = totalBytes
        )
    }

    suspend fun restoreBackup(source: Uri): ModelBackupSummary = withContext(Dispatchers.IO) {
        val input = appContext.contentResolver.openInputStream(source)
            ?: error("The selected model backup could not be opened.")

        modelsParent.mkdirs()
        val staging = File(modelsParent, ".restore-${UUID.randomUUID()}")
        require(staging.mkdirs()) { "Could not create temporary restore storage." }

        try {
            input.use { raw ->
                ZipInputStream(BufferedInputStream(raw)).use { zip ->
                    val first = zip.nextEntry ?: error("The selected file is empty.")
                    require(first.name == MANIFEST_NAME && !first.isDirectory) {
                        "This is not a DataCube AU model backup."
                    }
                    val manifestBytes = readEntryBounded(zip, MAX_MANIFEST_BYTES)
                    zip.closeEntry()
                    val records = decodeManifest(manifestBytes)
                    require(records.isNotEmpty()) { "The backup does not contain any model files." }
                    require(records.size <= MAX_FILES) { "The backup contains too many files." }

                    val modelIds = records.map { it.modelId }.distinct()
                    val totalExpected = records.sumOf { it.size }
                    require(totalExpected <= MAX_TOTAL_BYTES) {
                        "The backup exceeds the supported restore size."
                    }
                    modelIds.forEach { id ->
                        require(!File(modelRoot, id).exists()) {
                            "Model '$id' is already installed. Remove or rename it before restoring this backup."
                        }
                    }

                    val expectedByEntry = records.associateBy { archivePath(it.modelId, it.relativePath) }
                    require(expectedByEntry.size == records.size) { "The backup manifest contains duplicate paths." }
                    val received = HashSet<String>()
                    var restoredBytes = 0L
                    var entry = zip.nextEntry
                    while (entry != null) {
                        require(!entry.isDirectory && entry.name != MANIFEST_NAME) {
                            "The backup contains an unexpected archive entry."
                        }
                        val record = expectedByEntry[entry.name]
                            ?: error("The backup contains an unlisted file: ${entry.name}")
                        require(received.add(entry.name)) { "The backup contains a duplicate file." }

                        val target = File(staging, record.modelId + "/" + record.relativePath).canonicalFile
                        require(target.path.startsWith(staging.canonicalPath + File.separator)) {
                            "The backup contains an unsafe file path."
                        }
                        target.parentFile?.mkdirs()
                        val digest = MessageDigest.getInstance("SHA-256")
                        var copied = 0L
                        FileOutputStream(target).buffered().use { output ->
                            val buffer = ByteArray(BUFFER_SIZE)
                            while (true) {
                                val count = zip.read(buffer)
                                if (count < 0) break
                                copied += count
                                restoredBytes += count
                                require(copied <= record.size && restoredBytes <= totalExpected) {
                                    "The backup expands beyond its declared size."
                                }
                                digest.update(buffer, 0, count)
                                output.write(buffer, 0, count)
                            }
                        }
                        zip.closeEntry()
                        require(copied == record.size && digest.toHex() == record.sha256) {
                            "A model file failed its size or SHA-256 integrity check."
                        }
                        entry = zip.nextEntry
                    }

                    require(received.size == records.size) {
                        "The backup is incomplete. One or more model files are missing."
                    }

                    // Commit only after every file has passed integrity checks.
                    modelRoot.mkdirs()
                    val committed = mutableListOf<Pair<File, File>>()
                    try {
                        for (id in modelIds) {
                            val stagedModel = File(staging, id)
                            val installedModel = File(modelRoot, id)
                            require(!installedModel.exists()) {
                                "Model '$id' was installed while the backup was being restored."
                            }
                            require(stagedModel.renameTo(installedModel)) {
                                "Could not install restored model '$id'."
                            }
                            committed += installedModel to stagedModel
                        }
                    } catch (error: Exception) {
                        committed.asReversed().forEach { (installed, staged) ->
                            staged.parentFile?.mkdirs()
                            installed.renameTo(staged)
                        }
                        throw error
                    }

                    ModelBackupSummary(
                        modelCount = modelIds.size,
                        fileCount = records.size,
                        totalBytes = totalExpected
                    )
                }
            }
        } finally {
            staging.deleteRecursively()
        }
    }

    private fun installedModelFiles(): List<InstalledModel> {
        if (!modelRoot.exists()) return emptyList()
        val root = modelRoot.canonicalFile
        return modelRoot.listFiles()
            .orEmpty()
            .filter { directory ->
                directory.isDirectory &&
                    MODEL_ID.matches(directory.name) &&
                    !java.nio.file.Files.isSymbolicLink(directory.toPath())
            }
            .mapNotNull { directory ->
                val canonicalDirectory = directory.canonicalFile
                if (!canonicalDirectory.path.startsWith(root.path + File.separator)) return@mapNotNull null
                val files = directory.walkTopDown()
                    .filter { file ->
                        file.isFile &&
                            !java.nio.file.Files.isSymbolicLink(file.toPath()) &&
                            !file.name.endsWith(".part", ignoreCase = true) &&
                            !file.name.endsWith(".tmp", ignoreCase = true)
                    }
                    .onEach { file ->
                        require(file.canonicalFile.path.startsWith(canonicalDirectory.path + File.separator)) {
                            "A model contains a file outside its installation directory."
                        }
                    }
                    .toList()
                if (files.isEmpty()) null else InstalledModel(directory.name, canonicalDirectory, files)
            }
            .sortedBy { it.id }
    }

    private fun relativePath(directory: File, file: File): String {
        val base = directory.canonicalPath + File.separator
        val path = file.canonicalPath
        require(path.startsWith(base)) { "A model file resolved outside its model directory." }
        val relative = path.substring(base.length).replace(File.separatorChar, '/')
        validateRelativePath(relative)
        return relative
    }

    private fun encodeManifest(records: List<BackupFileRecord>): ByteArray {
        val builder = StringBuilder()
        builder.append("DATACUBE_MODEL_BACKUP\t")
            .append(FORMAT_VERSION)
            .append('\t')
            .append(System.currentTimeMillis())
            .append('\n')
        records.forEach { record ->
            builder.append("F\t")
                .append(encode(record.modelId))
                .append('\t')
                .append(encode(record.relativePath))
                .append('\t')
                .append(record.size)
                .append('\t')
                .append(record.sha256)
                .append('\n')
        }
        return builder.toString().toByteArray(Charsets.UTF_8)
    }

    private fun decodeManifest(bytes: ByteArray): List<BackupFileRecord> {
        val lines = bytes.toString(Charsets.UTF_8).split('\n')
        val header = lines.firstOrNull().orEmpty().split('\t')
        require(header.size == 3 && header[0] == "DATACUBE_MODEL_BACKUP" && header[1] == FORMAT_VERSION) {
            "The selected file is not a supported DataCube AU model backup."
        }
        val records = lines.drop(1).filter { it.isNotBlank() }.map { line ->
            val fields = line.split('\t')
            require(fields.size == 5 && fields[0] == "F") { "The backup manifest is malformed." }
            val modelId = decode(fields[1])
            val relativePath = decode(fields[2])
            val size = fields[3].toLongOrNull()
                ?: error("The backup manifest contains an invalid file size.")
            val hash = fields[4].lowercase()
            require(MODEL_ID.matches(modelId)) { "The backup contains an invalid model identifier." }
            validateRelativePath(relativePath)
            require(size >= 0 && size <= MAX_FILE_BYTES) { "The backup contains an unsupported file size." }
            require(SHA256.matches(hash)) { "The backup contains an invalid checksum." }
            BackupFileRecord(modelId, relativePath, size, hash)
        }
        require(records.size <= MAX_FILES) { "The backup contains too many files." }
        require(records.map { archivePath(it.modelId, it.relativePath) }.distinct().size == records.size) {
            "The backup manifest contains duplicate files."
        }
        return records
    }

    private fun readEntryBounded(input: InputStream, maxBytes: Int): ByteArray {
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            require(total <= maxBytes) { "The model backup manifest is too large." }
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun digestFile(file: File): Pair<Long, String> {
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0L
        FileInputStream(file).buffered().use { input ->
            val buffer = ByteArray(BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                size += count
                require(size <= MAX_FILE_BYTES) { "A model file exceeds the supported backup size." }
                digest.update(buffer, 0, count)
            }
        }
        return size to digest.toHex()
    }

    private fun archivePath(modelId: String, relativePath: String): String {
        require(MODEL_ID.matches(modelId))
        validateRelativePath(relativePath)
        return "models/$modelId/$relativePath"
    }

    private fun validateRelativePath(path: String) {
        require(path.isNotBlank() && path.length <= MAX_PATH_LENGTH && !path.startsWith('/') && !path.contains('\\')) {
            "The backup contains an invalid model file path."
        }
        val segments = path.split('/')
        require(segments.all { segment ->
            segment.isNotBlank() && segment != "." && segment != ".." &&
                segment.none { it.code < 0x20 || it.code == 0x7f }
        }) { "The backup contains an unsafe model file path." }
    }

    private fun encode(value: String): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(value.toByteArray(Charsets.UTF_8))

    private fun decode(value: String): String = try {
        String(Base64.getUrlDecoder().decode(value), Charsets.UTF_8)
    } catch (_: IllegalArgumentException) {
        error("The backup manifest contains invalid encoded data.")
    }

    private data class InstalledModel(
        val id: String,
        val directory: File,
        val files: List<File>
    )

    private data class BackupFileRecord(
        val modelId: String,
        val relativePath: String,
        val size: Long,
        val sha256: String
    )

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    private fun MessageDigest.toHex(): String = digest().toHex()

    companion object {
        const val BACKUP_MIME_TYPE = "application/zip"
        const val BACKUP_FILE_PREFIX = "DataCubeAU-ModelBackup"
        private const val MANIFEST_NAME = "manifest.tsv"
        private const val FORMAT_VERSION = "1"
        private const val BUFFER_SIZE = 64 * 1024
        private const val MAX_MANIFEST_BYTES = 8 * 1024 * 1024
        private const val MAX_PATH_LENGTH = 2048
        private const val MAX_FILES = 25_000
        private const val MAX_FILE_BYTES = 20L * 1024 * 1024 * 1024
        private const val MAX_TOTAL_BYTES = 100L * 1024 * 1024 * 1024
        private val MODEL_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
        private val SHA256 = Regex("^[a-f0-9]{64}$")
    }
}
