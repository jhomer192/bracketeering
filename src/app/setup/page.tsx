"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { setClientId, startLogin, getRedirectUri, getClientId } from "@/lib/auth";

const CLIENT_ID_RE = /^[a-f0-9]{32}$/i;

export default function SetupPage() {
  const [redirectUri, setRedirectUri] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setRedirectUri(getRedirectUri());
    const existing = getClientId();
    if (existing) setValue(existing);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const id = value.trim();
    if (!CLIENT_ID_RE.test(id)) {
      setErr("That doesn't look like a Spotify Client ID (should be 32 hex chars).");
      return;
    }
    setSubmitting(true);
    try {
      setClientId(id);
      await startLogin(); // redirects to Spotify
    } catch (e) {
      setSubmitting(false);
      setErr(e instanceof Error ? e.message : "unknown error");
    }
  }

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-50 px-6 py-10 pb-24">
      <div className="max-w-xl mx-auto space-y-8">
        <div>
          <Link href="/" className="text-zinc-500 text-sm hover:text-zinc-300">
            ← back
          </Link>
          <h1 className="text-3xl font-bold mt-2">One-time setup</h1>
          <p className="text-zinc-400 mt-2 leading-relaxed">
            Spotify caps each developer app at 5 friends total. To use Bracketeering
            without that cap, you make your own free Spotify dev app — takes about 90
            seconds — and paste the Client ID below. Bracketeering runs entirely in
            your browser; we never see your music data or your Spotify keys.
          </p>
        </div>

        {err && (
          <div className="rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {err}
          </div>
        )}

        <ol className="space-y-5 text-sm">
          <li className="flex gap-3">
            <Step n={1} />
            <div>
              <p>
                Open the Spotify Developer Dashboard:{" "}
                <a
                  href="https://developer.spotify.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 underline"
                >
                  developer.spotify.com/dashboard
                </a>
              </p>
              <p className="text-zinc-500 mt-1">
                Sign in with your Spotify Premium account if you aren&apos;t already.
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <Step n={2} />
            <div>
              <p>Click <strong>Create app</strong> (top right).</p>
            </div>
          </li>

          <li className="flex gap-3">
            <Step n={3} />
            <div>
              <p>Fill in the form:</p>
              <ul className="mt-2 space-y-1 text-zinc-400">
                <li>
                  <span className="text-zinc-300">App name:</span> anything (e.g. &quot;Bracketeering&quot;)
                </li>
                <li>
                  <span className="text-zinc-300">App description:</span> anything
                </li>
                <li>
                  <span className="text-zinc-300">Redirect URI:</span> copy the exact URL below and click <strong>Add</strong>
                </li>
                <li>
                  <span className="text-zinc-300">APIs:</span> check <strong>Web API</strong> only
                </li>
                <li>Accept the Developer Terms of Service → <strong>Save</strong></li>
              </ul>

              <CopyBlock label="Redirect URI" value={redirectUri} />
            </div>
          </li>

          <li className="flex gap-3">
            <Step n={4} />
            <div>
              <p>
                On your new app&apos;s page → click <strong>Settings</strong> (top right) and
                copy the <strong>Client ID</strong>. (You can ignore the client secret —
                Bracketeering uses PKCE and doesn&apos;t need it.)
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <Step n={5} />
            <div>
              <p>Paste it here:</p>
            </div>
          </li>
        </ol>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"
        >
          <label className="block">
            <span className="block text-sm text-zinc-300 mb-1">Client ID</span>
            <input
              name="client_id"
              type="text"
              required
              spellCheck={false}
              autoComplete="off"
              placeholder="32-character hex string"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full h-11 rounded-lg bg-zinc-950 border border-zinc-800 px-3 font-mono text-sm focus:outline-none focus:border-zinc-600"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-full bg-[#1DB954] hover:bg-[#1ed760] active:scale-[0.98] disabled:opacity-50 transition text-black font-semibold"
          >
            {submitting ? "Redirecting…" : "Connect Spotify →"}
          </button>
          <p className="text-xs text-zinc-500 text-center">
            Stored in your browser only. Never sent to us.
          </p>
        </form>
      </div>
    </main>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex-none w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 text-center font-mono text-sm leading-7">
      {n}
    </span>
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs break-all">
      <div className="text-zinc-500 text-[10px] uppercase tracking-wide mb-1">{label}</div>
      {value || <span className="text-zinc-600">loading…</span>}
    </div>
  );
}
