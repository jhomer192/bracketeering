"use client";

import { useEffect, useState } from "react";
import type { PoolEntry } from "@/lib/pool";
import { loadRanked, clearRunState } from "@/lib/storage";
import { exportPlaylists, type ExportResult } from "@/lib/export";
import { isAuthed } from "@/lib/auth";
import { getQuips } from "@/lib/quips";

export default function RevealPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [ranked, setRanked] = useState<PoolEntry[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const [quips, setQuips] = useState<string[]>([]);

  useEffect(() => {
    if (!isAuthed()) {
      window.location.replace(`${basePath}/`);
      return;
    }
    const r = loadRanked();
    if (!r || r.length === 0) {
      setMissing(true);
      return;
    }
    setRanked(r);
    setQuips(getQuips(r, 2));
  }, [basePath]);

  if (missing) {
    return (
      <main className="min-h-dvh bg-zinc-950 text-zinc-50 flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-4">
          <p className="text-zinc-300">No results yet.</p>
          <a href={`${basePath}/pool/`} className="text-emerald-400 underline">
            Build your 128 →
          </a>
        </div>
      </main>
    );
  }

  if (!ranked) return <Loading />;

  async function onExport() {
    if (!ranked) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await exportPlaylists(ranked);
      setExported(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "export failed");
    } finally {
      setBusy(false);
    }
  }

  const top10 = ranked.slice(0, 10);
  const visible = showAll ? ranked : top10;

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-50 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <header className="border-b border-zinc-800">
        <div className="max-w-2xl mx-auto px-4 py-4 sm:py-5">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Your top {showAll ? ranked.length : 10}
          </h1>
          <p className="text-zinc-500 text-xs sm:text-sm mt-1">
            Vote-decided ranking · {ranked.length} fully ranked
          </p>
        </div>
      </header>

      {quips.length > 0 && (
        <section className="max-w-2xl mx-auto px-3 sm:px-4 mt-4 sm:mt-5">
          {/* Sarcastic-but-affectionate read on the user's taste. Refreshable
              so people can keep cycling through hot takes. */}
          <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-fuchsia-950/30 via-zinc-900/40 to-zinc-900/40 p-4 sm:p-5 relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-[0.22em] text-fuchsia-300/80 font-semibold">
                The Verdict
              </span>
              <button
                onClick={() => ranked && setQuips(getQuips(ranked, 2))}
                aria-label="Get a fresh roast"
                className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:text-fuchsia-300 transition px-2 py-0.5 rounded-full border border-zinc-800 hover:border-fuchsia-700/60"
              >
                roast me again ↻
              </button>
            </div>
            <ul className="space-y-2">
              {quips.map((q, i) => (
                <li
                  key={`${i}-${q}`}
                  className="text-sm sm:text-[15px] text-zinc-200 leading-snug"
                >
                  <span className="text-fuchsia-400/70 mr-2">›</span>
                  {q}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <ol className="max-w-2xl mx-auto px-3 sm:px-4 mt-4 sm:mt-6 space-y-1.5">
        {visible.map((t, i) => (
          <li
            key={t.id}
            className="flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/40 p-1.5 pr-3"
          >
            <div className="w-6 sm:w-8 text-right font-mono text-zinc-500 text-xs sm:text-sm tabular-nums">
              {i + 1}
            </div>
            {t.album.images?.[0]?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={t.album.images[0].url}
                alt=""
                className="w-11 h-11 sm:w-12 sm:h-12 rounded-md object-cover flex-none"
              />
            ) : (
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-md bg-zinc-800 flex-none" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm leading-tight truncate">{t.name}</div>
              <div className="text-[11px] sm:text-xs text-zinc-500 leading-tight truncate mt-0.5">
                {t.artists.map((a) => a.name).join(", ")}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="max-w-2xl mx-auto px-4 mt-3 flex items-center gap-4 flex-wrap">
        {ranked.length > 10 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-sm text-zinc-400 hover:text-zinc-200 underline"
          >
            {showAll ? "show top 10 only" : `show all ${ranked.length}`}
          </button>
        )}
        <button
          onClick={async () => {
            // "1. Track — Artist[, Artist]" lines, with a small header and a
            // share line so it pastes nicely into Notes / iMessage / a tweet.
            const list = (showAll ? ranked : ranked.slice(0, 10))
              .map((t, i) => `${i + 1}. ${t.name} — ${t.artists.map((a) => a.name).join(", ")}`)
              .join("\n");
            const header = `My top ${showAll ? ranked.length : 10} (Bracketeering)`;
            const text = `${header}\n\n${list}\n\nbracketeer yours: https://jhomer192.github.io/bracketeering/`;
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              window.prompt("Copy:", text);
            }
          }}
          className="text-sm text-zinc-400 hover:text-zinc-200 underline"
        >
          {copied ? "copied ✓" : "copy as text"}
        </button>
      </div>

      <section className="max-w-2xl mx-auto px-3 sm:px-4 mt-6 sm:mt-10">
        {exported ? (
          <div className="rounded-2xl border border-emerald-700/60 bg-emerald-950/40 p-5 space-y-3">
            <p className="font-semibold text-emerald-200">Saved to Spotify ✓</p>
            <a
              href={exported.top10.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-emerald-700/60 bg-zinc-950 px-4 py-3 hover:bg-zinc-900 transition"
            >
              <div className="text-sm text-emerald-300">Open in Spotify →</div>
              <div className="font-medium">My Top 10 — Bracketeering</div>
            </a>
            <a
              href={exported.top25.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-emerald-700/60 bg-zinc-950 px-4 py-3 hover:bg-zinc-900 transition"
            >
              <div className="text-sm text-emerald-300">Open in Spotify →</div>
              <div className="font-medium">My Top 25 — Bracketeering</div>
            </a>
          </div>
        ) : (
          <button
            onClick={onExport}
            disabled={busy}
            className="w-full h-14 rounded-full bg-[#1DB954] hover:bg-[#1ed760] active:scale-[0.98] disabled:opacity-50 transition text-black font-semibold text-lg"
          >
            {busy ? "Saving to Spotify…" : "Save to Spotify (Top 10 + Top 25)"}
          </button>
        )}
        {err && (
          <div className="mt-3 rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-sm text-red-200 break-all">
            {err}
          </div>
        )}
      </section>

      <div className="max-w-2xl mx-auto px-4 mt-10 text-center">
        <button
          onClick={() => {
            if (confirm("Start a fresh run? Your current ranking will be cleared.")) {
              clearRunState();
              window.location.href = `${basePath}/`;
            }
          }}
          className="text-xs text-zinc-500 hover:text-zinc-300 underline"
        >
          start over
        </button>
      </div>
    </main>
  );
}

function Loading() {
  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-50 flex items-center justify-center">
      <div className="text-zinc-400">Loading…</div>
    </main>
  );
}
