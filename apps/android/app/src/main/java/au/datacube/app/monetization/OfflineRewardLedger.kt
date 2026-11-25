package au.datacube.app.monetization

import android.content.Context
import android.util.Base64
import java.security.PublicKey
import java.security.Signature
import org.json.JSONObject

enum class RewardFeature(val wire: String, val maximum: Int) {
    PODCAST("podcast", 1800), IMAGE("image", 10), VOICE("voice", 10)
}

data class VerifiedOfflineLease internal constructor(
    val id: String, val accountId: String, val deviceId: String,
    val feature: RewardFeature, val units: Int, val sequence: Long,
    val issuedAt: Long, val expiresAt: Long
)

/** Verify the exact UTF-8 wire bytes. Trusted public key comes from app configuration,
 * never from a response or the user. No live key or ad SDK configured yet. */
object OfflineLeaseVerifier {
    private val id = Regex("[A-Za-z0-9_-]{16,128}")
    fun verify(payload: String, signature: String, publicKey: PublicKey,
        account: String, device: String, now: Long): VerifiedOfflineLease? = runCatching {
        require(payload.length <= 1024 && signature.length <= 256)
        require(publicKey.algorithm == "EC")
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(publicKey)
        verifier.update(payload.toByteArray(Charsets.UTF_8))
        require(verifier.verify(Base64.decode(signature, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)))
        val p = payload.split('\n')
        require(p.size == 9 && p[0] == "AU-REWARD-V1")
        require(p.subList(1,4).all { id.matches(it) } && p[2] == account && p[3] == device)
        val feature = RewardFeature.entries.single { it.wire == p[4] }
        val units = p[5].toInt()
        val sequence = p[6].toLong()
        val issued = p[7].toLong()
        val expires = p[8].toLong()
        require(units in 1..feature.maximum && sequence > 0 && issued > 0 &&
            now >= issued && now < expires && expires - issued in 1..604800000L)
        VerifiedOfflineLease(p[1],p[2],p[3],feature,units,sequence,issued,expires)
    }.getOrNull()
}

internal data class LeaseBalance(val sequence: Long, val id: String, val remaining: Int, val expires: Long) {
    fun replace(lease: VerifiedOfflineLease): LeaseBalance? =
        if (lease.sequence <= sequence) null else LeaseBalance(lease.sequence,lease.id,lease.units,lease.expiresAt)
    fun consume(units: Int, now: Long): LeaseBalance? =
        if (units <= 0 || units > remaining || now >= expires) null else copy(remaining = remaining - units)
}

/** Persist before allowing an operation. No balance reset on reconnect or process restart.
 * Conservative: abandoned reservations are spent, and replaced leases never restore units.
 * This is not tamper-proof DRM; production wiring must bind a registered device key and
 * reconcile usage on the server. Keep feature gates disabled until that integration passes.
 */
class OfflineRewardLedger(context: Context, private val account: String, private val device: String) {
    private val prefs = context.applicationContext.getSharedPreferences("au_offline_rewards_v1",Context.MODE_PRIVATE)
    init { require(listOf(account,device).all { it.matches(Regex("[A-Za-z0-9_-]{16,128}")) }) }
    private fun key(feature: RewardFeature) = "$account:$device:${feature.wire}"
    private fun read(feature: RewardFeature): LeaseBalance? {
        val raw = prefs.getString(key(feature),null) ?: return null
        val j = JSONObject(raw)
        return LeaseBalance(j.getLong("sequence"),j.getString("id"),j.getInt("remaining"),j.getLong("expires"))
            .also { require(it.sequence > 0 && it.remaining in 0..feature.maximum) }
    }
    private fun save(feature: RewardFeature, b: LeaseBalance): Boolean =
        prefs.edit().putString(key(feature),JSONObject().put("sequence",b.sequence).put("id",b.id)
            .put("remaining",b.remaining).put("expires",b.expires).toString()).commit()

    fun install(lease: VerifiedOfflineLease): Boolean = synchronized(lock) {
        if (lease.accountId != account || lease.deviceId != device) return@synchronized false
        runCatching {
            val previous = read(lease.feature)
            val next = if (previous == null) LeaseBalance(lease.sequence,lease.id,lease.units,lease.expiresAt)
                else previous.replace(lease) ?: return@synchronized false
            save(lease.feature,next)
        }.getOrDefault(false)
    }

    fun remaining(feature: RewardFeature, now: Long): Int = synchronized(lock) {
        runCatching { read(feature)?.takeIf { now < it.expires }?.remaining ?: 0 }.getOrDefault(0)
    }

    fun consume(feature: RewardFeature, units: Int, now: Long): Boolean = synchronized(lock) {
        runCatching {
            val next = read(feature)?.consume(units,now) ?: return@synchronized false
            save(feature,next)
        }.getOrDefault(false)
    }
    companion object { private val lock = Any() }
}
