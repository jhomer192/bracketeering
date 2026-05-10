"use client";

import { useEffect, useMemo, useState } from "react";
import type { PoolEntry } from "@/lib/pool";
import { loadKeptPool, loadRanked, clearRunState } from "@/lib/storage";
import { exportPlaylists, type ExportResult } from "@/lib/export";
import { isAuthed, hasExportScopes, startLogin } from "@/lib/auth";
import { getQuips } from "@/lib/quips";

// Tier breakpoints. Voted: top 25 (compare engine's FLOOR). Beyond that,
// tracks are ordered by their pool position (best Spotify signal first).
type Tier = "top10" | "top25" | "top50" | "top100" | "top128";
const TIER_LIMITS: Record<Tier, number> = {
  top10: 10,
  top25: 25,
  top50: 50,
  top100: 100,
  top128: 128,
};
const TIER_LABELS: Record<Tier, string> = {
  top10: "Top 10",
  top25: "Top 25",
  top50: "Top 50",
  top100: "Top 100",
  top128: "Top 128",
};
const TIER_ORDER: Tier[] = ["top10", "top25", "top50", "top100", "top128"];

/** Which tier a 1-indexed rank falls into. */
function tierFor(rank: number): Tier {
  if (rank <= 10) return "top10";
  if (rank <= 25) return "top25";
  if (rank <= 50) return "top50";
  if (rank <= 100) return "top100";
  return "top128";
}

// Per-tier styling. Numbered medallion + left border give each row a
// glanceable tier without making the list feel like a kindergarten chart.
const TIER_STYLES: Record<
  Tier,
  { border: string; bg: string; medallion: string; label: string; tone: string }
> = {
  top10: {
    border: "border-amber-500/60",
    bg: "bg-gradient-to-r from-amber-950/40 to-zinc-900/40",
    medallion: "bg-amber-500 text-black",
    label: "text-amber-300",
    tone: "Top 10 · gold",
  },
  top25: {
    border: "border-zinc-400/40",
    bg: "bg-zinc-900/50",
    medallion: "bg-zinc-300 text-black",
    label: "text-zinc-200",
    tone: "11–25 · silver",
  },
  top50: {
    border: "border-orange-700/50",
    bg: "bg-zinc-900/40",
    medallion: "bg-orange-700/80 text-white",
    label: "text-orange-300",
    tone: "26–50 · bronze",
  },
  top100: {
    border: "border-zinc-700",
    bg: "bg-zinc-900/30",
    medallion: "bg-zinc-700 text-zinc-200",
    label: "text-zinc-400",
    tone: "51–100",
  },
  top128: {
    border: "border-zinc-800",
    bg: "bg-zinc-950/60",
    medallion: "bg-zinc-800 text-zinc-500",
    label: "text-zinc-500",
    tone: "101–128",
  },
};

export default function RevealPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [ranked, setRanked] = useState<PoolEntry[] | null>(null);
  const [keptPool, setKeptPool] = useState<PoolEntry[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tier, setTier] = useState<Tier>("top10");
  const [copied, setCopied] = useState(false);
  const [quips, setQuips] = useState<string[]>([]);
  const [needsReauth, setNeedsReauth] = useState(false);

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
    setKeptPool(loadKeptPool());
    setQuips(getQuips(r, 2));
    // Pre-flight: tokens predating any scope addition will 403 mid-export.
    // Surface a reconnect CTA up front instead of a confusing error later.
    if (!hasExportScopes()) setNeedsReauth(true);
  }, [basePath]);

  // Stitch a full 128 ordering: vote-decided top 25, then the rest of the
  // kept pool (sans top-25 dups) in their pool order — which is best-
  // Spotify-signal-first by build construction. Bounded to 128.
  const full128 = useMemo<PoolEntry[]>(() => {
    if (!ranked) return [];
    if (!keptPool) return ranked;
    const rankedIds = new Set(ranked.map((t) => t.id));
    const tail = keptPool.filter((t) => !rankedIds.has(t.id));
    return [...ranked, ...tail].slice(0, 128);
  }, [ranked, keptPool]);

  const limit = TIER_LIMITS[tier];
  // Cap the picker at how many entries we actually have — if the pool was
  // smaller than 128 (e.g. small library) hide the higher tier buttons.
  const availableTiers = useMemo<Tier[]>(
    () => TIER_ORDER.filter((t) => TIER_LIMITS[t] <= Math.max(10, full128.length)),
    [full128.length],
  );

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
      const msg = e instanceof Error ? e.message : "export failed";
      // 403 / insufficient_scope means the token is missing playlist-modify.
      // Flip to the reconnect path instead of dead-ending on a raw error.
      if (/403|insufficient[_-]?scope|invalid[_-]?scope/i.test(msg)) {
        setNeedsReauth(true);
        setErr(null);
      } else {
        setErr(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  function reconnect() {
    // After OAuth callback, return to /reveal/ so the user lands right
    // back on the export button instead of /pool/.
    startLogin("/reveal/").catch((e) => {
      setErr(e instanceof Error ? e.message : "reconnect failed");
    });
  }

  const visible = full128.slice(0, Math.min(limit, full128.length));

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-50 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <header className="border-b border-zinc-800">
        <div className="max-w-2xl mx-auto px-4 py-4 sm:py-5">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Your {TIER_LABELS[tier]}
          </h1>
          <p className="text-zinc-500 text-xs sm:text-sm mt-1">
            Top {ranked.length} vote-decided
            {full128.length > ranked.length
              ? ` · ${full128.length - ranked.length} more by Spotify signal`
              : ""}
          </p>
        </div>
      </header>

      {/* Tier picker — pill toggle scrollable on narrow screens. Hidden
          tiers (e.g. top 100 if pool is only 80 deep) just don't render. */}
      <div className="max-w-2xl mx-auto px-3 sm:px-4 mt-4">
        <div
          role="tablist"
          aria-label="Show ranking depth"
          className="inline-flex items-center gap-1 p-1 rounded-full border border-zinc-800 bg-zinc-900/60 max-w-full overflow-x-auto no-scrollbar"
        >
          {availableTiers.map((t) => {
            const active = t === tier;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active}
                onClick={() => setTier(t)}
                className={`flex-none text-xs sm:text-sm font-medium px-3 sm:px-3.5 h-8 rounded-full transition tabular-nums ${
                  active
                    ? "bg-zinc-50 text-black"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {TIER_LABELS[t]}
              </button>
            );
          })}
        </div>
      </div>

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
        {visible.map((t, i) => {
          const rank = i + 1;
          const rowTier = tierFor(rank);
          const style = TIER_STYLES[rowTier];
          // Tier divider — render once, just before the first row of a new tier.
          const prevTier = i === 0 ? null : tierFor(i);
          const isFirstOfTier = prevTier !== rowTier;
          return (
            <li key={t.id} className="contents">
              {isFirstOfTier && (
                <div
                  aria-hidden
                  className="flex items-center gap-3 pt-3 pb-1 first:pt-0"
                >
                  <span
                    className={`text-[10px] uppercase tracking-[0.22em] font-semibold ${style.label}`}
                  >
                    {style.tone}
                  </span>
                  <span className="flex-1 h-px bg-zinc-800" />
                </div>
              )}
              <div
                className={`flex items-center gap-2.5 rounded-lg border ${style.border} ${style.bg} p-1.5 pr-3`}
              >
                <div
                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center font-mono text-[11px] sm:text-xs tabular-nums font-semibold flex-none ${style.medallion}`}
                  aria-label={`Rank ${rank}`}
                >
                  {rank}
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
              </div>
            </li>
          );
        })}
      </ol>

      <div className="max-w-2xl mx-auto px-4 mt-3 flex items-center gap-4 flex-wrap">
        <button
          onClick={async () => {
            // "1. Track — Artist[, Artist]" lines for whatever tier is
            // currently visible, with a small header and a share line so
            // it pastes nicely into Notes / iMessage / a tweet.
            const list = visible
              .map((t, i) => `${i + 1}. ${t.name} — ${t.artists.map((a) => a.name).join(", ")}`)
              .join("\n");
            const header = `My ${TIER_LABELS[tier]} (Bracketeering)`;
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
          {copied ? "copied ✓" : `copy ${TIER_LABELS[tier].toLowerCase()} as text`}
        </button>
      </div>

      <section className="max-w-2xl mx-auto px-3 sm:px-4 mt-6 sm:mt-10">
        {needsReauth && !exported ? (
          <div className="rounded-2xl border border-amber-700/60 bg-amber-950/30 p-5 space-y-3">
            <p className="font-semibold text-amber-200">
              One more step to save to Spotify
            </p>
            <p className="text-sm text-amber-100/80 leading-snug">
              We need updated permissions to create playlists in your Spotify
              account. Reconnect to grant playlist access — your ranking is
              saved and you&apos;ll come right back here.
            </p>
            <button
              onClick={reconnect}
              className="w-full h-12 rounded-full bg-[#1DB954] hover:bg-[#1ed760] active:scale-[0.98] transition text-black font-semibold"
            >
              Reconnect Spotify
            </button>
          </div>
        ) : exported ? (
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
