package au.datacube.app.work

import androidx.work.NetworkType
import androidx.work.workDataOf
import au.datacube.app.data.rag.LexicalIndexWorker
import au.datacube.app.data.rag.SemanticIndexWorker
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DocumentWorkPolicyTest {
    @Test fun documentJobsRequireStorageButNotNetworkOrBatteryThreshold() {
        val constraints = DocumentWorkPolicy.constraints()
        assertEquals(NetworkType.NOT_REQUIRED, constraints.requiredNetworkType)
        assertFalse(constraints.requiresBatteryNotLow())
        assertFalse(constraints.requiresCharging())
        assertTrue(constraints.requiresStorageNotLow())
    }

    @Test fun recoveryPreservesExistingWorkIdForAllFourWorkerKinds() {
        val id = UUID.randomUUID()
        listOf(DocumentIntegrityWorker::class.java, DocumentTextExtractionWorker::class.java,
            LexicalIndexWorker::class.java, SemanticIndexWorker::class.java).forEach { worker ->
            val request = DocumentWorkPolicy.request(worker, workDataOf("documentId" to "test"), id)
            assertEquals(id, request.id)
        }
    }
}
