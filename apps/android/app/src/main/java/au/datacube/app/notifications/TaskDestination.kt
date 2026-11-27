package au.datacube.app.notifications

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import au.datacube.app.MainActivity

/** Explicit, immutable notification taps, restricted to authenticated local navigation. */
object TaskDestination {
    private const val ACTION = "au.datacube.app.OPEN_TASK"
    private const val EXTRA = "au_task_route"
    private val id = Regex("[A-Za-z0-9_-]{1,80}")
    private val documentRoute = Regex("document/[A-Za-z0-9_-]{1,80}[?]tab=[0-4]")
    private val collectionRoute = Regex("collection-chat/[A-Za-z0-9_-]{1,80}")
    fun document(documentId: String, tab: Int = 0): String =
        if (documentId.matches(id)) "document/$documentId?tab=${tab.coerceIn(0,4)}" else "documents"
    fun gist(collectionId: String? = null): String =
        if (collectionId != null && collectionId.matches(id)) "collection-chat/$collectionId" else "discs"
    const val UPDATES = "settings"
    fun validated(route: String?): String? = route?.takeIf {
        it in setOf("home", "documents", "discs", "models", "model-vault", "settings") ||
            documentRoute.matches(it) || collectionRoute.matches(it)
    }
    fun fromIntent(intent: Intent?): String? =
        if (intent?.action == ACTION) validated(intent.getStringExtra(EXTRA)) else null
    fun pending(context: Context, route: String?, key: String = ""): PendingIntent {
        val target = validated(route) ?: "home"
        val intent = Intent(context, MainActivity::class.java).setAction(ACTION)
            .setData(Uri.Builder().scheme("datacube-task").authority("local").appendPath(target).appendPath(key.take(180)).build())
            .putExtra(EXTRA, target)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    fun forCompletion(key: String): String? = when {
        key.startsWith("model-") -> "models"
        key.startsWith("apk-") -> UPDATES
        key.endsWith("-NOTES") -> document(key.removeSuffix("-NOTES"), 1)
        key.endsWith("-REVISION") -> document(key.removeSuffix("-REVISION"), 2)
        key.endsWith("-PRACTICE") -> document(key.removeSuffix("-PRACTICE"), 3)
        key.endsWith("-podcast") -> document(key.removeSuffix("-podcast"), 4)
        else -> null
    }
}
