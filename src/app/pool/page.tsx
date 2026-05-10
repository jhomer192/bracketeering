"use client";

import { useEffect, useState, useCallback } from "react";
import { buildPool, type PoolEntry, type PoolSource } from "@/lib/pool";
import { isAuthed } from "@/lib/auth";

const TARGET = 128;

const SOURCE_LABEL: Record<PoolSource, string> = {
  short_term: "Recent",
  recently_played: "Recent",
  long_term: "All-time",
  saved_early: "All-time",
  genre_fill: "Genre",
};
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

  useEffect(() => {
    let cancelled = false;
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

    if (!isAuthed()) {
      window.location.replace(`${basePath}/`);
      return;
    }

    buildPool()
      .then((data) => {
        if (cancelled) return;
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
  }, []);

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
          <a
            href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`}
            className="text-zinc-300 underline"
          >
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
    <main className="min-h-dvh bg-zinc-950 text-zinc-50 pb-32">
      <header className="sticky top-0 z-10 backdrop-blur bg-zinc-950/80 border-b border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Your 128</h1>
            {composition ? (
              <p className="text-xs text-zinc-500">
                {composition.short_term + composition.recently_played} recent · {composition.long_term + composition.saved_early} all-time
                {composition.genre_fill ? ` · ${composition.genre_fill} genre` : ""}
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <div className={`text-base font-semibold ${ready ? "text-emerald-400" : "text-zinc-300"}`}>
              {kept.length} / {TARGET}
            </div>
            <div className="text-xs text-zinc-500">
              {remaining > 0 ? `add ${remaining} more` : remaining < 0 ? `remove ${-remaining}` : "ready"}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-3 pt-4">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
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
                <span
                  className={`absolute top-1 left-1 w-2 h-2 rounded-full ${SOURCE_DOT[t.source]}`}
                  title={SOURCE_LABEL[t.source]}
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1.5 pt-6 text-left">
                  <div className="text-[10px] font-medium leading-tight line-clamp-1">{t.name}</div>
                  <div className="text-[10px] text-zinc-400 leading-tight line-clamp-1">
                    {t.artists.map((a) => a.name).join(", ")}
                  </div>
                </div>
                {isRemoved ? (
                  <div className="absolute inset-0 flex items-center justify-center text-2xl">✕</div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <footer className="fixed inset-x-0 bottom-0 bg-zinc-950 border-t border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-xs text-zinc-500">
            Tap to remove. Search to add.
            <span className="ml-3 inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-orange-500" /> recent
            </span>
            <span className="ml-2 inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-purple-500" /> all-time
            </span>
          </div>
          <button
            disabled={!ready}
            className={`h-11 px-5 rounded-full font-semibold ${
              ready
                ? "bg-[#1DB954] hover:bg-[#1ed760] text-black"
                : "bg-zinc-800 text-zinc-500"
            }`}
            onClick={() => alert("Comparison engine — next build step.")}
          >
            Start →
          </button>
        </div>
      </footer>
    </main>
  );
}
