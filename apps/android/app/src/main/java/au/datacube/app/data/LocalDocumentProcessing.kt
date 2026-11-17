package au.datacube.app.data

import androidx.room.Embedded

data class LocalDocumentProcessing(
    @Embedded val document: LocalDocument,
    val extractionStatus: String?,
    val extractionProgress: Double?,
    val extractionError: String?
)
