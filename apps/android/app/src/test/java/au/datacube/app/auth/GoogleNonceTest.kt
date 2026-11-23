package au.datacube.app.auth

import org.junit.Assert.assertEquals
import org.junit.Test

class GoogleNonceTest {
    @Test fun digestUsesLowercaseSha256OfUtf8() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", googleNonceDigest("abc"))
    }
}
