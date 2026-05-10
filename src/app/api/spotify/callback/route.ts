import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/session";
import { exchangeCode, spotifyFetch } from "@/lib/spotify";
import { supabaseServer } from "@/lib/supabase";
import { encrypt } from "@/lib/encryption";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://127.0.0.1:3000";

  if (error) {
    return NextResponse.redirect(`${base}/?err=${encodeURIComponent(error)}`);
  }
  if (!code || !state || state !== session.oauth_state) {
    return NextResponse.redirect(`${base}/?err=state_mismatch`);
  }
  if (!session.client_id || !session.client_secret) {
    return NextResponse.redirect(`${base}/setup?err=missing_creds`);
  }
  delete session.oauth_state;

  const tok = await exchangeCode(session, code);
  session.access_token = tok.access_token;
  session.refresh_token = tok.refresh_token;
  session.expires_at = Date.now() + tok.expires_in * 1000;
  await session.save();

  // Fetch /me to stash identity, then upsert BYO creds keyed by spotify_user_id.
  try {
    const me = await spotifyFetch<{ id: string; display_name: string }>(session, "/me");
    session.spotify_user_id = me.id;
    session.display_name = me.display_name;
    await session.save();

    const { error: upsertErr } = await supabaseServer()
      .from("bracketeering_user_creds")
      .upsert(
        {
          spotify_user_id: me.id,
          display_name: me.display_name,
          client_id: session.client_id,
          client_secret_encrypted: encrypt(session.client_secret),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "spotify_user_id" },
      );
    if (upsertErr) {
      // Don't block the user — log + continue. Cookie still has everything needed.
      console.error("supabase upsert failed:", upsertErr);
    }
  } catch (e) {
    console.error("post-OAuth identity step failed:", e);
  }

  return NextResponse.redirect(`${base}/pool`);
}
