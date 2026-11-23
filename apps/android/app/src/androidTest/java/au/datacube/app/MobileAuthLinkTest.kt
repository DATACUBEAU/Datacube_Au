package au.datacube.app

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.os.Process
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileAuthLinkTest {
    private val app get() = ApplicationProvider.getApplicationContext<Context>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val request = "AQ-_".repeat(10) + "Abc"
    private val callback = "https://datacube-au.vercel.app/mobile-auth/return"

    @Test
    fun callbackRequiresTheExactHttpsHostPathAndSingleOpaqueRequest() {
        assertEquals(request, mobileSignInRequestId(viewIntent("$callback?request=$request")))
        listOf(
            "http://datacube-au.vercel.app/mobile-auth/return?request=$request",
            "https://datacube-au.vercel.app.example/mobile-auth/return?request=$request",
            "https://app@datacube-au.vercel.app/mobile-auth/return?request=$request",
            "https://datacube-au.vercel.app:443/mobile-auth/return?request=$request",
            "$callback/?request=$request",
            "$callback?request=$request#",
            "$callback?request=$request&request=$request",
            "$callback?request=$request&access_token=fixture",
            "$callback?request=%41${request.drop(1)}",
            "$callback?request=short",
            callback
        ).forEach { url -> assertNull(mobileSignInRequestId(viewIntent(url))) }
        assertNull(mobileSignInRequestId(Intent(Intent.ACTION_SEND, Uri.parse("$callback?request=$request"))))
    }

    @Test
    fun declaredHttpsPathResolvesToMainActivity() {
        val expected = MainActivity::class.java.name
        assertEquals(expected, resolve("$callback?request=$request"))
        assertNull(resolve("$callback/extra?request=$request"))
        assertNull(resolve("https://other.vercel.app/mobile-auth/return?request=$request"))
    }

    @Test
    fun activityReceivesColdAndWarmCallbacksAndIgnoresOtherViewIntents() {
        val coldEvent = "mobile_return_received launch=cold"
        val warmEvent = "mobile_return_received launch=warm"
        val ignoredEvent = "mobile_return_ignored launch=warm"
        val initialColdCount = eventCount(coldEvent)
        val initialWarmCount = eventCount(warmEvent)
        val initialIgnoredCount = eventCount(ignoredEvent)
        val link = "$callback?request=$request"
        ActivityScenario.launch<MainActivity>(explicitViewIntent(link)).use { scenario ->
            awaitEvent(coldEvent, initialColdCount + 1)

            lateinit var original: MainActivity
            scenario.onActivity { activity ->
                original = activity
                activity.startActivity(explicitViewIntent(link).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP))
            }
            awaitEvent(warmEvent, initialWarmCount + 1)
            scenario.onActivity { activity ->
                assertSame(original, activity)
                activity.startActivity(
                    explicitViewIntent("$link&access_token=fixture")
                        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                )
            }
            awaitEvent(ignoredEvent, initialIgnoredCount + 1)
            assertEquals(initialWarmCount + 1, eventCount(warmEvent))
        }
    }

    private fun viewIntent(url: String) =
        Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)

    private fun explicitViewIntent(url: String) =
        viewIntent(url).setClass(app, MainActivity::class.java)

    private fun resolve(url: String): String? =
        app.packageManager.resolveActivity(
            viewIntent(url).setPackage(app.packageName),
            PackageManager.MATCH_DEFAULT_ONLY
        )?.activityInfo?.name

    private fun eventCount(event: String): Int {
        val log = instrumentation.uiAutomation.executeShellCommand(
            "logcat -d -v brief --pid=${Process.myPid()} DataCubeStartup:I '*:S'"
        )
        return ParcelFileDescriptor.AutoCloseInputStream(log).bufferedReader().use { reader ->
            reader.lineSequence().count { event in it }
        }
    }

    private fun awaitEvent(event: String, count: Int) {
        val deadline = SystemClock.uptimeMillis() + 5_000L
        while (SystemClock.uptimeMillis() < deadline && eventCount(event) < count) {
            SystemClock.sleep(50)
        }
        assertEquals(count, eventCount(event))
    }
}
