// PKCE helpers (RFC 7636, S256). All browser-side via Web Crypto.
//
// We generate a random code_verifier (43–128 chars from the unreserved
// set), compute code_challenge = base64url(SHA-256(verifier)), and stash
// the verifier in sessionStorage until the callback exchange.

const VERIFIER_KEY = "songrank.pkce.verifier";
const STATE_KEY = "songrank.pkce.state";

function base64UrlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBase64Url(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function generateCodeVerifier(): string {
  // 64 random bytes → ~86 base64url chars, comfortably in [43,128].
  return randomBase64Url(64);
}

export async function codeChallengeFromVerifier(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}

export function generateState(): string {
  return randomBase64Url(16);
}

export function stashVerifier(verifier: string, state: string) {
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
}

export function consumeVerifier(): { verifier: string; state: string } | null {
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const state = sessionStorage.getItem(STATE_KEY);
  if (!verifier || !state) return null;
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  return { verifier, state };
}
