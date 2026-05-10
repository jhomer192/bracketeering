"use client";

import { useEffect, useState, useCallback } from "react";
import { buildPool, type PoolEntry, type PoolSource } from "@/lib/pool";
import { isAuthed } from "@/lib/auth";
import {
  saveKeptPool,
  clearCompareState,
  saveBuiltPool,
  loadBuiltPool,
  clearBuiltPool,
} from "@/lib/storage";

const TARGET = 128;

const SOURCE_DOT: Record<PoolSource, string> = {
  short_term: "bg-orange-500",
  recently_played: "bg-orange-500",
  long_term: "bg-purple-500",
  saved_early: "bg-purple-500",
  genre_fill: "bg-zinc-500",
};

export default function PoolPage() {
  const [pool, setPool] = useState<PoolEntry[] | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [composition, setComposition] = useState<Record<PoolSource, number> | null>(null);

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  useEffect(() => {
    let cancelled = false;
    if (!isAuthed()) {
      window.location.replace(`${basePath}/`);
      return;
    }

    // Use cached pool if we have one — pulling 5 endpoints from Spotify is
    // slow and a refresh shouldn't pay that cost again.
    const cached = loadBuiltPool();
    if (cached) {
      setPool(cached.pool);
      setComposition(cached.composition);
      return;
    }

    buildPool()
      .then((data) => {
        if (cancelled) return;
        saveBuiltPool(data.pool, data.composition);
        setPool(data.pool);
        setComposition(data.composition);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [basePath]);

  const toggle = useCallback((id: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (error) {
    return (
      <main className="min-h-dvh bg-zinc-950 text-zinc-50 flex items-center justify-center px-6 py-12">
        <div className="max-w-md text-center space-y-4">
          <p className="text-red-400">Couldn&apos;t build your pool.</p>
          <p className="text-zinc-500 text-sm break-all">{error}</p>
          <a href={`${basePath}/`} className="text-zinc-300 underline">
            Try again
          </a>
        </div>
      </main>
    );
  }

  if (!pool) {
    return (
      <main className="min-h-dvh bg-zinc-950 text-zinc-50 flex items-center justify-center px-6 py-12">
        <div className="text-center space-y-2">
          <div className="text-2xl font-semibold">Building your pool…</div>
          <div className="text-zinc-500 text-sm">Pulling recent + all-time + filling gaps</div>
        </div>
      </main>
    );
  }

  const kept = pool.filter((t) => !removed.has(t.id));
  const remaining = TARGET - kept.length;
  const ready = kept.length === TARGET;

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-50 pb-28">
      <header className="sticky top-0 z-10 backdrop-blur bg-zinc-950/85 border-b border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight">Your 128</h1>
            {composition ? (
              <p className="text-[11px] text-zinc-500 leading-tight truncate">
                {composition.short_term + composition.recently_played} recent · {composition.long_term + composition.saved_early} all-time
                {composition.genre_fill ? ` · ${composition.genre_fill} genre` : ""}
              </p>
            ) : null}
          </div>
          <div className="text-right flex-none">
            <div
              className={`text-base font-semibold leading-tight ${
                ready ? "text-emerald-400" : kept.length > TARGET ? "text-amber-400" : "text-zinc-200"
              }`}
            >
              {kept.length}/{TARGET}
            </div>
            <div className="text-[11px] text-zinc-500 leading-tight">
              {remaining > 0 ? `add ${remaining}` : remaining < 0 ? `remove ${-remaining}` : "ready"}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-2 pt-2">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
          {pool.map((t) => {
            const isRemoved = removed.has(t.id);
            const art = t.album.images?.[0]?.url ?? "";
            return (
              <button
                key={t.id}
                onClick={() => toggle(t.id)}
                className={`relative aspect-square rounded-md overflow-hidden border transition ${
                  isRemoved
                    ? "border-zinc-800 opacity-30"
                    : "border-zinc-700 active:scale-[0.97]"
                }`}
              >
                {art ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={art} alt={t.album.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-zinc-800" />
                )}
                <span className={`absolute top-1 left-1 w-2 h-2 rounded-full ${SOURCE_DOT[t.source]}`} />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/55 to-transparent p-1 pt-5 text-left">
                  <div className="text-[10px] font-medium leading-tight line-clamp-1">{t.name}</div>
                  <div className="text-[10px] text-zinc-400 leading-tight line-clamp-1">
                    {t.artists.map((a) => a.name).join(", ")}
                  </div>
                </div>
                {isRemoved ? (
                  <div className="absolute inset-0 flex items-center justify-center text-2xl bg-black/30">✕</div>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="text-center mt-6 pb-4">
          <button
            onClick={() => {
              if (confirm("Refetch your pool from Spotify? Your tap-to-removes will reset.")) {
                clearBuiltPool();
                window.location.reload();
              }
            }}
            className="text-xs text-zinc-500 hover:text-zinc-300 underline"
          >
            rebuild pool from Spotify
          </button>
        </div>
      </div>

      <footer className="fixed inset-x-0 bottom-0 bg-zinc-950/95 backdrop-blur border-t border-zinc-800 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-3xl mx-auto px-3 py-2.5 flex items-center justify-between gap-2">
          <div className="text-[11px] text-zinc-500 leading-tight">
            Tap to remove
            <div className="mt-0.5 inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-orange-500" />recent
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-purple-500" />all-time
              </span>
            </div>
          </div>
          <button
            disabled={!ready}
            className={`h-12 px-6 rounded-full font-semibold flex-none ${
              ready ? "bg-[#1DB954] active:bg-[#1ed760] text-black" : "bg-zinc-800 text-zinc-500"
            }`}
            onClick={() => {
              if (!ready) return;
              saveKeptPool(kept);
              clearCompareState();
              window.location.href = `${basePath}/compare/`;
            }}
          >
            Start →
          </button>
        </div>
      </footer>
    </main>
  );
}
