import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/session";
import { buildPool } from "@/lib/pool";

export async function GET() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.access_token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  try {
    const result = await buildPool(session);
    await session.save(); // persist any token refresh
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
