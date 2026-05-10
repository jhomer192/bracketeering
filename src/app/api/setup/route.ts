import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/session";

// Accepts the user's Spotify Developer App Client ID + Secret (BYO model).
// Stores them in the iron-session cookie (encrypted at rest by iron-session)
// and bounces to /api/spotify/login to start OAuth.

const CLIENT_ID_RE = /^[a-f0-9]{32}$/i;     // Spotify IDs are 32-char hex
const CLIENT_SECRET_RE = /^[a-f0-9]{32}$/i; // Same shape

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const client_id = String(form.get("client_id") ?? "").trim();
  const client_secret = String(form.get("client_secret") ?? "").trim();

  if (!CLIENT_ID_RE.test(client_id)) {
    return redirectWithErr(req, "bad_client_id");
  }
  if (!CLIENT_SECRET_RE.test(client_secret)) {
    return redirectWithErr(req, "bad_client_secret");
  }

  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.client_id = client_id;
  session.client_secret = client_secret;
  // Clear any stale identity so callback re-derives it from the new creds.
  delete session.access_token;
  delete session.refresh_token;
  delete session.expires_at;
  delete session.spotify_user_id;
  delete session.display_name;
  await session.save();

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://127.0.0.1:3000";
  return NextResponse.redirect(`${base}/api/spotify/login`);
}

function redirectWithErr(_req: NextRequest, code: string) {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://127.0.0.1:3000";
  return NextResponse.redirect(`${base}/setup?err=${encodeURIComponent(code)}`);
}
