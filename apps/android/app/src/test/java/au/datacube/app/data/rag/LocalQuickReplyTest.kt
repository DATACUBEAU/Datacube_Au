package au.datacube.app.data.rag

import org.junit.Assert.*
import org.junit.Test

class LocalQuickReplyTest {
    @Test fun onlySimpleGreetingsBypassInference() {
        assertNotNull(LocalQuickReply.forMessage("Hi!"))
        assertNotNull(LocalQuickReply.forMessage("Thank you"))
        assertNull(LocalQuickReply.forMessage("Hi, explain Flutter"))
        assertNull(LocalQuickReply.forMessage("What is the core of this document?"))
    }
}
