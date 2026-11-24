package au.datacube.app.data.rag

import java.security.MessageDigest

/**
 * Personal chat scopes never share a history file. Hashing account and collection
 * identity avoids the 80-character SQLite/thread-key storage limit.
 */
object ScopedChatRouting {
    fun ownerId(accountId: String, collectionId: String): String {
        require(accountId.matches(Regex("[A-Za-z0-9_-]{8,80}"))) { "Invalid account." }
        require(collectionId.matches(Regex("[A-Za-z0-9_-]{1,80}"))) { "Invalid collection." }
        val digest = MessageDigest.getInstance("SHA-256").digest(
            ("datacube-collection\u0000" + accountId + "\u0000" + collectionId)
                .toByteArray(Charsets.UTF_8)
        ).joinToString("") { "%02x".format(it) }
        return "collection-" + digest.take(40)
    }

    fun isSocialGreeting(message: String): Boolean {
        val text = message.trim().lowercase(java.util.Locale.ROOT)
        return text.length <= 45 && text.matches(
            Regex("""(?:hi|hey|hello|hi au|hey au|hello au|how are you|what'?s up|thanks|thank you)[!.?\s]*""")
        )
    }

    fun requireAllowedDocuments(available: Set<String>, selected: Set<String>): Set<String> =
        selected.intersect(available)
}
