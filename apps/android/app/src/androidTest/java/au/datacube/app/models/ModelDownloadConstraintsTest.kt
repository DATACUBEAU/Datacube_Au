package au.datacube.app.models

import androidx.work.NetworkType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelDownloadConstraintsTest {
    @Test fun explicitMobileDownloadDoesNotRequireBatteryAboveLowThreshold() {
        val constraints = VerifiedModelDownloadManager.downloadConstraints(false, false)
        assertEquals(NetworkType.CONNECTED, constraints.requiredNetworkType)
        assertFalse(constraints.requiresBatteryNotLow())
        assertTrue(constraints.requiresStorageNotLow())
    }

    @Test fun wifiPreferenceIsPreservedAndBackupsCanRunOffline() {
        val wifi = VerifiedModelDownloadManager.downloadConstraints(false, true)
        assertEquals(NetworkType.UNMETERED, wifi.requiredNetworkType)
        assertFalse(wifi.requiresBatteryNotLow())
        val backup = VerifiedModelDownloadManager.downloadConstraints(true, true)
        assertEquals(NetworkType.NOT_REQUIRED, backup.requiredNetworkType)
        assertTrue(backup.requiresStorageNotLow())
    }
}
