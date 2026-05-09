import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/session";
import { exchangeCode, spotifyFetch } from "@/lib/spotify";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  if (error) {
    return NextResponse.redirect(`${base}/?err=${encodeURIComponent(error)}`);
  }
  if (!code || !state || state !== session.oauth_state) {
    return NextResponse.redirect(`${base}/?err=state_mismatch`);
  }
  delete session.oauth_state;

  const tok = await exchangeCode(code);
  session.access_token = tok.access_token;
  session.refresh_token = tok.refresh_token;
  session.expires_at = Date.now() + tok.expires_in * 1000;
  await session.save();

  // Fetch /me to stash display info — small, useful for the header.
  try {
    const me = await spotifyFetch<{ id: string; display_name: string }>(session, "/me");
    session.spotify_user_id = me.id;
    session.display_name = me.display_name;
    await session.save();
  } catch {
    // Non-fatal; user can still proceed.
  }

  return NextResponse.redirect(`${base}/pool`);
}
