"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { buildPool, searchTracks, type PoolEntry, type PoolSource } from "@/lib/pool";
import { isAuthed } from "@/lib/auth";
import type { SpotifyTrack } from "@/lib/spotify";
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
  manual: "bg-emerald-400",
};

export default function PoolPage() {
  const [pool, setPool] = useState<PoolEntry[] | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [composition, setComposition] = useState<Record<PoolSource, number> | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

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

  const addManual = useCallback((track: SpotifyTrack) => {
    setPool((prev) => {
      if (!prev) return prev;
      // If the track is already in the pool, just un-remove it instead of dup.
      if (prev.some((p) => p.id === track.id)) {
        setRemoved((r) => {
          if (!r.has(track.id)) return r;
          const n = new Set(r);
          n.delete(track.id);
          return n;
        });
        return prev;
      }
      const entry: PoolEntry = { ...track, source: "manual" };
      const next = [entry, ...prev];
      // Persist to cache so a refresh keeps the manually-added song.
      if (composition) saveBuiltPool(next, composition);
      return next;
    });
  }, [composition]);

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
          <button
            onClick={() => setSearchOpen(true)}
            className="h-12 px-4 rounded-full bg-zinc-800 active:bg-zinc-700 text-zinc-100 font-semibold flex-none text-sm"
          >
            + Add
          </button>
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

      {searchOpen && (
        <SearchModal
          onClose={() => setSearchOpen(false)}
          onPick={(t) => {
            addManual(t);
          }}
          existingIds={new Set(kept.map((p) => p.id))}
        />
      )}
    </main>
  );
}

function SearchModal({
  onClose,
  onPick,
  existingIds,
}: {
  onClose: () => void;
  onPick: (track: SpotifyTrack) => void;
  existingIds: Set<string>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced live search — fires 350ms after the last keystroke so we don't
  // hammer Spotify's /search endpoint while the user is still typing.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const items = await searchTracks(q);
        setResults(items);
        setErr(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "search failed");
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  return (
    <div className="fixed inset-0 z-30 bg-zinc-950/95 backdrop-blur flex flex-col">
      <div className="flex-none border-b border-zinc-800">
        <div className="max-w-3xl mx-auto px-3 py-2 flex items-center gap-2">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search song or artist…"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 h-11 rounded-lg bg-zinc-900 border border-zinc-800 px-3 text-sm focus:outline-none focus:border-zinc-600"
          />
          <button
            onClick={onClose}
            className="h-11 px-4 rounded-lg bg-zinc-800 active:bg-zinc-700 text-sm font-medium"
          >
            Done
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="max-w-3xl mx-auto px-3 pt-2">
          {err && (
            <div className="rounded-lg border border-red-700/60 bg-red-950/40 px-3 py-2 text-xs text-red-200 mb-3 break-all">
              {err}
            </div>
          )}
          {loading && results.length === 0 && (
            <div className="text-center text-zinc-500 text-sm py-8">Searching…</div>
          )}
          {!loading && q.trim() && results.length === 0 && !err && (
            <div className="text-center text-zinc-500 text-sm py-8">No matches.</div>
          )}
          {!q.trim() && (
            <p className="text-zinc-500 text-xs px-1 pt-2">
              Type a song or &ldquo;song artist&rdquo;. Tap a result to add it to your 128.
            </p>
          )}
          <ul className="space-y-1.5 mt-2">
            {results.map((t) => {
              const inPool = existingIds.has(t.id) || justAdded.has(t.id);
              const art = t.album.images?.[0]?.url ?? "";
              return (
                <li key={t.id}>
                  <button
                    disabled={inPool}
                    onClick={() => {
                      onPick(t);
                      setJustAdded((s) => new Set(s).add(t.id));
                    }}
                    className={`w-full flex items-center gap-2.5 rounded-lg border p-1.5 pr-3 text-left transition ${
                      inPool
                        ? "border-zinc-800 bg-zinc-900/40 opacity-60"
                        : "border-zinc-800 bg-zinc-900/40 active:scale-[0.99] active:border-emerald-500"
                    }`}
                  >
                    {art ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={art} alt="" className="w-11 h-11 rounded-md object-cover flex-none" />
                    ) : (
                      <div className="w-11 h-11 rounded-md bg-zinc-800 flex-none" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm leading-tight truncate">{t.name}</div>
                      <div className="text-[11px] text-zinc-500 leading-tight truncate mt-0.5">
                        {t.artists.map((a) => a.name).join(", ")}
                      </div>
                    </div>
                    <span
                      className={`text-[11px] flex-none ${inPool ? "text-zinc-500" : "text-emerald-400"}`}
                    >
                      {inPool ? "added ✓" : "+ add"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
