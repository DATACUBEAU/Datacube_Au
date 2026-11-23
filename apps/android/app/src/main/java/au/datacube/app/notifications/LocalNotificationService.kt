package au.datacube.app.notifications

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import au.datacube.app.R

/**
 * One persistent, low-priority status notification per document. These
 * notifications describe REAL worker progress, never simulated AI thinking.
 * They are private on lock screens and never contain document titles/text.
 */
class LocalNotificationService(private val context: Context) {
    private fun manager(): NotificationManager? {
        val service = context.getSystemService(NotificationManager::class.java) ?: return null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) return null
        if (!service.areNotificationsEnabled()) return null
        service.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID, "Background processing", NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Document extraction and optional indexing progress."
                setShowBadge(false)
            }
        )
        return service
    }

    fun showDocumentExtraction(documentId: String, percentage: Int) {
        val progress = percentage.coerceIn(0, 95)
        postProgress(documentId, progress, "Extracting document text · $progress%")
    }

    fun showDocumentSearchIndexing(documentId: String, indexedPassages: Int) {
        val service = manager() ?: return
        val notification = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_datacube)
            .setContentTitle("Preparing document search")
            .setContentText("Indexed " + indexedPassages.coerceAtLeast(0) + " passages")
            .setProgress(0, 0, true)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .build()
        service.notify(tag(documentId), PROGRESS_ID, notification)
    }

    fun showDocumentIndexing(documentId: String, indexedChunks: Int, totalChunks: Int) {
        if (totalChunks <= 0) return
        val done = indexedChunks.coerceIn(0, totalChunks)
        val progress = (done * 100L / totalChunks).toInt()
        postProgress(documentId, progress, "Indexing $done of $totalChunks text chunks")
    }

    private fun postProgress(documentId: String, percent: Int, detail: String) {
        val manager = manager() ?: return
        val notification = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_datacube)
            .setContentTitle("Preparing document")
            .setContentText(detail)
            .setProgress(100, percent, false)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .build()
        manager.notify(tag(documentId), PROGRESS_ID, notification)
    }

    fun clearDocumentProgress(documentId: String) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.cancel(tag(documentId), PROGRESS_ID)
    }

    fun showDocumentCheckComplete(jobId: String, documentId: String) {
        clearDocumentProgress(documentId)
        showCompletion(documentId, "Document verification complete")
    }

    fun showTextReady(documentId: String) {
        clearDocumentProgress(documentId)
        showCompletion(documentId, "Document is ready for study")
    }

    fun showIndexComplete(documentId: String) {
        clearDocumentProgress(documentId)
        showCompletion(documentId, "Document search index is ready")
    }

    private fun showCompletion(documentId: String, message: String) {
        val manager = manager() ?: return
        val notification = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_datacube)
            .setContentTitle("DataCube AU")
            .setContentText(message)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .build()
        manager.notify(tag(documentId), COMPLETE_ID, notification)
    }

    fun cancelDocument(documentId: String, legacyJobIds: Collection<String>) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.cancel(tag(documentId), COMPLETE_ID)
        manager.cancel(tag(documentId), PROGRESS_ID)
        // Previous app versions used integer job hashes for completion alerts.
        legacyJobIds.forEach { id -> manager.cancel(id.hashCode() and Int.MAX_VALUE) }
    }

    companion object {
        private const val CHANNEL_ID = "datacube_local_processing"
        private const val COMPLETE_ID = 1
        private const val PROGRESS_ID = 2
        private fun tag(documentId: String) = "document-$documentId"
    }
}
