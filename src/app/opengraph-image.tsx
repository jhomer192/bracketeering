// Static OG card — generated at build time by next/og. Lives at the route
// root so it's used for the home page; downstream pages inherit unless they
// declare their own. Keeps the share preview on-brand on Twitter/X, iMessage,
// Slack, etc. instead of falling back to a blank box.

import { ImageResponse } from "next/og";

export const alt = "Songrank — Vote your way to your real top 10";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Required for `output: 'export'` — bake the OG card at build time, not on
// request, so it's just another static asset on GitHub Pages.
export const dynamic = "force-static";

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          background:
            "linear-gradient(135deg, #09090b 0%, #18181b 60%, #052e16 100%)",
          padding: "80px",
          color: "#fafafa",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Brand mark: three descending bars (top-N ranking), scaled up */}
        <svg
          width="96"
          height="96"
          viewBox="0 0 64 64"
          fill="none"
          style={{ marginBottom: 32 }}
        >
          <rect width="64" height="64" rx="14" fill="#09090b" />
          <rect x="11" y="18" width="42" height="7" rx="3" fill="#1db954" />
          <rect x="11" y="29" width="32" height="7" rx="3" fill="#1db954" />
          <rect x="11" y="40" width="22" height="7" rx="3" fill="#1db954" />
        </svg>

        <div
          style={{
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 1,
            marginBottom: 24,
          }}
        >
          Songrank
        </div>

        <div
          style={{
            fontSize: 36,
            color: "#a1a1aa",
            lineHeight: 1.25,
            maxWidth: 920,
          }}
        >
          Vote &ldquo;this or that&rdquo; on 128 of your songs. Walk away with a
          ranked top 10.
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 56,
            right: 80,
            fontSize: 28,
            color: "#1db954",
            fontWeight: 600,
          }}
        >
          /128 → 10
        </div>
      </div>
    ),
    { ...size },
  );
}
