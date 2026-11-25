package au.datacube.app.monetization

/** Policy only: the provider must still supply an approved native ad and consent state. */
enum class NativeAdPlacement { HOME, DOCUMENT_OVERVIEW, SETTINGS, CHAT, READER, AUTH, PLAYBACK }

data class NativeAdEligibility(
    val providerReady: Boolean,
    val consentAllowsAds: Boolean,
    val ageEligible: Boolean,
    val online: Boolean,
    val foreground: Boolean,
    val adFree: Boolean,
    val busy: Boolean
)

object NativeAdPolicy {
    fun allows(placement: NativeAdPlacement, state: NativeAdEligibility): Boolean =
        placement in setOf(NativeAdPlacement.HOME, NativeAdPlacement.DOCUMENT_OVERVIEW, NativeAdPlacement.SETTINGS) &&
            state.providerReady && state.consentAllowsAds && state.ageEligible &&
            state.online && state.foreground && !state.adFree && !state.busy
}
