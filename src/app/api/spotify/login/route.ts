import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/session";
import { buildAuthUrl } from "@/lib/spotify";
import { randomBytes } from "node:crypto";

export async function GET() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://127.0.0.1:3000";
  if (!session.client_id || !session.client_secret) {
    // No BYO creds yet — bounce to setup.
    return NextResponse.redirect(`${base}/setup`);
  }
  const state = randomBytes(16).toString("hex");
  session.oauth_state = state;
  await session.save();
  return NextResponse.redirect(buildAuthUrl(session, state));
}
