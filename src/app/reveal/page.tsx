"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { trackKey, type PoolEntry } from "@/lib/pool";
import { FLOOR } from "@/lib/compare";
import {
  loadKeptPool,
  loadRanked,
  saveRanked,
  clearRunState,
  loadFullOrdering,
  saveFullOrdering,
  clearFullOrdering,
} from "@/lib/storage";
import { exportPlaylists, type ExportResult } from "@/lib/export";
import { isAuthed, hasExportScopes, startLogin, logout } from "@/lib/auth";
import { getQuips } from "@/lib/quips";
import { renderTierCard, shareOrDownloadCard } from "@/lib/cardExport";
import { renderBracket, type BracketSize } from "@/lib/bracketExport";
import { buildPredictUrl } from "@/lib/predict";

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

// Hex accents for the canvas card export — kept in sync with the on-page
// tier colors (Tailwind amber-500, zinc-300, orange-600, zinc-500, zinc-600).
const TIER_HEX: Record<Tier, string> = {
  top10: "#f59e0b",
  top25: "#d4d4d8",
  top50: "#ea580c",
  top100: "#71717a",
  top128: "#52525b",
};

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
  // Spotify dev apps default to "Development Mode" with a 25-user allowlist.
  // The dev-app OWNER is auto-added, but only if their Spotify account email
  // matches the email on the developer account. Mismatches (or accounts the
  // owner forgot to add) cause a 403 on playlist creation that re-auth will
  // never fix. Surface the actionable instructions when we detect this.
  const [devAllowlist, setDevAllowlist] = useState(false);
  // Per-tier share button state — "rendering" | "shared" | "downloaded" so
  // we can give appropriate inline confirmation feedback.
  const [cardBusy, setCardBusy] = useState(false);
  const [cardStatus, setCardStatus] = useState<null | "shared" | "downloaded">(null);
  // Bracket export — independent state from the tier card so both can show
  // their own status without stepping on each other.
  const [bracketBusy, setBracketBusy] = useState(false);
  const [bracketStatus, setBracketStatus] = useState<null | "shared" | "downloaded">(null);
  // Predict-my-top-10 share button — single transient "copied" pulse.
  const [predictCopied, setPredictCopied] = useState(false);
  // Reorder mode: when on, the list is drag-sortable. The curated order
  // persists to localStorage and overrides the default vote+tail stitch
  // on subsequent loads. Drag-and-drop only — read-only mode just renders
  // the same list without drag handles, so the layout stays identical.
  const [reorderMode, setReorderMode] = useState(false);
  const [full128, setFull128] = useState<PoolEntry[]>([]);
  const [hasCuratedOrder, setHasCuratedOrder] = useState(false);

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
    const kept = loadKeptPool();
    // Heal pre-fix saves: an early version could finish with `ranked` shorter
    // than FLOOR if cross-release dupes were popped during floor-fill. Pad
    // from the kept pool (in pool order) so users on stale state see a full
    // top 10 / top 25 and the Spotify export gets all 25.
    let healed = r;
    if (kept && r.length < FLOOR) {
      const seenId = new Set(r.map((t) => t.id));
      const seenKey = new Set(r.map((t) => trackKey(t)));
      for (const t of kept) {
        if (healed.length >= FLOOR) break;
        const k = trackKey(t);
        if (seenId.has(t.id) || seenKey.has(k)) continue;
        healed = [...healed, t];
        seenId.add(t.id);
        seenKey.add(k);
      }
      if (healed.length !== r.length) saveRanked(healed);
    }
    setRanked(healed);
    setKeptPool(kept);

    // Default 128 ordering: vote-decided top 25 then the rest of the kept
    // pool (sans top-25 dups) in pool order — best-Spotify-signal-first.
    let stitched: PoolEntry[];
    if (!kept) {
      stitched = healed;
    } else {
      const rankedIds = new Set(healed.map((t) => t.id));
      const tail = kept.filter((t) => !rankedIds.has(t.id));
      stitched = [...healed, ...tail].slice(0, 128);
    }

    // Apply user-curated ordering if one was saved. Map IDs → entries from
    // the stitched list. Any IDs in the saved order that no longer exist
    // (e.g. user rebuilt the pool) are dropped; any new entries not in the
    // saved order get appended at the end so nothing silently disappears.
    const curated = loadFullOrdering();
    if (curated && curated.length > 0) {
      const byId = new Map(stitched.map((t) => [t.id, t]));
      const reordered: PoolEntry[] = [];
      const seen = new Set<string>();
      for (const id of curated) {
        const t = byId.get(id);
        if (t && !seen.has(id)) {
          reordered.push(t);
          seen.add(id);
        }
      }
      for (const t of stitched) {
        if (!seen.has(t.id)) reordered.push(t);
      }
      setFull128(reordered);
      setHasCuratedOrder(true);
    } else {
      setFull128(stitched);
      setHasCuratedOrder(false);
    }

    // Quips reflect the displayed top 25, which is the curated order if
    // present (so reroll-after-reorder roasts the new top picks).
    const top25 = (curated && curated.length > 0
      ? (() => {
          const byId = new Map(stitched.map((t) => [t.id, t]));
          const out: PoolEntry[] = [];
          const seen = new Set<string>();
          for (const id of curated) {
            const t = byId.get(id);
            if (t && !seen.has(id)) {
              out.push(t);
              seen.add(id);
            }
            if (out.length >= 25) break;
          }
          return out;
        })()
      : healed
    ).slice(0, 25);
    setQuips(getQuips(top25, 2));

    // Pre-flight: tokens predating any scope addition will 403 mid-export.
    // Surface a reconnect CTA up front instead of a confusing error later.
    if (!hasExportScopes()) setNeedsReauth(true);
  }, [basePath]);

  const limit = TIER_LIMITS[tier];
  // Cap the picker at how many entries we actually have — if the pool was
  // smaller than 128 (e.g. small library) hide the higher tier buttons.
  const availableTiers = useMemo<Tier[]>(
    () => TIER_ORDER.filter((t) => TIER_LIMITS[t] <= Math.max(10, full128.length)),
    [full128.length],
  );

  // Sensors: pointer for mouse, touch for finger (with a small activation
  // distance so taps to scroll the list don't initiate a drag), keyboard
  // for accessibility.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setFull128((items) => {
        const oldIndex = items.findIndex((t) => t.id === active.id);
        const newIndex = items.findIndex((t) => t.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return items;
        const reordered = arrayMove(items, oldIndex, newIndex);
        // Persist immediately so refresh / nav-back keeps the order.
        saveFullOrdering(reordered.map((t) => t.id));
        setHasCuratedOrder(true);
        // Re-roll quips against the new top 25 so the verdict matches what
        // the user is now showing as their best.
        setQuips(getQuips(reordered.slice(0, 25), 2));
        return reordered;
      });
    },
    [],
  );

  function resetOrder() {
    if (!ranked) return;
    if (!confirm("Reset to your voted ranking? Your manual reorder will be lost.")) return;
    clearFullOrdering();
    // Recompute the default vote+tail stitch from the current state.
    const rankedIds = new Set(ranked.map((t) => t.id));
    const tail = (keptPool ?? []).filter((t) => !rankedIds.has(t.id));
    const stitched = [...ranked, ...tail].slice(0, 128);
    setFull128(stitched);
    setHasCuratedOrder(false);
    setQuips(getQuips(stitched.slice(0, 25), 2));
  }

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
    if (!ranked || full128.length === 0) return;
    setBusy(true);
    setErr(null);
    setDevAllowlist(false);
    try {
      // Export uses the (possibly user-curated) full128 so reordered tracks
      // land in the playlist in the user's order. Slice to 25 — Spotify's
      // Top 25 + Top 10 playlists are still the export shape.
      const res = await exportPlaylists(full128.slice(0, 25));
      setExported(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "export failed";
      // Three distinct failure modes, each with its own remedy:
      //
      // 1. SCOPE — Spotify echoes `insufficient_scope` / `invalid_scope` in
      //    the 401/403 body. Solvable by re-auth with show_dialog=true so
      //    the user can grant the missing scope.
      //
      // 2. AUTH-LOST — token expired and refresh failed (`re-auth required`
      //    or 401 with no scope hint). Same remedy as scope: re-auth.
      //
      // 3. DEV-ALLOWLIST — Spotify's dev-mode 403 with body matching
      //    "User not registered in the Developer Dashboard". This is NOT
      //    solvable by re-auth — the user has to add their Spotify account
      //    to their dev app's user-management list. Looping them through
      //    OAuth a hundred times will never fix this. Show explicit guidance.
      //
      // Anything else just surfaces the raw error.
      const isScope = /insufficient[_-]?scope|invalid[_-]?scope/i.test(msg);
      const isAuthLost = /re-auth required|401(?!\d)/.test(msg);
      const isDevAllowlist =
        /not registered in the developer dashboard|user not registered/i.test(
          msg,
        );
      if (isDevAllowlist) {
        setDevAllowlist(true);
        setErr(null);
      } else if (isScope || isAuthLost) {
        setNeedsReauth(true);
        setErr(isScope ? msg : null); // raw scope message is informative; auth-lost isn't
      } else {
        setErr(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  function reconnect() {
    // After OAuth callback, return to /reveal/ so the user lands right
    // back on the export button instead of /pool/. Force the consent
    // screen — otherwise Spotify silently re-approves the existing grant
    // and we land back here with the same scopes, looping the user.
    startLogin("/reveal/", true).catch((e) => {
      setErr(e instanceof Error ? e.message : "reconnect failed");
    });
  }

  function switchAccount() {
    // Hard escape hatch: clear tokens and start fresh. Forces the consent
    // screen and lets the user pick a different Spotify account if the
    // current one isn't allowlisted on the dev app or hits a 403 wall.
    logout();
    startLogin("/reveal/", true).catch((e) => {
      setErr(e instanceof Error ? e.message : "reconnect failed");
    });
  }

  async function shareBracket() {
    if (bracketBusy) return;
    // Bracket needs at least 8 ranked tracks (smallest supported size).
    if (full128.length < 8) {
      setErr("Need at least 8 ranked tracks to render a bracket.");
      return;
    }
    setBracketBusy(true);
    setBracketStatus(null);
    setErr(null);
    try {
      // 16-bracket when we have enough; otherwise fall back to 8.
      const size: BracketSize = full128.length >= 16 ? 16 : 8;
      const blob = await renderBracket({
        tracks: full128,
        size,
        shareHost: `${window.location.host}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`.replace(
          /\/$/,
          "",
        ),
      });
      const result = await shareOrDownloadCard(
        blob,
        `songrank-bracket-top${size}.png`,
        `My Top ${size} bracket (Songrank)`,
      );
      setBracketStatus(result);
      setTimeout(() => setBracketStatus(null), 2400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "bracket export failed");
    } finally {
      setBracketBusy(false);
    }
  }

  async function sharePredict() {
    // Top 10 is the canonical predict size; smaller pools still get a
    // playable challenge as long as there are ≥4 tracks.
    const topIds = full128.slice(0, 10).map((t) => t.id);
    if (topIds.length < 4) {
      setErr("Need at least 4 ranked tracks to share a predict challenge.");
      return;
    }
    const url = buildPredictUrl({
      origin: window.location.origin,
      basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
      topTenIds: topIds,
    });
    const text = `Think you know my taste? Predict my top ${topIds.length}:`;
    type Nav = Navigator & { share?: (data: ShareData) => Promise<void> };
    const nav = navigator as Nav;
    if (typeof nav.share === "function") {
      try {
        await nav.share({ title: "Songrank", text, url });
        return;
      } catch {
        // user cancelled or share sheet errored — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setPredictCopied(true);
      setTimeout(() => setPredictCopied(false), 1800);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  async function shareCard() {
    if (cardBusy) return;
    setCardBusy(true);
    setCardStatus(null);
    try {
      // ≤25 fits a numbered list legibly; >25 switches to a dense mosaic
      // since track text would be too small to read in a 1080-wide PNG.
      const variant = visible.length <= 25 ? "list" : "mosaic";
      const blob = await renderTierCard({
        tracks: visible,
        tierLabel: TIER_LABELS[tier],
        tierAccent: TIER_HEX[tier],
        variant,
        // Use the actual deploy URL so a fork's card promotes the fork, not
        // the upstream one. Strip protocol — the card footer is just the host.
        shareHost: `${window.location.host}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`.replace(
          /\/$/,
          "",
        ),
      });
      const result = await shareOrDownloadCard(
        blob,
        `songrank-${tier}.png`,
        `My ${TIER_LABELS[tier]} (Songrank)`,
      );
      setCardStatus(result);
      setTimeout(() => setCardStatus(null), 2400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "card export failed");
    } finally {
      setCardBusy(false);
    }
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
            {hasCuratedOrder
              ? `Hand-curated · ${full128.length} tracks`
              : `Top ${ranked.length} vote-decided${
                  full128.length > ranked.length
                    ? ` · ${full128.length - ranked.length} more by Spotify signal`
                    : ""
                }`}
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
                onClick={() => full128.length > 0 && setQuips(getQuips(full128.slice(0, 25), 2))}
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

      {/* Reorder toolbar — sits just above the list. The mode toggle is the
          primary action; reset only shows up once a curated order exists. */}
      <div className="max-w-2xl mx-auto px-3 sm:px-4 mt-4 flex items-center justify-between gap-3">
        <button
          onClick={() => setReorderMode((v) => !v)}
          aria-pressed={reorderMode}
          className={`text-xs uppercase tracking-[0.18em] font-semibold px-3 h-8 rounded-full transition border ${
            reorderMode
              ? "bg-emerald-500 text-black border-emerald-400"
              : "text-zinc-400 hover:text-zinc-200 border-zinc-800 hover:border-zinc-600"
          }`}
        >
          {reorderMode ? "done" : "reorder"}
        </button>
        {hasCuratedOrder && (
          <button
            onClick={resetOrder}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 underline"
          >
            reset to voted order
          </button>
        )}
      </div>
      {reorderMode && (
        <p className="max-w-2xl mx-auto px-4 mt-2 text-[11px] text-zinc-500 leading-snug">
          Drag any row by its grip to move it. Switch tiers above to reorder
          deeper into the list. Saves automatically — Spotify export uses
          your order.
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        accessibility={{
          // Screen-reader narration for the reorder flow. Without these,
          // VoiceOver / NVDA users get only "button" with no positional
          // context when picking up a row. Strings are kept short because
          // they're spoken on every keystroke during a drag.
          screenReaderInstructions: {
            draggable:
              "Press space or enter to pick up a track. Use arrow keys to move. Press space or enter again to drop, or escape to cancel.",
          },
          announcements: {
            onDragStart: ({ active }) => `Picked up track ${active.id}.`,
            onDragOver: ({ active, over }) =>
              over ? `Track ${active.id} is over position ${over.id}.` : "",
            onDragEnd: ({ active, over }) =>
              over
                ? `Track ${active.id} dropped at position ${over.id}.`
                : `Track ${active.id} returned to its original position.`,
            onDragCancel: ({ active }) =>
              `Reorder cancelled. Track ${active.id} returned.`,
          },
        }}
      >
        <SortableContext
          items={visible.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="max-w-2xl mx-auto px-3 sm:px-4 mt-3 sm:mt-4 space-y-1.5">
            {visible.map((t, i) => {
              const rank = i + 1;
              const rowTier = tierFor(rank);
              const style = TIER_STYLES[rowTier];
              const prevTier = i === 0 ? null : tierFor(i);
              const isFirstOfTier = prevTier !== rowTier;
              return (
                <SortableRow
                  key={t.id}
                  track={t}
                  rank={rank}
                  style={style}
                  isFirstOfTier={isFirstOfTier}
                  reorderMode={reorderMode}
                />
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>

      <div className="max-w-2xl mx-auto px-4 mt-3 flex items-center gap-x-4 gap-y-2 flex-wrap">
        {/* Bracket-style PNG — single tournament tree of the top 16 (or top
            8 for shallower pools). Distinct from the per-tier card because
            it emphasises the elimination format the app is named for. */}
        <button
          onClick={shareBracket}
          disabled={bracketBusy || full128.length < 8}
          className="text-sm text-emerald-400 hover:text-emerald-300 disabled:text-zinc-600 disabled:no-underline underline"
        >
          {bracketBusy
            ? "rendering bracket…"
            : bracketStatus === "shared"
              ? "bracket shared ✓"
              : bracketStatus === "downloaded"
                ? "bracket downloaded ✓"
                : "share my bracket"}
        </button>
        {/* Predict-my-top-10 — copies a public link a friend can use to
            guess the user's ranking. No Spotify auth needed on the
            recipient side; metadata loads via Spotify oEmbed. */}
        <button
          onClick={sharePredict}
          disabled={full128.length < 4}
          className="text-sm text-fuchsia-400 hover:text-fuchsia-300 disabled:text-zinc-600 disabled:no-underline underline"
        >
          {predictCopied ? "predict link copied ✓" : "challenge a friend →"}
        </button>
        {/* Image-card export — generates a 1080×1920 PNG of the current tier.
            Web Share API on mobile lets users send straight to Stories /
            iMessage; desktop falls through to a download. */}
        <button
          onClick={shareCard}
          disabled={cardBusy}
          className="text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-60 underline"
        >
          {cardBusy
            ? "rendering…"
            : cardStatus === "shared"
              ? "shared ✓"
              : cardStatus === "downloaded"
                ? "downloaded ✓"
                : `share ${TIER_LABELS[tier].toLowerCase()} as image`}
        </button>
        <button
          onClick={async () => {
            // "1. Track — Artist[, Artist]" lines for whatever tier is
            // currently visible, with a small header and a share line so
            // it pastes nicely into Notes / iMessage / a tweet.
            const list = visible
              .map((t, i) => `${i + 1}. ${t.name} — ${t.artists.map((a) => a.name).join(", ")}`)
              .join("\n");
            const header = `My ${TIER_LABELS[tier]} (Songrank)`;
            // Same reasoning as the card: derive from the live origin so a
            // forked deploy promotes itself, not the upstream.
            const shareUrl = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;
            const text = `${header}\n\n${list}\n\nbracketeer yours: ${shareUrl}`;
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
        {devAllowlist && !exported ? (
          // Dev-mode allowlist 403 — re-auth never fixes this. Spell out the
          // exact fix and link directly to the dashboard so the user doesn't
          // have to hunt for it.
          <div className="rounded-2xl border border-rose-700/60 bg-rose-950/30 p-5 space-y-3">
            <p className="font-semibold text-rose-200">
              Spotify rejected the save — your account isn&apos;t allowlisted on
              your dev app
            </p>
            <p className="text-sm text-rose-100/85 leading-relaxed">
              Spotify dev apps run in &ldquo;Development Mode&rdquo; with a
              25-user allowlist. You need to add yourself by hand. One time,
              30 seconds.
            </p>
            <ol className="text-sm text-rose-100/85 space-y-1.5 list-decimal pl-5">
              <li>
                Open the{" "}
                <a
                  href="https://developer.spotify.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-rose-100 hover:text-white"
                >
                  Spotify Developer Dashboard
                </a>{" "}
                and click your Songrank app.
              </li>
              <li>
                Settings → User Management → <b>Add New User</b>.
              </li>
              <li>
                Enter the name + email of the Spotify account you&apos;re using
                here. (It must match exactly — case-sensitive.)
              </li>
              <li>Come back and tap Save again.</li>
            </ol>
            <button
              onClick={() => {
                setDevAllowlist(false);
                onExport();
              }}
              className="w-full h-12 rounded-full bg-[#1DB954] hover:bg-[#1ed760] active:scale-[0.98] transition text-black font-semibold"
            >
              I added myself — try again
            </button>
            <button
              onClick={switchAccount}
              className="w-full text-xs text-rose-100/70 hover:text-rose-100 underline"
            >
              or sign in with a different Spotify account
            </button>
          </div>
        ) : needsReauth && !exported ? (
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
            <button
              onClick={switchAccount}
              className="w-full text-xs text-amber-100/70 hover:text-amber-100 underline"
            >
              still stuck? sign out and try a different Spotify account
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
              <div className="font-medium">My Top 10 — Songrank</div>
            </a>
            <a
              href={exported.top25.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-emerald-700/60 bg-zinc-950 px-4 py-3 hover:bg-zinc-900 transition"
            >
              <div className="text-sm text-emerald-300">Open in Spotify →</div>
              <div className="font-medium">My Top 25 — Songrank</div>
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

type RowStyle = {
  border: string;
  bg: string;
  medallion: string;
  label: string;
  tone: string;
};

/** A single ranked row that participates in dnd-kit's sortable list. The
 *  visual layout matches the read-only row 1:1 — the only difference in
 *  reorder mode is a grip handle on the right and the row gets the drag
 *  listeners. Outside reorder mode, drag listeners are not attached so
 *  scrolling on touch is unaffected. */
function SortableRow({
  track,
  rank,
  style,
  isFirstOfTier,
  reorderMode,
}: {
  track: PoolEntry;
  rank: number;
  style: RowStyle;
  isFirstOfTier: boolean;
  reorderMode: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: track.id, disabled: !reorderMode });

  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Lifted-card affordance — make the active row pop above its neighbors
    // so drop targets read clearly even on a dense list.
    zIndex: isDragging ? 30 : undefined,
    opacity: isDragging ? 0.92 : 1,
    // Touch needs explicit none during drag so the page doesn't scroll out
    // from under the user mid-reorder.
    touchAction: reorderMode ? "none" : undefined,
  };

  return (
    <li ref={setNodeRef} style={dragStyle} className="contents">
      {isFirstOfTier && (
        <div aria-hidden className="flex items-center gap-3 pt-3 pb-1 first:pt-0">
          <span
            className={`text-[10px] uppercase tracking-[0.22em] font-semibold ${style.label}`}
          >
            {style.tone}
          </span>
          <span className="flex-1 h-px bg-zinc-800" />
        </div>
      )}
      <div
        className={`flex items-center gap-2.5 rounded-lg border ${style.border} ${style.bg} p-1.5 pr-3 ${
          isDragging ? "shadow-2xl shadow-emerald-500/20 ring-1 ring-emerald-500/40" : ""
        }`}
      >
        <div
          className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center font-mono text-[11px] sm:text-xs tabular-nums font-semibold flex-none ${style.medallion}`}
          aria-label={`Rank ${rank}`}
        >
          {rank}
        </div>
        {track.album.images?.[0]?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.album.images[0].url}
            alt=""
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-md object-cover flex-none"
          />
        ) : (
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-md bg-zinc-800 flex-none" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm leading-tight truncate">{track.name}</div>
          <div className="text-[11px] sm:text-xs text-zinc-500 leading-tight truncate mt-0.5">
            {track.artists.map((a) => a.name).join(", ")}
          </div>
        </div>
        {reorderMode && (
          <button
            type="button"
            aria-label={`Drag to reorder ${track.name}`}
            className="flex-none w-9 h-9 -mr-1 flex items-center justify-center text-zinc-400 hover:text-zinc-200 cursor-grab active:cursor-grabbing select-none touch-none"
            {...attributes}
            {...listeners}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden focusable="false">
              <circle cx="5" cy="3" r="1.4" fill="currentColor" />
              <circle cx="11" cy="3" r="1.4" fill="currentColor" />
              <circle cx="5" cy="8" r="1.4" fill="currentColor" />
              <circle cx="11" cy="8" r="1.4" fill="currentColor" />
              <circle cx="5" cy="13" r="1.4" fill="currentColor" />
              <circle cx="11" cy="13" r="1.4" fill="currentColor" />
            </svg>
          </button>
        )}
      </div>
    </li>
  );
}
