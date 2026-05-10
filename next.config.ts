import type { NextConfig } from "next";

// Static export → GitHub Pages. The browser-only PKCE flow doesn't need
// a Node server, so we ship as a static SPA.
//
// basePath = "/bracketeering" because Pages serves at
// https://jhomer192.github.io/bracketeering/. NEXT_PUBLIC_BASE_PATH lets
// `npm run dev` keep the empty base while CI builds set it.

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: basePath || undefined,
  // GitHub Pages can't run the next/image optimizer.
  images: { unoptimized: true },
  // Surface the basePath to the client so links + redirects line up.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
