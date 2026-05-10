// Browser-side auth state. localStorage keeps the user logged in across
// reloads; sessionStorage holds the PKCE verifier only during the redirect
// dance (see lib/pkce.ts).
//
// Tokens here are an obvious XSS target — the trade-off is that this app
// is a static SPA with no backend, no third-party scripts, and a strict
// CSP could be added later. For a 90-second-setup tool talking to one
// API (Spotify), the risk surface is small and the simplification is huge.

import {
  generateCodeVerifier,
  codeChallengeFromVerifier,
  generateState,
  stashVerifier,
} from "./pkce";
import { SCOPES } from "./spotify";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const AUTH_URL = "https://accounts.spotify.com/authorize";

const KEYS = {
  clientId: "bracketeering.client_id",
  accessToken: "bracketeering.access_token",
  refreshToken: "bracketeering.refresh_token",
  expiresAt: "bracketeering.expires_at",
  displayName: "bracketeering.display_name",
  spotifyUserId: "bracketeering.spotify_user_id",
} as const;

/** Resolve the redirect URI from the live origin + Next basePath. Same URL
 *  must be registered in the user's Spotify dev app. */
export function getRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${window.location.origin}${base}/callback/`;
}

export function getClientId(): string | null {
  return localStorage.getItem(KEYS.clientId);
}

export function setClientId(id: string) {
  localStorage.setItem(KEYS.clientId, id);
}

export function clearClientId() {
  localStorage.removeItem(KEYS.clientId);
}

export function getDisplayName(): string | null {
  return localStorage.getItem(KEYS.displayName);
}

export function isAuthed(): boolean {
  return !!localStorage.getItem(KEYS.accessToken);
}

export function logout() {
  localStorage.removeItem(KEYS.accessToken);
  localStorage.removeItem(KEYS.refreshToken);
  localStorage.removeItem(KEYS.expiresAt);
  localStorage.removeItem(KEYS.displayName);
  localStorage.removeItem(KEYS.spotifyUserId);
}

/** Kick off PKCE: generate verifier, stash it, redirect to Spotify. */
export async function startLogin() {
  const clientId = getClientId();
  if (!clientId) throw new Error("no client_id stored — visit /setup first");

  const verifier = generateCodeVerifier();
  const challenge = await codeChallengeFromVerifier(verifier);
  const state = generateState();
  stashVerifier(verifier, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  window.location.href = `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

/** Exchange ?code= for tokens (PKCE — no client_secret needed). */
export async function exchangeCodeForTokens(code: string, verifier: string): Promise<void> {
  const clientId = getClientId();
  if (!clientId) throw new Error("no client_id stored");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
    client_id: clientId,
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as TokenResponse;
  storeTokens(data);
}

function storeTokens(data: TokenResponse) {
  localStorage.setItem(KEYS.accessToken, data.access_token);
  if (data.refresh_token) localStorage.setItem(KEYS.refreshToken, data.refresh_token);
  localStorage.setItem(KEYS.expiresAt, String(Date.now() + data.expires_in * 1000));
}

/** Return a valid access_token, refreshing if within 30s of expiry. */
export async function getAccessToken(): Promise<string> {
  const access = localStorage.getItem(KEYS.accessToken);
  const exp = Number(localStorage.getItem(KEYS.expiresAt) ?? 0);
  if (access && exp > Date.now() + 30_000) return access;

  const refresh = localStorage.getItem(KEYS.refreshToken);
  const clientId = getClientId();
  if (!refresh || !clientId) throw new Error("re-auth required");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: clientId,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`refresh ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as TokenResponse;
  storeTokens(data);
  return data.access_token;
}

export function setIdentity(spotifyUserId: string, displayName: string) {
  localStorage.setItem(KEYS.spotifyUserId, spotifyUserId);
  localStorage.setItem(KEYS.displayName, displayName);
}

export function getSpotifyUserId(): string | null {
  return localStorage.getItem(KEYS.spotifyUserId);
}
