// Thin Spotify Web API client — token-based, browser-only.
//
// PKCE model: the client_id lives in localStorage (set on /setup), there
// is no client_secret anywhere, and every Spotify call goes browser →
// api.spotify.com directly. Spotify's CORS allow-list covers all the
// endpoints this app touches.

import { getAccessToken } from "./auth";

const API = "https://api.spotify.com/v1";

// Minimum scopes for the actual workflow: pull listening history, build the
// pool, write a private playlist, attach a cover. We deliberately do NOT ask
// for `playlist-modify-public` — the export always sets `public: false`, so
// requesting public-write would over-grant on the consent screen for no
// functional benefit. (Less scope == less scary on the OAuth screen.)
export const SCOPES = [
  "user-top-read",
  "user-library-read",
  "user-read-recently-played",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "ugc-image-upload",
].join(" ");

export type SpotifyTrack = {
  id: string;
  name: string;
  uri: string;
  preview_url: string | null;
  duration_ms: number;
  artists: Array<{ id: string; name: string }>;
  album: {
    id: string;
    name: string;
    images: Array<{ url: string; width: number; height: number }>;
  };
};

export type SpotifyArtist = {
  id: string;
  name: string;
  genres: string[];
};

/** Read just enough of a Spotify error body to surface the actionable bit
 *  (scope hint, dev-allowlist message) without echoing the whole reply,
 *  which can include the request `q` param or other reflection vectors.
 *  Drains the body either way so the connection isn't held. */
async function summarizeSpotifyError(res: Response, path: string): Promise<string> {
  const raw = await res.text().catch(() => "");
  // Spotify error JSON shape: { error: { status, message } }. The message
  // is curated by Spotify; the rest of the body sometimes echoes request
  // fragments, so only keep `error.message`.
  let safe = "";
  try {
    const j = JSON.parse(raw) as { error?: { message?: string } };
    if (typeof j.error?.message === "string") safe = j.error.message;
  } catch {
    // non-JSON (HTML during outage, empty) — keep `safe` empty
  }
  return safe ? `spotify ${path} ${res.status}: ${safe}` : `spotify ${path} ${res.status}`;
}

/** GET helper that auto-refreshes the access token if needed. */
export async function spotifyFetch<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await summarizeSpotifyError(res, path));
  return (await res.json()) as T;
}

/** Generic Spotify call with method/body — used by playlist export. */
export async function spotifyCall<T>(
  path: string,
  init: { method: string; body?: string; contentType?: string } = { method: "GET" },
): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (init.contentType) headers["Content-Type"] = init.contentType;
  const res = await fetch(`${API}${path}`, {
    method: init.method,
    headers,
    body: init.body,
  });
  if (!res.ok) throw new Error(await summarizeSpotifyError(res, path));
  // 204 no-content (playlist image upload) returns empty. Some endpoints can
  // also reply with non-JSON bodies on edge cases (HTML during a Spotify
  // outage, e.g.) — guard the parse so callers see a clean empty object
  // instead of an opaque "Unexpected token" SyntaxError.
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}
