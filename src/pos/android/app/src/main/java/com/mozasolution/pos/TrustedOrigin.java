package com.mozasolution.pos;

import java.net.URI;
import java.net.URISyntaxException;

/** Keep navigation, camera permission, and the native bridge on the configured HTTPS origin. */
final class TrustedOrigin {
    private final URI origin;

    TrustedOrigin(String url) {
        try {
            origin = new URI(url);
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("Invalid POS URL", error);
        }
        if (!"https".equalsIgnoreCase(origin.getScheme()) || origin.getHost() == null
                || origin.getUserInfo() != null) {
            throw new IllegalArgumentException("POS requires an HTTPS URL without credentials");
        }
    }

    boolean allows(String url) {
        if (url == null) return false;
        try {
            URI candidate = new URI(url);
            return "https".equalsIgnoreCase(candidate.getScheme())
                    && candidate.getUserInfo() == null
                    && origin.getHost().equalsIgnoreCase(candidate.getHost())
                    && port(origin) == port(candidate);
        } catch (URISyntaxException | IllegalArgumentException error) {
            return false;
        }
    }

    String rule() {
        return "https://" + origin.getHost() + (port(origin) == 443 ? "" : ":" + port(origin));
    }

    static String safeFilename(String name) {
        String safe = name == null ? "" : name.replaceAll("[\\\\/\\p{Cntrl}]", "_").trim();
        if (safe.isEmpty() || safe.equals(".") || safe.equals("..")) safe = "pos-export";
        return safe.substring(0, Math.min(150, safe.length()));
    }

    private static int port(URI uri) { return uri.getPort() == -1 ? 443 : uri.getPort(); }
}
