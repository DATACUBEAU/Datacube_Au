package au.datacube.app.data.rag

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class OrderedNativeTextStreamTest {
    @Test fun synchronousBurstDoesNotDropOrReorderChunksEvenWithSlowConsumer() = runBlocking {
        val expected = (0 until 512).map { "chunk-$it " }
        val actual = mutableListOf<String>()
        OrderedNativeTextStream.read { emit, done, _ ->
            expected.forEach(emit)
            done()
            emit("late callback")
        }.collect {
            actual += it
            if (actual.size % 20 == 0) delay(1)
        }
        assertEquals(expected, actual)
    }

    @Test fun overflowFailsExplicitlyAfterDeliveringAcceptedPrefix() = runBlocking {
        val actual = mutableListOf<String>()
        val failure = runCatching {
            OrderedNativeTextStream.read(maxChars = 5) { emit, done, _ ->
                emit("abc")
                emit("def")
                done()
            }.collect { actual += it }
        }.exceptionOrNull()
        assertTrue(failure is IllegalStateException)
        assertEquals(listOf("abc"), actual)
    }

    @Test fun errorDoesNotBecomeSuccessfulCompletion() = runBlocking {
        val original = IllegalArgumentException("native failure")
        val failure = runCatching {
            OrderedNativeTextStream.read { emit, done, fail ->
                emit("prefix")
                fail(original)
                done()
            }.toList()
        }.exceptionOrNull()
        assertSame(original, failure)
    }

    @Test fun emptyEventsDoNotUseBudgetAndEventLimitIsExplicit() = runBlocking {
        val actual = mutableListOf<String>()
        val failure = runCatching {
            OrderedNativeTextStream.read(maxEvents = 2) { emit, done, _ ->
                repeat(100) { emit("") }
                emit("one"); emit("two"); emit("three"); done()
            }.collect { actual += it }
        }.exceptionOrNull()
        assertTrue(failure is IllegalStateException)
        assertEquals(listOf("one", "two"), actual)
    }
}
