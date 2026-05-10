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
  scope: "bracketeering.scope",
  postAuthReturn: "bracketeering.post_auth_return",
} as const;

// Scopes required to actually save the bracket as a Spotify playlist.
// Cover upload (`ugc-image-upload`) is best-effort; playlist create+populate
// is the hard requirement so older tokens that predate scope additions
// can be detected and re-authed proactively.
const EXPORT_REQUIRED_SCOPES = ["playlist-modify-private"];

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
  localStorage.removeItem(KEYS.scope);
}

/** Scopes the user actually granted on their most recent token. Spotify
 *  echoes these back on the token-exchange response. We persist them so
 *  scope-gated UI (like the Save-to-Spotify button) can pre-flight check
 *  instead of failing mid-call. */
export function getGrantedScopes(): string[] {
  const s = localStorage.getItem(KEYS.scope);
  return s ? s.split(/\s+/).filter(Boolean) : [];
}

/** Does the current token have everything we need to create a playlist?
 *  Optimistic: if we have NO scope record at all (older session, before we
 *  started persisting `data.scope`), assume the token is fine and let the
 *  actual API call surface a real 403 / insufficient_scope. Strict mode
 *  would otherwise loop the user through reauth that doesn't fix anything. */
export function hasExportScopes(): boolean {
  const granted = getGrantedScopes();
  if (granted.length === 0) return true; // unknown — let the call try
  const set = new Set(granted);
  return EXPORT_REQUIRED_SCOPES.every((s) => set.has(s));
}

/** Kick off PKCE: generate verifier, stash it, redirect to Spotify. If
 *  `returnTo` is provided (e.g. "/reveal/"), the callback page redirects
 *  there instead of the default /pool/ — useful for self-healing re-auth
 *  triggered from anywhere in the app. `forceConsent` adds `show_dialog=true`
 *  so Spotify always shows the consent screen — used by re-auth flows where
 *  the user needs to actually grant new scopes (otherwise Spotify
 *  auto-approves silently and `data.scope` echoes back the OLD grant). */
export async function startLogin(returnTo?: string, forceConsent = false) {
  const clientId = getClientId();
  if (!clientId) throw new Error("no client_id stored — visit /setup first");

  if (returnTo) sessionStorage.setItem(KEYS.postAuthReturn, returnTo);
  else sessionStorage.removeItem(KEYS.postAuthReturn);

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
  if (forceConsent) params.set("show_dialog", "true");
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
  if (data.scope) localStorage.setItem(KEYS.scope, data.scope);
}

/** Pop the post-auth return path stashed by startLogin(). One-shot. */
export function consumePostAuthReturn(): string | null {
  const v = sessionStorage.getItem(KEYS.postAuthReturn);
  if (v) sessionStorage.removeItem(KEYS.postAuthReturn);
  return v;
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
