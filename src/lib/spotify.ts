// Thin Spotify Web API client — token-based, browser-only.
//
// PKCE model: the client_id lives in localStorage (set on /setup), there
// is no client_secret anywhere, and every Spotify call goes browser →
// api.spotify.com directly. Spotify's CORS allow-list covers all the
// endpoints this app touches.

import { getAccessToken } from "./auth";

const API = "https://api.spotify.com/v1";

export const SCOPES = [
  "user-top-read",
  "user-library-read",
  "user-read-recently-played",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
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

/** GET helper that auto-refreshes the access token if needed. */
export async function spotifyFetch<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`spotify ${path} → ${res.status}: ${await res.text()}`);
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
  if (!res.ok) throw new Error(`spotify ${path} → ${res.status}: ${await res.text()}`);
  // 204 no-content (playlist image upload) returns empty
  const text = await res.text();
  return (text ? JSON.parse(text) : ({} as T)) as T;
}
