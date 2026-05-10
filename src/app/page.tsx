"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getClientId, isAuthed, startLogin } from "@/lib/auth";
import { LogoMark } from "@/components/Logo";

export default function Home() {
  const [hasClientId, setHasClientId] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHasClientId(!!getClientId());
    setAuthed(isAuthed());
  }, []);

  async function onConnect() {
    if (!hasClientId) return; // Link will route to /setup
    setBusy(true);
    try {
      await startLogin();
    } catch {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-50 flex flex-col items-center justify-center px-5 py-10 sm:py-12 relative overflow-hidden">
      {/* Soft brand-green radial behind the hero — the only ornamental flourish
          on the home screen. Keeps the page from feeling like a flat dialog. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_30%,rgba(29,185,84,0.18),transparent_70%)]"
      />
      <div className="relative max-w-md w-full space-y-7 sm:space-y-8 text-center">
        <div className="space-y-4">
          <div className="flex justify-center">
            <LogoMark size={56} />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">Bracketeering</h1>
          <p className="text-zinc-400 text-base sm:text-lg leading-snug">
            Vote &quot;this or that&quot; on 128 of your songs. Walk away with a real
            top 10 — and a Spotify playlist that proves it.
          </p>
        </div>

        {authed ? (
          <Link
            href="/pool/"
            className="inline-flex items-center justify-center gap-3 w-full h-14 rounded-full bg-[#1DB954] hover:bg-[#1ed760] active:scale-[0.98] transition text-black font-semibold text-lg"
          >
            <SpotifyMark />
            Continue →
          </Link>
        ) : hasClientId ? (
          <button
            onClick={onConnect}
            disabled={busy}
            className="inline-flex items-center justify-center gap-3 w-full h-14 rounded-full bg-[#1DB954] hover:bg-[#1ed760] active:scale-[0.98] disabled:opacity-50 transition text-black font-semibold text-lg"
          >
            <SpotifyMark />
            {busy ? "Redirecting…" : "Connect Spotify"}
          </button>
        ) : (
          <Link
            href="/setup/"
            className="inline-flex items-center justify-center gap-3 w-full h-14 rounded-full bg-[#1DB954] hover:bg-[#1ed760] active:scale-[0.98] transition text-black font-semibold text-lg"
          >
            <SpotifyMark />
            Connect Spotify
          </Link>
        )}

        <ol className="text-sm text-zinc-500 space-y-1 text-left max-w-xs mx-auto">
          <li>1. 90-sec one-time setup (Spotify dev keys).</li>
          <li>2. We pull your 64 most-recent + 64 all-time.</li>
          <li>3. You sub in any songs we missed.</li>
          <li>4. ~400 quick taps, ~20 minutes.</li>
          <li>5. Top 10 + Top 25 saved to your Spotify.</li>
        </ol>
        <p className="text-xs text-zinc-600 max-w-xs mx-auto">
          Step 1 sounds annoying but it&apos;s how we let any number of people use this
          for free. Spotify caps shared apps at 5 friends.
        </p>
      </div>
    </main>
  );
}

function SpotifyMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.301.42-1.02.599-1.561.3z" />
    </svg>
  );
}
