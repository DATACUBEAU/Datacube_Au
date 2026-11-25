package au.datacube.app.monetization

import org.junit.Assert.*
import org.junit.Test

class NativeAdPolicyTest {
    private val eligible = NativeAdEligibility(true, true, true, true, true, false, false)

    @Test fun onlyDesignatedPlacementsAreAllowed() {
        assertTrue(NativeAdPolicy.allows(NativeAdPlacement.HOME, eligible))
        assertTrue(NativeAdPolicy.allows(NativeAdPlacement.DOCUMENT_OVERVIEW, eligible))
        assertTrue(NativeAdPolicy.allows(NativeAdPlacement.SETTINGS, eligible))
        for (placement in listOf(NativeAdPlacement.CHAT, NativeAdPlacement.READER, NativeAdPlacement.AUTH, NativeAdPlacement.PLAYBACK)) {
            assertFalse(NativeAdPolicy.allows(placement, eligible))
        }
    }

    @Test fun missingPrerequisitesFailClosed() {
        for (state in listOf(eligible.copy(providerReady = false), eligible.copy(consentAllowsAds = false),
            eligible.copy(ageEligible = false), eligible.copy(online = false), eligible.copy(foreground = false),
            eligible.copy(adFree = true), eligible.copy(busy = true))) {
            assertFalse(NativeAdPolicy.allows(NativeAdPlacement.HOME, state))
        }
    }
}
