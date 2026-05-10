"use client";

import { useEffect, useState } from "react";
import { exchangeCodeForTokens, setIdentity, consumePostAuthReturn } from "@/lib/auth";
import { spotifyFetch } from "@/lib/spotify";
import { consumeVerifier } from "@/lib/pkce";

export default function CallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const oauthErr = params.get("error");

    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

    (async () => {
      if (oauthErr) {
        setError(`Spotify denied: ${oauthErr}`);
        return;
      }
      const stash = consumeVerifier();
      if (!code || !state || !stash) {
        setError("Missing OAuth state — please try again.");
        return;
      }
      if (state !== stash.state) {
        setError("State mismatch — possible CSRF, please try again.");
        return;
      }
      try {
        await exchangeCodeForTokens(code, stash.verifier);
        // Stash identity so /pool can label things.
        try {
          const me = await spotifyFetch<{ id: string; display_name: string }>("/me");
          setIdentity(me.id, me.display_name);
        } catch {
          // non-fatal
        }
        // Honor any return path stashed before login (e.g. self-healing
        // re-auth from /reveal/). Default lands on /pool/.
        const ret = consumePostAuthReturn();
        window.location.replace(`${basePath}${ret ?? "/pool/"}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "token exchange failed");
      }
    })();
  }, []);

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-50 flex items-center justify-center px-6 py-12">
      <div className="max-w-md text-center space-y-4">
        {error ? (
          <>
            <p className="text-red-400 font-semibold">Couldn&apos;t finish login</p>
            <p className="text-zinc-500 text-sm break-all">{error}</p>
            <a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`} className="text-zinc-300 underline">
              Start over
            </a>
          </>
        ) : (
          <>
            <div className="text-2xl font-semibold">Finishing login…</div>
            <div className="text-zinc-500 text-sm">Exchanging your code with Spotify</div>
          </>
        )}
      </div>
    </main>
  );
}
