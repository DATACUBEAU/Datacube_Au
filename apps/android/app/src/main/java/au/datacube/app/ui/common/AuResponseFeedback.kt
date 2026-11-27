package au.datacube.app.ui.common

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.work.*
import au.datacube.app.auth.SupabaseClient
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal object ResponseFeedbackStore {
    private val lock = Any()
    private fun prefs(context: Context) = context.getSharedPreferences("au_response_feedback_v1",Context.MODE_PRIVATE)
    private fun key(account: String,id: String) = "$account:$id"
    fun id(scope: String,index: Int,created: Long?) = MessageDigest.getInstance("SHA-256")
        .digest("$scope:$index:${created ?: 0}".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    fun rating(context: Context,account: String,id: String): Int = synchronized(lock) {
        runCatching { JSONObject(prefs(context).getString(key(account,id),null) ?: "{}").optInt("rating") }.getOrDefault(0)
    }

    fun save(context: Context,account: String,id: String,section: String,rating: Int,reason: String?): Boolean = synchronized(lock) {
        require(rating in setOf(0,1,5))
        val prefs = prefs(context)
        val prefix = "$account:"
        val owned = prefs.all.filterKeys { it.startsWith(prefix) }
        val edit = prefs.edit()
        if (owned.size >= 200 && key(account,id) !in owned) {
            val clean = owned.entries.firstOrNull { (_,value) ->
                runCatching { !JSONObject(value.toString()).optBoolean("pending") }.getOrDefault(false)
            } ?: return@synchronized false
            edit.remove(clean.key)
        }
        edit.putString(key(account,id),JSONObject().put("id",id).put("section",section)
            .put("rating",rating).put("reason",reason ?: JSONObject.NULL).put("pending",true)
            .put("version",UUID.randomUUID().toString()).toString()).commit()
    }

    fun pending(context: Context,account: String): List<JSONObject> = synchronized(lock) {
        prefs(context).all.filterKeys { it.startsWith("$account:") }.values.mapNotNull {
            runCatching { JSONObject(it.toString()) }.getOrNull()?.takeIf { j -> j.optBoolean("pending") }
        }.take(200)
    }

    fun acknowledge(context: Context,account: String,row: JSONObject) = synchronized(lock) {
        val prefs = prefs(context)
        val key = key(account,row.getString("id"))
        val latest = prefs.getString(key,null)?.let { JSONObject(it) }
        if (latest != null && latest.optString("version") == row.optString("version")) {
            prefs.edit().putString(key,latest.put("pending",false).toString()).commit()
        }
    }

    fun schedule(context: Context,account: String) {
        if (pending(context,account).isEmpty()) return
        val work = OneTimeWorkRequestBuilder<ResponseFeedbackWorker>()
            .setInputData(workDataOf("account" to account))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(context).enqueueUniqueWork("au-response-feedback-$account",ExistingWorkPolicy.APPEND_OR_REPLACE,work)
    }
}

class ResponseFeedbackWorker(context: Context,params: WorkerParameters): CoroutineWorker(context,params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val account = inputData.getString("account") ?: return@withContext Result.failure()
        for (row in ResponseFeedbackStore.pending(applicationContext,account)) {
            currentCoroutineContext().ensureActive()
            val session = SupabaseClient.auth.currentSessionOrNull() ?: return@withContext Result.success()
            if (session.user?.id != account || session.accessToken.isBlank()) return@withContext Result.success()
            try {
                val payload = JSONObject().put("responseId",row.getString("id"))
                    .put("section",row.getString("section"))
                    .put("rating",if (row.getInt("rating")==0) JSONObject.NULL else row.getInt("rating"))
                    .put("reason",row.opt("reason") ?: JSONObject.NULL)
                val connection = URL("https://datacube.fabianodev.xyz/api/feedback/response").openConnection() as HttpsURLConnection
                try {
                    connection.requestMethod = "POST"
                    connection.instanceFollowRedirects = false
                    connection.connectTimeout = 10_000
                    connection.readTimeout = 10_000
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type","application/json")
                    connection.setRequestProperty("Authorization","Bearer " + session.accessToken)
                    val bytes = payload.toString().toByteArray(Charsets.UTF_8)
                    connection.setFixedLengthStreamingMode(bytes.size)
                    connection.outputStream.use { it.write(bytes) }
                    if (connection.responseCode != 200) return@withContext Result.retry()
                    ResponseFeedbackStore.acknowledge(applicationContext,account,row)
                } finally { connection.disconnect() }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { return@withContext Result.retry() }
        }
        Result.success()
    }
}

@Composable
internal fun AuResponseFeedback(account: String?, scope: String, index: Int, created: Long?, section: String) {
    if (account.isNullOrBlank()) return
    val context = LocalContext.current
    val id = remember(scope,index,created) { ResponseFeedbackStore.id(scope,index,created) }
    var rating by remember(account,id) { mutableIntStateOf(ResponseFeedbackStore.rating(context,account,id)) }
    var reasonMenu by remember(account,id) { mutableStateOf(false) }
    var error by remember(account,id) { mutableStateOf(false) }
    fun save(value: Int,reason: String? = null) {
        if (ResponseFeedbackStore.save(context,account,id,section,value,reason)) {
            rating = value
            error = false
            ResponseFeedbackStore.schedule(context,account)
        } else error = true
    }
    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        Box {
            Row {
                IconButton(onClick = { val next = if (rating==5) 0 else 5; save(next); reasonMenu = next != 0 }) {
                    Icon(Icons.Outlined.ThumbUp,contentDescription="Good response",
                        tint=if (rating==5) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { val next = if (rating==1) 0 else 1; save(next); reasonMenu = next != 0 }) {
                    Icon(Icons.Outlined.ThumbDown,contentDescription="Bad response",
                        tint=if (rating==1) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            DropdownMenu(expanded=reasonMenu && rating!=0,onDismissRequest={reasonMenu=false}) {
                Text("Optional reason",Modifier.padding(12.dp),style=MaterialTheme.typography.labelSmall)
                val reasons = if (rating==5) listOf("clear","helpful","accurate") else listOf("incorrect","irrelevant","unclear","incomplete")
                reasons.forEach { reason -> DropdownMenuItem(text={Text(reason.replaceFirstChar { it.uppercase() })},
                    onClick={save(rating,reason);reasonMenu=false}) }
                DropdownMenuItem(text={Text("Done")},onClick={reasonMenu=false})
            }
        }
    }
    if (error) Text("Could not save feedback. Try again.",color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.labelSmall)
}

/** Compact common action row for Gist and document answers. */
@Composable
internal fun AuMessageActions(answer: String, speech: AuReadAloudState, id: Int,
    feedback: @Composable () -> Unit) {
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val context = LocalContext.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        IconButton(onClick = { clipboard.setText(androidx.compose.ui.text.AnnotatedString(answer)) }) {
            Icon(Icons.Outlined.ContentCopy, "Copy", modifier = Modifier.size(20.dp))
        }
        feedback()
        AuReadAloudAction(speech, id, answer)
        IconButton(onClick = {
            val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(android.content.Intent.EXTRA_TEXT, answer)
            }
            context.startActivity(android.content.Intent.createChooser(intent, "Share response"))
        }) { Icon(Icons.Outlined.Share, "Share", Modifier.size(20.dp)) }
    }
}
