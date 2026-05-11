// Spotify playlist export — creates two private playlists (Top 10 + Top 25)
// from the user's ranked list and uploads composed cover art to each.
//
// Cover art is a grid of album covers from the ranked tracks, drawn into
// a <canvas>, encoded as JPEG, base64-stripped, and PUT to Spotify's
// `ugc-image-upload` endpoint. Spotify caps cover uploads at 256KB JPEG.
//
// CORS: i.scdn.co (Spotify's image CDN) sets `Access-Control-Allow-Origin: *`,
// so we can load images with `crossOrigin = "anonymous"` and read pixels back
// from canvas without tainting.

import { spotifyFetch, spotifyCall, type SpotifyTrack } from "./spotify";
import { getSpotifyUserId } from "./auth";

const COVER_SIZE = 600; // px, square. Spotify recommends ≥300×300.
const JPEG_QUALITY = 0.82;
const MAX_BYTES = 256 * 1024;

export type ExportResult = {
  top10: { id: string; url: string };
  top25: { id: string; url: string };
};

/** Top-level: ranked must be 1..25 entries, ordered best → worst. */
export async function exportPlaylists(ranked: SpotifyTrack[]): Promise<ExportResult> {
  if (ranked.length === 0) throw new Error("nothing to export");

  // Always resolve identity from the live token, never from cache. If a user
  // ever switched Spotify accounts mid-session and our callback's `/me` fetch
  // happened to fail, the cached spotify_user_id is now from
  // the WRONG account and POSTing to `/users/{wrongId}/playlists` 403s. The
  // live call costs one round-trip and removes a whole class of stale-state
  // bugs. Cache fallback only if the live call fails (offline, rate-limited).
  let userId: string;
  try {
    const me = await spotifyFetch<{ id: string }>("/me");
    userId = me.id;
  } catch {
    const cached = getSpotifyUserId();
    if (!cached) throw new Error("could not resolve Spotify user");
    userId = cached;
  }

  const top10Tracks = ranked.slice(0, Math.min(10, ranked.length));
  const top25Tracks = ranked.slice(0, Math.min(25, ranked.length));

  // Compose covers in parallel (independent canvas work).
  const [top10Cover, top25Cover] = await Promise.all([
    composeCover(top10Tracks, 2), // 2×2
    composeCover(top25Tracks, 3), // 3×3
  ]);

  // Spotify's playlist creation + image upload happen serially per playlist,
  // but the two playlists run in parallel.
  const [p10, p25] = await Promise.all([
    createPopulatedPlaylist(userId, "My Top 10 — Songrank", top10Tracks, top10Cover),
    createPopulatedPlaylist(userId, "My Top 25 — Songrank", top25Tracks, top25Cover),
  ]);

  return { top10: p10, top25: p25 };
}

async function createPopulatedPlaylist(
  userId: string,
  name: string,
  tracks: SpotifyTrack[],
  coverBase64Jpeg: string,
): Promise<{ id: string; url: string }> {
  const created = await spotifyCall<{ id: string; external_urls: { spotify: string } }>(
    `/users/${encodeURIComponent(userId)}/playlists`,
    {
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({
        name,
        public: false,
        description: "Built with Songrank — pairwise-vote your way to your real top 25.",
      }),
    },
  );
  if (tracks.length > 0) {
    await spotifyCall(`/playlists/${created.id}/tracks`, {
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ uris: tracks.map((t) => t.uri) }),
    });
  }
  // Cover art is best-effort — failure shouldn't tank the export.
  try {
    await spotifyCall(`/playlists/${created.id}/images`, {
      method: "PUT",
      contentType: "image/jpeg",
      body: coverBase64Jpeg,
    });
  } catch {
    // Cover upload is best-effort. The user may not have `ugc-image-upload`
    // scope, the JPEG may be over Spotify's 256KB limit on some browsers, or
    // the upload may transiently 5xx. None of those should fail the export —
    // the playlist itself is already created above.
  }
  return { id: created.id, url: created.external_urls.spotify };
}

/** Compose a `gridSize × gridSize` mosaic of album covers, JPEG-encoded
 *  base64 (no data: prefix) — Spotify's image upload format. */
async function composeCover(tracks: SpotifyTrack[], gridSize: 2 | 3): Promise<string> {
  const slots = gridSize * gridSize;
  // Pick evenly-spaced tracks so the cover represents the full ranking,
  // not just the top of the list. Always include #1 + #last as anchors.
  const picks = pickEvenly(tracks, slots);

  const imgs = await Promise.all(picks.map((t) => loadImage(t.album.images?.[0]?.url ?? "")));

  const canvas = document.createElement("canvas");
  canvas.width = COVER_SIZE;
  canvas.height = COVER_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  // Black bg in case any image fails — better than transparent (which JPEG renders as black anyway).
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, COVER_SIZE, COVER_SIZE);

  const cell = COVER_SIZE / gridSize;
  imgs.forEach((img, i) => {
    if (!img) return;
    const x = (i % gridSize) * cell;
    const y = Math.floor(i / gridSize) * cell;
    drawCover(ctx, img, x, y, cell, cell);
  });

  // Iteratively step quality down until under the byte budget — covers
  // for 9-image mosaics at q=0.82 are usually ~80–120KB; this is just a
  // safety net for edge cases.
  let quality = JPEG_QUALITY;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (estimateBase64Bytes(dataUrl) > MAX_BYTES && quality > 0.4) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  // Strip the `data:image/jpeg;base64,` prefix — Spotify wants raw base64.
  return dataUrl.replace(/^data:image\/jpeg;base64,/, "");
}

function pickEvenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr.slice();
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (arr.length - 1)) / (n - 1));
    out.push(arr[idx]);
  }
  return out;
}

/** Draw `img` into `(x,y,w,h)` with object-fit: cover semantics. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const ir = img.naturalWidth / img.naturalHeight;
  const dr = w / h;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (ir > dr) {
    // image wider than dest → crop sides
    sw = img.naturalHeight * dr;
    sx = (img.naturalWidth - sw) / 2;
  } else if (ir < dr) {
    sh = img.naturalWidth / dr;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // missing image → blank cell
    img.src = url;
  });
}

function estimateBase64Bytes(dataUrl: string): number {
  // base64 → bytes: 3 bytes per 4 chars, minus padding.
  const base64 = dataUrl.split(",")[1] ?? dataUrl;
  return Math.floor((base64.length * 3) / 4);
}
