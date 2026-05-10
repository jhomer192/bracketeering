// Thin Spotify Web API client. No SDK — just typed fetch wrappers.
// Handles token refresh transparently when the session has a refresh_token.
//
// BYO Client ID model: client_id + client_secret come from the user's
// session (set on /setup), not from env. Only the redirect URI is server-
// controlled (one shared URL per deployment, added by each user to their
// own Spotify dev app's allow-list).

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

/** Where Spotify redirects users back after consent. Server-controlled, one
 *  per deployment (each user adds this exact URL to their own dev app). */
export function getRedirectUri() {
  return requireEnv("SPOTIFY_REDIRECT_URI");
}

export function buildAuthUrl(session: SessionData, state: string) {
  if (!session.client_id) throw new Error("no client_id in session — visit /setup first");
  const params = new URLSearchParams({
    client_id: session.client_id,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    state,
    show_dialog: "false",
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCode(session: SessionData, code: string) {
  const { client_id, client_secret } = mustHaveCreds(session);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(client_id, client_secret),
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
  const { client_id, client_secret } = mustHaveCreds(session);

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refresh_token,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(client_id, client_secret),
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

function mustHaveCreds(session: SessionData): { client_id: string; client_secret: string } {
  if (!session.client_id || !session.client_secret) {
    throw new Error("session missing BYO Spotify creds — visit /setup");
  }
  return { client_id: session.client_id, client_secret: session.client_secret };
}

function basicAuth(id: string, secret: string) {
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
