// Thin Spotify Web API client. No SDK — just typed fetch wrappers.
// Handles token refresh transparently when the session has a refresh_token.

import type { SessionData } from "./session";

const API = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

export const SCOPES = [
  "user-top-read",
  "user-library-read",
  "user-read-recently-played",
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

type RefreshResult = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
};

export function buildAuthUrl(state: string) {
  const clientId = requireEnv("SPOTIFY_CLIENT_ID");
  const redirect = requireEnv("SPOTIFY_REDIRECT_URI");
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirect,
    scope: SCOPES,
    state,
    show_dialog: "false",
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCode(code: string) {
  const clientId = requireEnv("SPOTIFY_CLIENT_ID");
  const clientSecret = requireEnv("SPOTIFY_CLIENT_SECRET");
  const redirect = requireEnv("SPOTIFY_REDIRECT_URI");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`spotify token exchange ${res.status}: ${await res.text()}`);
  return (await res.json()) as RefreshResult & { refresh_token: string };
}

async function refreshIfNeeded(session: SessionData): Promise<string> {
  const now = Date.now();
  if (session.access_token && session.expires_at && session.expires_at > now + 30_000) {
    return session.access_token;
  }
  if (!session.refresh_token) throw new Error("no refresh_token in session — re-auth required");

  const clientId = requireEnv("SPOTIFY_CLIENT_ID");
  const clientSecret = requireEnv("SPOTIFY_CLIENT_SECRET");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refresh_token,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`spotify token refresh ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as RefreshResult;
  session.access_token = data.access_token;
  session.expires_at = now + data.expires_in * 1000;
  if (data.refresh_token) session.refresh_token = data.refresh_token;
  return data.access_token;
}

export async function spotifyFetch<T>(session: SessionData, path: string): Promise<T> {
  const token = await refreshIfNeeded(session);
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`spotify ${path} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
