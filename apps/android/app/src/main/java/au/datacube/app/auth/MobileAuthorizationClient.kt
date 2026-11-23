package au.datacube.app.auth

import android.net.Uri
import au.datacube.app.BuildConfig
import io.github.jan.supabase.auth.user.UserSession
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.timeout
import io.ktor.client.request.accept
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.datetime.Instant as KotlinInstant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64

internal val MobileAuthorizationRequestId = Regex("[A-Za-z0-9_-]{43}")
internal const val MobileAuthorizationLifetimeMillis = 5 * 60 * 1_000L

internal fun newMobileAuthorizationVerifier(): String = Base64.getUrlEncoder().withoutPadding()
    .encodeToString(ByteArray(32).also(SecureRandom()::nextBytes))

internal fun mobileAuthorizationChallenge(verifier: String): String = Base64.getUrlEncoder().withoutPadding()
    .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

internal data class MobileAuthorizationCreated(val requestId: String, val pairingCode: String, val expiresAt: Long) {
    override fun toString() = "MobileAuthorizationCreated(expiresAt=$expiresAt)"
}

internal enum class MobileAuthorizationStatus {
    PENDING, APPROVED, CONSUMED, DENIED, EXPIRED, CANCELLED
}

internal class MobileAuthorizationResult(
    val status: MobileAuthorizationStatus,
    val session: UserSession? = null,
    val userId: String? = null
)

internal class MobileAuthorizationUnavailable : Exception()
internal class MobileAuthorizationHttpFailure(val statusCode: Int) : Exception()

internal interface MobileAuthorizationGateway {
    suspend fun create(challenge: String): MobileAuthorizationCreated
    suspend fun status(pending: PendingMobileAuthorization): MobileAuthorizationStatus
    suspend fun consume(pending: PendingMobileAuthorization): MobileAuthorizationResult
    suspend fun cancel(pending: PendingMobileAuthorization)
    fun approvalPage(requestId: String): Uri
}

internal class MobileAuthorizationClient(
    websiteUrl: String = BuildConfig.AUTH_WEBSITE_URL,
    httpClient: HttpClient? = null
) : MobileAuthorizationGateway {
    private val origin by lazy {
        val url = URI(websiteUrl)
        require(url.scheme == "https" && url.host != null && url.userInfo == null &&
            url.rawPath in listOf("", "/") && url.rawQuery == null && url.rawFragment == null)
        Uri.parse(url.toASCIIString().trimEnd('/'))
    }
    private val client by lazy {
        httpClient ?: HttpClient(Android) {
            followRedirects = false
            install(HttpTimeout) {
                connectTimeoutMillis = 10_000
            }
        }
    }
    private val json by lazy { Json { ignoreUnknownKeys = true } }

    override fun approvalPage(requestId: String): Uri = origin.buildUpon()
        .appendPath("mobile-auth").appendPath("approve").appendQueryParameter("request", requestId).build()

    override suspend fun create(challenge: String): MobileAuthorizationCreated {
        val payload = request(buildJsonObject {
            put("action", "create")
            put("challenge", challenge)
        }, timeoutMillis = 30_000)
        return MobileAuthorizationCreated(
            requestId = requireNotNull(payload["requestId"]?.jsonPrimitive?.contentOrNull)
                .also { require(MobileAuthorizationRequestId.matches(it)) },
            pairingCode = requireNotNull(payload["pairingCode"]?.jsonPrimitive?.contentOrNull)
                .also { require(PairingCode.matches(it)) },
            expiresAt = Instant.parse(payload.getValue("expiresAt").jsonPrimitive.content).toEpochMilli()
        )
    }

    override suspend fun status(pending: PendingMobileAuthorization): MobileAuthorizationStatus =
        parseStatus(proofRequest("status", pending))

    override suspend fun consume(pending: PendingMobileAuthorization): MobileAuthorizationResult {
        val payload = proofRequest("consume", pending, timeoutMillis = 30_000)
        val status = parseStatus(payload)
        val sessionBody = payload["session"]?.jsonObject ?: return MobileAuthorizationResult(status)
        val expiresAt = requireNotNull(sessionBody["expires_at"]?.jsonPrimitive?.longOrNull)
        val session = json.decodeFromJsonElement(UserSession.serializer(), sessionBody)
            .copy(expiresAt = KotlinInstant.fromEpochSeconds(expiresAt))
        val userId = payload["userId"]?.jsonPrimitive?.contentOrNull
        return MobileAuthorizationResult(status, session, userId)
    }

    override suspend fun cancel(pending: PendingMobileAuthorization) {
        proofRequest("cancel", pending)
    }

    private suspend fun proofRequest(
        action: String,
        pending: PendingMobileAuthorization,
        timeoutMillis: Long = 12_000
    ): JsonObject =
        request(buildJsonObject {
            put("action", action)
            put("requestId", pending.requestId)
            put("verifier", pending.verifier)
        }, timeoutMillis)

    private suspend fun request(body: JsonObject, timeoutMillis: Long): JsonObject = withContext(Dispatchers.IO) {
        val endpoint = origin.buildUpon()
            .appendPath("api").appendPath("auth").appendPath("mobile-authorization").build()
        val response = client.post(endpoint.toString()) {
            contentType(ContentType.Application.Json)
            accept(ContentType.Application.Json)
            timeout {
                requestTimeoutMillis = timeoutMillis
                socketTimeoutMillis = timeoutMillis
            }
            setBody(body.toString())
        }
        val httpStatus = response.status.value
        when (httpStatus) {
            401, 404, 410 -> throw MobileAuthorizationUnavailable()
        }
        if (httpStatus !in 200..299) throw MobileAuthorizationHttpFailure(httpStatus)
        json.parseToJsonElement(response.bodyAsText()).jsonObject.also {
            check(it["ok"]?.jsonPrimitive?.booleanOrNull == true)
        }
    }

    private fun parseStatus(payload: JsonObject): MobileAuthorizationStatus =
        MobileAuthorizationStatus.valueOf(payload.getValue("status").jsonPrimitive.content.uppercase())

    private companion object {
        val PairingCode = Regex("[A-Z2-9]{8}")
    }
}
