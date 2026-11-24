package au.datacube.app.data.rag

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DocumentChatIntentTest {
    @Test fun greetingsDoNotRequireDocumentEvidence() {
        listOf("Hi", "hello!", "Hey AU", "How are you?", "What's up", "Thank you")
            .forEach { assertTrue(DocumentChatIntent.isGreeting(it)) }
    }

    @Test fun factualPromptsMustStayInsideDocumentGrounding() {
        listOf("Explain Flutter", "Is this in my document?", "Why is evaporation important?",
            "Summarize the chapter", "Hi, what does the PDF say?")
            .forEach { assertFalse(DocumentChatIntent.isGreeting(it)) }
    }
}
