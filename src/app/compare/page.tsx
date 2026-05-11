"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  initCompare,
  vote,
  currentMatchup,
  isDone,
  FLOOR,
  type CompareState,
} from "@/lib/compare";
import {
  loadCompareState,
  loadKeptPool,
  saveCompareState,
  saveRanked,
  clearCompareState,
} from "@/lib/storage";
import { trackKey, type PoolEntry } from "@/lib/pool";
import type { SpotifyTrack } from "@/lib/spotify";
import { getPreviewPlayer, resolvePreviewUrl } from "@/lib/preview";

export default function ComparePage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [state, setState] = useState<CompareState | null>(null);
  const [missingPool, setMissingPool] = useState(false);
  // Active track ID in the audio player (loading or playing).
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  // Resolved iTunes preview URLs for the current A/B matchup. Pre-fetched
  // on matchup change so the click handler can call audio.play() inside
  // the gesture (iOS Safari rejects play() after an await on the gesture).
  const [previewA, setPreviewA] = useState<string | null>(null);
  const [previewB, setPreviewB] = useState<string | null>(null);
  // Track-not-on-iTunes set: separate from `preview*` so we can distinguish
  // "still resolving" (null + not in this set) from "no preview available"
  // (null + in this set). Avoids a spinner that never ends.
  const [resolvedSet, setResolvedSet] = useState<Set<string>>(() => new Set());
  // Misclick recovery — snapshot the pre-vote state so the user can step
  // back. Capped at HISTORY_CAP entries; ephemeral (not persisted) since
  // misclicks are noticed within a couple votes max.
  const historyRef = useRef<CompareState[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    const existing = loadCompareState();
    if (existing) {
      setState(existing);
      return;
    }
    const pool = loadKeptPool();
    if (!pool || pool.length === 0) {
      setMissingPool(true);
      return;
    }
    const fresh = initCompare(pool);
    saveCompareState(fresh);
    setState(fresh);
  }, []);

  useEffect(() => {
    if (state && isDone(state)) {
      // Pad ranked up to FLOOR if the binary-insertion run finished short
      // (can happen when the kept pool contains cross-release duplicates —
      // group mode + overlapping favorites is the usual culprit). Take the
      // next non-dup tracks from the kept pool in pool order so the user
      // always gets a definitive top 10 and top 25 (and a full 25-track
      // Spotify export). "Tiebreaker" = pool order, which is best-Spotify-
      // signal-first by buildPool construction.
      let final: PoolEntry[] = state.ranked;
      if (final.length < FLOOR) {
        const kept = loadKeptPool() ?? [];
        const seenId = new Set(final.map((t) => t.id));
        const seenKey = new Set(final.map((t) => trackKey(t)));
        for (const t of kept) {
          if (final.length >= FLOOR) break;
          const k = trackKey(t);
          if (seenId.has(t.id) || seenKey.has(k)) continue;
          final = [...final, t];
          seenId.add(t.id);
          seenKey.add(k);
        }
      }
      saveRanked(final);
      clearCompareState();
      window.location.replace(`${basePath}/reveal/`);
    }
  }, [state, basePath]);

  const matchup = useMemo(() => (state ? currentMatchup(state) : null), [state]);

  // Subscribe to the audio player state so the play/pause icons reflect
  // reality (e.g. when the audio naturally ends at 30 sec).
  useEffect(() => {
    const player = getPreviewPlayer();
    const unsub = player.subscribe((s) => {
      setPlayingId(s.playing || s.loading ? s.trackId : null);
      setAudioLoading(s.loading);
    });
    return unsub;
  }, []);

  // Pre-resolve preview URLs for the current matchup. This MUST complete
  // before the user clicks play — otherwise the click handler can't call
  // audio.play() synchronously with the resolved URL, and iOS Safari drops
  // the gesture activation. iTunes responds in <500ms on a warm cache, and
  // subsequent songs almost always hit the localStorage cache.
  useEffect(() => {
    if (!matchup) return;
    setPreviewA(null);
    setPreviewB(null);
    let cancelled = false;
    const markResolved = (id: string) => {
      setResolvedSet((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    };
    resolvePreviewUrl(matchup.a.id, matchup.a.name, matchup.a.artists[0]?.name ?? "").then((u) => {
      if (cancelled) return;
      setPreviewA(u);
      markResolved(matchup.a.id);
    });
    resolvePreviewUrl(matchup.b.id, matchup.b.name, matchup.b.artists[0]?.name ?? "").then((u) => {
      if (cancelled) return;
      setPreviewB(u);
      markResolved(matchup.b.id);
    });
    return () => {
      cancelled = true;
    };
  }, [matchup]);

  const stopAudio = useCallback(() => {
    getPreviewPlayer().stop();
  }, []);

  const togglePreview = useCallback(
    (track: SpotifyTrack, previewUrl: string | null) => {
      const player = getPreviewPlayer();
      if (playingId === track.id) {
        player.pause();
        return;
      }
      if (!previewUrl) return; // no iTunes match — button is disabled in UI
      // SYNCHRONOUS play() — preserves the user-gesture activation that
      // iOS Safari (and tightened desktop autoplay policies) require.
      player.play(track.id, previewUrl);
    },
    [playingId],
  );

  const HISTORY_CAP = 20;

  const pick = useCallback(
    (winner: "a" | "b") => {
      // Stop any preview audio so it doesn't bleed into the next matchup.
      stopAudio();
      setState((prev) => {
        if (!prev) return prev;
        // Snapshot the unmutated prior state for undo. `prev` is safe to
        // push by reference because we clone before vote() mutates.
        const snapshot: CompareState = JSON.parse(JSON.stringify(prev));
        historyRef.current.push(snapshot);
        if (historyRef.current.length > HISTORY_CAP) historyRef.current.shift();
        setCanUndo(true);
        const cloned: CompareState = JSON.parse(JSON.stringify(prev));
        const next = vote(cloned, winner);
        saveCompareState(next);
        return next;
      });
    },
    [stopAudio]
  );

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    stopAudio();
    const last = historyRef.current.pop()!;
    saveCompareState(last);
    setCanUndo(historyRef.current.length > 0);
    setState(last);
  }, [stopAudio]);

  // Desktop keyboard shortcuts: arrow keys + 1/2/A/B = pick, space = preview A.
  // Power-user mode for ripping through 370 votes on a laptop without your
  // hand leaving the keyboard.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!matchup) return;
      if (e.key === "ArrowLeft" || e.key === "1" || e.key === "a" || e.key === "A") {
        e.preventDefault();
        pick("a");
      } else if (e.key === "ArrowRight" || e.key === "2" || e.key === "b" || e.key === "B") {
        e.preventDefault();
        pick("b");
      } else if (e.key === " ") {
        e.preventDefault();
        if (playingId) {
          stopAudio();
        } else {
          togglePreview(matchup.a, previewA);
        }
      } else if (
        // Undo: Backspace, U, or Cmd/Ctrl+Z. Power-user shortcuts paired
        // with the visible button so misclicks are recoverable however
        // the user noticed them.
        e.key === "Backspace" ||
        e.key === "u" ||
        e.key === "U" ||
        ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z"))
      ) {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [matchup, pick, playingId, previewA, stopAudio, togglePreview, undo]);

  // Stop preview audio when the page unmounts.
  useEffect(() => {
    return () => {
      getPreviewPlayer().stop();
    };
  }, []);

  if (missingPool) {
    return (
      <main className="min-h-dvh bg-zinc-950 text-zinc-50 flex items-center justify-center px-6 py-12">
        <div className="max-w-md text-center space-y-4">
          <p className="text-zinc-300">No pool to compare yet.</p>
          <a href={`${basePath}/pool/`} className="text-emerald-400 underline">
            Build your 128 first →
          </a>
        </div>
      </main>
    );
  }

  if (!state || !matchup) {
    return (
      <main className="min-h-dvh bg-zinc-950 text-zinc-50 flex items-center justify-center">
        <div className="text-zinc-400">Loading…</div>
      </main>
    );
  }

  const total = state.votes + state.estRemaining;
  const pct = total > 0 ? Math.min(100, Math.round((state.votes / total) * 100)) : 0;

  return (
    <main
      className="bg-zinc-950 text-zinc-50 flex flex-col overflow-hidden"
      // 100dvh adapts to mobile browser chrome — the two cards always fit
      // in the visible viewport without page scroll.
      style={{ height: "100dvh" }}
    >
      {/* Header — minimal: thin progress bar + one-line meta. */}
      <header className="flex-none">
        <div className="h-[3px] bg-zinc-900">
          <div
            className="h-full bg-emerald-500 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="max-w-5xl mx-auto px-4 py-2 flex items-center justify-between text-[11px] tracking-wide">
          <div className="text-zinc-500 tabular-nums">
            <span className="text-zinc-200 font-semibold">{state.votes}</span>
            <span className="text-zinc-600"> / ~{total}</span>
          </div>
          <div className="text-zinc-500 uppercase tracking-[0.18em] hidden sm:block">
            Pick a winner
          </div>
          <div className="text-zinc-500 tabular-nums">
            <span className="text-zinc-300">{state.ranked.length}</span>
            <span className="text-zinc-600">/25 placed</span>
          </div>
        </div>
      </header>

      {/* Mobile: vertical stack. Desktop: side-by-side. */}
      <div className="flex-1 min-h-0 w-full max-w-6xl mx-auto px-3 sm:px-6 pb-2 sm:pb-6 pt-1">
        <div className="h-full grid grid-rows-[1fr_auto_1fr] sm:grid-rows-1 sm:grid-cols-[1fr_auto_1fr] gap-2 sm:gap-5">
          <Choice
            label="A"
            track={matchup.a}
            onPick={() => pick("a")}
            playing={playingId === matchup.a.id && !audioLoading}
            loading={playingId === matchup.a.id && audioLoading}
            disabled={resolvedSet.has(matchup.a.id) && previewA === null}
            onTogglePreview={() => togglePreview(matchup.a, previewA)}
          />
          <Divider />
          <Choice
            label="B"
            track={matchup.b}
            onPick={() => pick("b")}
            playing={playingId === matchup.b.id && !audioLoading}
            loading={playingId === matchup.b.id && audioLoading}
            disabled={resolvedSet.has(matchup.b.id) && previewB === null}
            onTogglePreview={() => togglePreview(matchup.b, previewB)}
          />
        </div>
      </div>

      {/* Footer — keyboard hint on desktop, undo + start-over on all sizes. */}
      <footer className="flex-none pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between gap-3">
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-zinc-600">
            <Kbd>←</Kbd> A <span className="opacity-50">·</span>
            <Kbd>→</Kbd> B <span className="opacity-50">·</span>
            <Kbd>space</Kbd> preview <span className="opacity-50">·</span>
            <Kbd>⌫</Kbd> undo
          </div>
          {/* Undo for misclicks. Visible at all sizes; disabled until the
              first vote. Keyboard: Backspace / U / Cmd+Z. */}
          <button
            onClick={undo}
            disabled={!canUndo}
            aria-label="Undo last pick"
            className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 disabled:text-zinc-700 disabled:cursor-not-allowed hover:text-zinc-200 transition px-2.5 py-1 ml-auto rounded-full border border-zinc-800 hover:border-zinc-600 disabled:hover:border-zinc-800"
          >
            <UndoIcon />
            undo
          </button>
          <button
            className="text-[11px] text-zinc-600 hover:text-zinc-400 underline px-2 py-1"
            onClick={() => {
              if (confirm("Start the bracket over? Your current votes will be lost.")) {
                clearCompareState();
                window.location.reload();
              }
            }}
          >
            start over
          </button>
        </div>
      </footer>
    </main>
  );
}

function Choice({
  label,
  track,
  onPick,
  playing,
  loading,
  disabled,
  onTogglePreview,
}: {
  label: "A" | "B";
  track: {
    id: string;
    name: string;
    preview_url: string | null;
    artists: Array<{ name: string }>;
    album: { name: string; images: Array<{ url: string }> };
  };
  onPick: () => void;
  playing: boolean;
  loading: boolean;
  disabled: boolean;
  onTogglePreview: () => void;
}) {
  const art = track.album.images?.[0]?.url ?? "";

  return (
    <div className="relative h-full min-h-0 flex flex-col">
      {/* The whole tile is the pick button — single tap target. */}
      <button
        onClick={onPick}
        aria-label={`Pick ${track.name} by ${track.artists.map((a) => a.name).join(", ")}`}
        className="group flex-1 min-h-0 relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 active:scale-[0.985] active:border-emerald-500 transition select-none focus:outline-none focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
      >
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={art}
            alt=""
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 bg-zinc-800" />
        )}

        {/* A/B label, top-left. Visual anchor for keyboard shortcut users. */}
        <span className="absolute top-2 left-2 sm:top-3 sm:left-3 inline-flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-black/55 backdrop-blur-sm text-[12px] sm:text-[13px] font-semibold text-white pointer-events-none">
          {label}
        </span>

        {/* Preview play button, top-right. Disabled (with a muted icon) when
            iTunes has no match for the track — better than a button that
            does nothing on click. */}
        <span
          role="button"
          aria-label={
            disabled
              ? "Preview unavailable"
              : playing
                ? "Pause preview"
                : loading
                  ? "Loading preview"
                  : "Play preview"
          }
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          onClick={(e) => {
            e.stopPropagation();
            if (disabled) return;
            onTogglePreview();
          }}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onTogglePreview();
            }
          }}
          className={`absolute top-2 right-2 sm:top-3 sm:right-3 inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full backdrop-blur-sm transition ${
            disabled
              ? "bg-black/40 text-white/30 cursor-not-allowed"
              : playing
                ? "bg-emerald-500 text-black cursor-pointer"
                : "bg-black/55 text-white hover:bg-black/70 cursor-pointer"
          }`}
        >
          {disabled ? <PlayIcon /> : playing ? <PauseIcon /> : loading ? <Spinner /> : <PlayIcon />}
        </span>
      </button>

      {/* Caption panel BELOW the art — clean, no gradient overlay clutter. */}
      <div className="flex-none pt-2 sm:pt-3 px-1">
        <div className="text-[15px] sm:text-base font-semibold leading-tight line-clamp-1">
          {track.name}
        </div>
        <div className="text-[12px] sm:text-sm text-zinc-400 leading-tight line-clamp-1 mt-0.5">
          {track.artists.map((a) => a.name).join(", ")}
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div aria-hidden className="flex items-center justify-center text-zinc-600">
      <span className="font-mono text-[10px] sm:text-xs uppercase tracking-[0.2em] px-2 py-0.5 rounded-full border border-zinc-800 bg-zinc-950">
        vs
      </span>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-900 text-zinc-300 font-mono text-[10px]">
      {children}
    </kbd>
  );
}

function UndoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8a5 5 0 0 1 5-5h2a5 5 0 1 1 0 10H6" />
      <path d="m6 5-3 3 3 3" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M3.5 2.5v11l10-5.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="3.5" y="2.5" width="3" height="11" rx="0.5" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="0.5" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
