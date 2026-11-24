package au.datacube.app.data.rag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScopedChatRoutingTest {
    @Test fun collectionHistoryIsUniquePerAccountAndCollection() {
        val first = ScopedChatRouting.ownerId(
            "account-aaaaaaaaaaaa", "collection-11"
        )
        val second = ScopedChatRouting.ownerId(
            "account-aaaaaaaaaaaa", "collection-22"
        )
        val third = ScopedChatRouting.ownerId(
            "account-bbbbbbbbbbbb", "collection-11"
        )
        assertEquals(first, ScopedChatRouting.ownerId("account-aaaaaaaaaaaa", "collection-11"))
        assertFalse(first == second)
        assertFalse(first == third)
        assertTrue(first.length <= 80)
    }

    @Test fun collectionEvidenceCannotIncludeDocumentsOutsideMembership() {
        val authorized = setOf("doc-one", "doc-two")
        val requested = setOf("doc-two", "personal-private")
        assertEquals(setOf("doc-two"),
            ScopedChatRouting.requireAllowedDocuments(authorized, requested))
    }

    @Test fun socialGreetingsStayConversationNotFabricatedDocumentEvidence() {
        assertTrue(ScopedChatRouting.isSocialGreeting("Hi AU"))
        assertFalse(ScopedChatRouting.isSocialGreeting("How does quantum mechanics work?"))
        assertFalse(ScopedChatRouting.isSocialGreeting("Hi, summarize my documents"))
    }
}
