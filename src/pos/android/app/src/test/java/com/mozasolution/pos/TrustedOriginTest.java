package com.mozasolution.pos;

import org.junit.Test;
import static org.junit.Assert.*;

public class TrustedOriginTest {
    private final TrustedOrigin tailscale = new TrustedOrigin("https://hunghx.tail02c7f8.ts.net:8443/admin/pos");

    @Test public void cameraAndBridgeAllowOnlyConfiguredHttpsOrigin() {
        assertTrue(tailscale.allows("https://hunghx.tail02c7f8.ts.net:8443/"));
        assertTrue(tailscale.allows("https://hunghx.tail02c7f8.ts.net:8443/login?return_url=/pos/"));
        assertFalse(tailscale.allows("http://hunghx.tail02c7f8.ts.net:8443/"));
        assertFalse(tailscale.allows("https://hunghx.tail02c7f8.ts.net/"));
        assertFalse(tailscale.allows("https://hunghx.tail02c7f8.ts.net.evil.test:8443/"));
        assertFalse(tailscale.allows("https://hunghx.tail02c7f8.ts.net:8443@evil.test/"));
        assertFalse(tailscale.allows("https://user@hunghx.tail02c7f8.ts.net:8443/"));
        assertFalse(tailscale.allows("file:///sdcard/pos.html"));
        assertFalse(tailscale.allows("javascript:alert(1)"));
        assertFalse(tailscale.allows(null));
        assertEquals("https://hunghx.tail02c7f8.ts.net:8443", tailscale.rule());
    }
    @Test public void implicitHttpsPortMatchesExplicit443() {
        TrustedOrigin origin = new TrustedOrigin("https://pos.example.test/pos/");
        assertTrue(origin.allows("https://POS.example.test:443/auth/me"));
        assertFalse(origin.allows("https://pos.example.test:444/"));
    }
    @Test(expected = IllegalArgumentException.class) public void rejectCleartextConfiguration() {
        new TrustedOrigin("http://100.86.192.2:3000/pos/");
    }
    @Test public void exportedNamesCannotContainPathsOrControlCharacters() {
        assertEquals(".._.._products.xlsx", TrustedOrigin.safeFilename("../../products.xlsx"));
        assertEquals("pos-export", TrustedOrigin.safeFilename(".."));
        assertEquals("sale_invoice.csv", TrustedOrigin.safeFilename("sale\ninvoice.csv"));
    }
}
