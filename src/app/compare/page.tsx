"use client";

import { useEffect, useMemo, useState } from "react";
import {
  initCompare,
  vote,
  currentMatchup,
  isDone,
  type CompareState,
} from "@/lib/compare";
import {
  loadCompareState,
  loadKeptPool,
  saveCompareState,
  saveRanked,
  clearCompareState,
} from "@/lib/storage";

export default function ComparePage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [state, setState] = useState<CompareState | null>(null);
  const [missingPool, setMissingPool] = useState(false);

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
      saveRanked(state.ranked);
      clearCompareState();
      window.location.replace(`${basePath}/reveal/`);
    }
  }, [state, basePath]);

  const matchup = useMemo(() => (state ? currentMatchup(state) : null), [state]);

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

  function pick(winner: "a" | "b") {
    setState((prev) => {
      if (!prev) return prev;
      const cloned: CompareState = JSON.parse(JSON.stringify(prev));
      const next = vote(cloned, winner);
      saveCompareState(next);
      return next;
    });
  }

  const total = state.votes + state.estRemaining;
  const pct = total > 0 ? Math.min(100, Math.round((state.votes / total) * 100)) : 0;

  return (
    <main
      className="bg-zinc-950 text-zinc-50 flex flex-col overflow-hidden"
      // 100dvh adapts to mobile browser chrome; 100svh would lock to smallest.
      // dvh is right here — we want to use the visible viewport at any moment.
      style={{ height: "100dvh" }}
    >
      <header className="flex-none border-b border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 pt-2 pb-1.5 flex items-center justify-between text-xs">
          <div className="text-zinc-400">
            <span className="text-zinc-100 font-semibold">{state.votes}</span>
            <span className="text-zinc-500"> / ~{state.votes + state.estRemaining}</span>
          </div>
          <div className="text-zinc-500">
            top 25 · <span className="text-zinc-300 font-semibold">{state.ranked.length}</span>/25
          </div>
        </div>
        <div className="h-1 bg-zinc-900">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </header>

      <p className="flex-none text-center text-zinc-400 text-xs pt-2 pb-1 uppercase tracking-wide">
        which one wins?
      </p>

      <div className="flex-1 min-h-0 max-w-3xl w-full mx-auto px-3 pb-2 grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
        <Choice track={matchup.a} onPick={() => pick("a")} />
        <Choice track={matchup.b} onPick={() => pick("b")} />
      </div>

      <div className="flex-none text-center pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button
          className="text-[11px] text-zinc-600 hover:text-zinc-400 underline px-4 py-1"
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
    </main>
  );
}

function Choice({
  track,
  onPick,
}: {
  track: { id: string; name: string; artists: Array<{ name: string }>; album: { name: string; images: Array<{ url: string }> } };
  onPick: () => void;
}) {
  const art = track.album.images?.[0]?.url ?? "";
  return (
    <button
      onClick={onPick}
      // h-full + min-h-0 + the parent's grid 1fr/1fr split = each tile takes
      // exactly half the available vertical space on mobile. No scrolling
      // required even on a short phone (e.g. iPhone SE 568px).
      className="group relative h-full min-h-0 rounded-2xl overflow-hidden border border-zinc-800 active:scale-[0.98] active:border-emerald-500 transition select-none"
    >
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={art}
          alt={track.album.name}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 bg-zinc-800" />
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/65 to-transparent p-3 pt-12 text-left">
        <div className="text-[15px] font-semibold leading-tight line-clamp-2">{track.name}</div>
        <div className="text-xs text-zinc-300 leading-tight line-clamp-1 mt-0.5">
          {track.artists.map((a) => a.name).join(", ")}
        </div>
      </div>
    </button>
  );
}
