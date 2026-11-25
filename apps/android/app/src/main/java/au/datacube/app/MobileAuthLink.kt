package au.datacube.app

import android.content.Intent
import au.datacube.app.auth.MobileAuthorizationRequestId

internal fun mobileSignInRequestId(intent: Intent): String? {
    if (intent.action != Intent.ACTION_VIEW) return null
    val uri = intent.data ?: return null
    if (uri.scheme != "https" ||
        uri.encodedAuthority != "datacube.fabianodev.xyz" ||
        uri.encodedPath != "/mobile-auth/return" ||
        uri.encodedFragment != null
    ) return null

    val query = uri.encodedQuery ?: return null
    if (!query.startsWith("request=")) return null
    return query.substringAfter('=').takeIf(MobileAuthorizationRequestId::matches)
}
