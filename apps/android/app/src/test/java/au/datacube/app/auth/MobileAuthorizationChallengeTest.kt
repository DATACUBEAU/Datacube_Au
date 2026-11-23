package au.datacube.app.auth

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileAuthorizationChallengeTest {
    @Test fun encodesTheAsciiVerifierHash() {
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            mobileAuthorizationChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        )
    }

    @Test fun generatesUniqueUnpaddedVerifiersFrom32RandomBytes() {
        val verifier = newMobileAuthorizationVerifier()
        assertTrue(MobileAuthorizationRequestId.matches(verifier))
        assertEquals(32, Base64.getUrlDecoder().decode(verifier).size)
        assertNotEquals(verifier, newMobileAuthorizationVerifier())
    }
}
