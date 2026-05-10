import type { SessionOptions } from "iron-session";

export type SessionData = {
  // BYO Spotify Developer App credentials — supplied by user on /setup.
  // Stored in iron-session's encrypted cookie; mirrored to Supabase
  // (secret AES-encrypted) on successful OAuth.
  client_id?: string;
  client_secret?: string;

  // Spotify identity + tokens, populated after OAuth callback.
  spotify_user_id?: string;
  display_name?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number; // unix ms

  oauth_state?: string; // CSRF nonce during /login → /callback hop
};

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_PASSWORD ?? "dev-only-do-not-use-this-password-in-prod-32+",
  cookieName: "bracketeering_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 1 week
  },
};
