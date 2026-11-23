package au.datacube.app.auth

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import au.datacube.app.BuildConfig
import io.github.jan.supabase.auth.user.UserInfo
import io.github.jan.supabase.auth.user.UserSession
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StartupSessionFixture {
    @Test
    fun seedEncryptedSession() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("startupFixture") == "1")
        assertEquals("https://startup-fixture.invalid", BuildConfig.SUPABASE_URL)

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val account = UserInfo(aud = "authenticated", id = "00000000-0000-4000-8000-000000000001")
        val session = UserSession(
            accessToken = "startup-fixture-access",
            refreshToken = "startup-fixture-refresh",
            expiresIn = 7200,
            tokenType = "bearer",
            user = account,
        )
        val sessions = EncryptedSupabaseSessionManager(context)
        sessions.saveSession(session)
        assertEquals(account, sessions.loadSession()?.user)
    }
}
