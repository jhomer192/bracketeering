"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  buildPool,
  searchTracks,
  tracksByIds,
  trackKey,
  listMyPlaylists,
  playlistTracks,
  type PoolEntry,
  type PoolSource,
  type PlaylistSummary,
} from "@/lib/pool";
import { isAuthed } from "@/lib/auth";
import { FLOOR } from "@/lib/compare";
import type { SpotifyTrack } from "@/lib/spotify";
import {
  saveKeptPool,
  clearCompareState,
  saveBuiltPool,
  loadBuiltPool,
  clearBuiltPool,
  takePendingImport,
  getPoolSize,
  setPoolSize,
  type PoolSize,
} from "@/lib/storage";
import {
  parseGroupParams,
  slotSize as slotSizeFn,
  expectedFromCount,
  buildHandoffUrl,
  HANDOFF_URL_SAFE_LIMIT,
  MIN_GROUP,
  MAX_GROUP,
  type GroupParams,
} from "@/lib/group";

const PENDING_KEY = "bracketeering.pending_group"; // stash full querystring across login

// One color per source — distinct enough to read on track tiles and in
// the legend below the grid. Order matters in SOURCE_LEGEND_ORDER, not
// here; this map is just lookups.
const SOURCE_DOT: Record<PoolSource, string> = {
  playlist: "bg-yellow-400",
  recap: "bg-indigo-400",
  long_term: "bg-red-500",
  medium_term: "bg-blue-500",
  short_term: "bg-orange-500",
  recently_played: "bg-amber-400",
  daylist: "bg-teal-400",
  saved_early: "bg-rose-400",
  genre_fill: "bg-zinc-500",
  manual: "bg-emerald-400",
  shared: "bg-sky-400",
};

const SOURCE_LABEL: Record<PoolSource, string> = {
  playlist: "Playlists",
  recap: "Wrapped & recaps",
  long_term: "All-time top",
  medium_term: "Last 6 months",
  short_term: "Last 4 weeks",
  recently_played: "Recently played",
  daylist: "Daylist",
  saved_early: "Saved",
  genre_fill: "Editorial",
  manual: "Added by you",
  shared: "From your group",
};

// Legend display order — strongest signals first, fallbacks last. Sources
// with count 0 are hidden so the strip stays tight.
const SOURCE_LEGEND_ORDER: PoolSource[] = [
  "playlist",
  "recap",
  "long_term",
  "medium_term",
  "short_term",
  "recently_played",
  "saved_early",
  "daylist",
  "genre_fill",
  "shared",
  "manual",
];

type Mode =
  | { kind: "solo" }
  | { kind: "shared" } // entire pool was sent over ?p=, no group params
  | { kind: "group"; params: GroupParams };

export default function PoolPage() {
  const [pool, setPool] = useState<PoolEntry[] | null>(null);
  const [friendTracks, setFriendTracks] = useState<PoolEntry[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [composition, setComposition] = useState<Record<PoolSource, number> | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "solo" });
  // poolSize is the *active* total — solo/shared read from localStorage,
  // group inherits from the URL (?t=). Default to 128 until hydrated so
  // SSR doesn't see a different value than the first client render.
  const [poolSize, setPoolSizeState] = useState<PoolSize>(128);

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  useEffect(() => {
    let cancelled = false;

    const url = new URL(window.location.href);

    // If not authed and there's anything interesting in the URL, stash it
    // so it survives the OAuth round-trip.
    if (!isAuthed()) {
      const search = url.search;
      if (search && (url.searchParams.get("p") || url.searchParams.get("g"))) {
        localStorage.setItem(PENDING_KEY, search);
      }
      window.location.replace(`${basePath}/`);
      return;
    }

    // After login, replay any stashed querystring.
    const pending = localStorage.getItem(PENDING_KEY);
    if (pending && !url.search) {
      localStorage.removeItem(PENDING_KEY);
      const replay = new URL(window.location.href);
      replay.search = pending;
      window.history.replaceState({}, "", replay.toString());
      url.search = pending;
    }

    const groupParams = parseGroupParams(url.searchParams);

    if (groupParams) {
      // Group mode locks size to the host's choice (encoded in ?t=).
      setPoolSizeState(groupParams.totalSize);
      enterGroupMode(groupParams, url, cancelled);
      return () => {
        cancelled = true;
      };
    }

    // Plain ?p= without group params = "rank this curated pool" import.
    const pParam = url.searchParams.get("p");
    const pendingLegacy = pParam ?? takePendingImport();
    if (pendingLegacy) {
      url.searchParams.delete("p");
      window.history.replaceState({}, "", url.toString());
      enterSharedMode(pendingLegacy, cancelled);
      return () => {
        cancelled = true;
      };
    }

    // Solo mode: cached pool or build fresh. Size persists across sessions.
    setMode({ kind: "solo" });
    const size = getPoolSize();
    setPoolSizeState(size);
    const cached = loadBuiltPool();
    // If the cached pool's length doesn't match the current size choice
    // (e.g. user toggled 128→64 and reloaded), drop it and rebuild.
    if (cached && cached.pool.length === size) {
      setPool(cached.pool);
      setComposition(cached.composition);
      return;
    }
    if (cached) clearBuiltPool();
    buildPool(size)
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

    function enterSharedMode(idsCsv: string, cancel: boolean) {
      const ids = idsCsv.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) {
        setError("Shared pool link was empty.");
        return;
      }
      tracksByIds(ids)
        .then((tracks) => {
          if (cancel) return;
          const sharedPool: PoolEntry[] = tracks.map((t) => ({
            ...t,
            source: "shared" as const,
          }));
          const comp: Record<PoolSource, number> = blankComposition();
          comp.shared = sharedPool.length;
          saveBuiltPool(sharedPool, comp);
          setPool(sharedPool);
          setComposition(comp);
          setMode({ kind: "shared" });
          // Shared pool size follows whatever the curator sent — round to
          // a known size so the target/progress UI reads cleanly.
          setPoolSizeState(sharedPool.length <= 64 ? 64 : 128);
        })
        .catch((e) => {
          if (cancel) return;
          setError(e instanceof Error ? e.message : String(e));
        });
    }

    function enterGroupMode(p: GroupParams, currentUrl: URL, cancel: boolean) {
      setMode({ kind: "group", params: p });

      const friendIdSet = new Set(p.fromIds);

      // Hydrate friend tracks (the contributions from earlier slots).
      const friendsP =
        p.fromIds.length > 0
          ? tracksByIds(p.fromIds).then((tracks) =>
              tracks.map<PoolEntry>((t) => ({ ...t, source: "shared" as const }))
            )
          : Promise.resolve<PoolEntry[]>([]);

      // Build (or load cached) the user's own pool, with friend tracks excluded.
      // Size is dictated by the host (p.totalSize) — if the cached pool
      // doesn't match, rebuild so the host's pick wins.
      const ownP = (async (): Promise<{ pool: PoolEntry[]; composition: Record<PoolSource, number> }> => {
        const cached = loadBuiltPool();
        if (
          cached &&
          cached.pool.every((t) => t.source !== "shared") &&
          cached.pool.length === p.totalSize
        ) {
          return cached;
        }
        const data = await buildPool(p.totalSize);
        saveBuiltPool(data.pool, data.composition);
        return data;
      })();

      Promise.all([friendsP, ownP])
        .then(([friends, own]) => {
          if (cancel) return;
          // Filter out anything that overlaps with a friend's contribution —
          // either by exact track ID, or by normalized name+artist (catches
          // cross-release duplicates like "Pink Pony Club" single vs album).
          const friendKeys = new Set(friends.map((t) => trackKey(t)));
          const ownFiltered = own.pool.filter(
            (t) => !friendIdSet.has(t.id) && !friendKeys.has(trackKey(t))
          );
          setFriendTracks(friends);
          setPool(ownFiltered);
          setComposition(own.composition);
        })
        .catch((e) => {
          if (cancel) return;
          setError(e instanceof Error ? e.message : String(e));
        });

      void currentUrl;
    }
  }, [basePath]);

  const toggle = useCallback((id: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const addManual = useCallback(
    (track: SpotifyTrack) => {
      setPool((prev) => {
        if (!prev) return prev;
        // Already in pool by exact ID — un-remove instead of duplicating.
        if (prev.some((p) => p.id === track.id)) {
          setRemoved((r) => {
            if (!r.has(track.id)) return r;
            const n = new Set(r);
            n.delete(track.id);
            return n;
          });
          return prev;
        }
        // Already in pool as a different release of the same song (e.g.
        // single vs album vs remaster) — skip silently to avoid two-of-
        // the-same-song matchups in /compare.
        const k = trackKey(track);
        if (prev.some((p) => trackKey(p) === k)) return prev;
        const entry: PoolEntry = { ...track, source: "manual" };
        const next = [entry, ...prev];
        if (composition && mode.kind !== "group") saveBuiltPool(next, composition);
        return next;
      });
    },
    [composition, mode.kind]
  );

  /** Bulk-add for playlist imports — one setPool call regardless of how
   *  many tracks. Returns counts so the caller can show "added 47 of 80"
   *  feedback (the rest were dupes / cross-release dupes / already in pool).
   *  Also un-removes any IDs that the user previously tap-deselected, so
   *  re-importing a playlist after a partial down-select restores them. */
  const addManyManual = useCallback(
    (tracks: SpotifyTrack[]): { added: number; restored: number; skipped: number } => {
      let added = 0;
      let restored = 0;
      let skipped = 0;
      setPool((prev) => {
        if (!prev) return prev;
        const byId = new Set(prev.map((p) => p.id));
        const byKey = new Set(prev.map((p) => trackKey(p)));
        const restoreIds = new Set<string>();
        const fresh: PoolEntry[] = [];
        for (const t of tracks) {
          if (!t || !t.id) {
            skipped++;
            continue;
          }
          if (byId.has(t.id)) {
            // Already in pool — restore it if it was deselected, else skip.
            restoreIds.add(t.id);
            continue;
          }
          const k = trackKey(t);
          if (byKey.has(k)) {
            skipped++;
            continue;
          }
          byId.add(t.id);
          byKey.add(k);
          fresh.push({ ...t, source: "manual" });
        }
        added = fresh.length;
        if (restoreIds.size > 0) {
          setRemoved((r) => {
            let changed = false;
            const n = new Set(r);
            for (const id of restoreIds) {
              if (n.delete(id)) {
                changed = true;
                restored++;
              }
            }
            return changed ? n : r;
          });
        }
        if (fresh.length === 0) return prev;
        const next = [...fresh, ...prev];
        if (composition && mode.kind !== "group") saveBuiltPool(next, composition);
        return next;
      });
      return { added, restored, skipped };
    },
    [composition, mode.kind]
  );

  const myKept = useMemo(
    () => (pool ?? []).filter((t) => !removed.has(t.id)),
    [pool, removed]
  );

  // Switching pool size invalidates the cached pool (it was sized for the old
  // target) AND any in-flight compare state (it's a different population now).
  // Persist the choice and reload — simplest way to re-run the build flow.
  const onChangeSize = useCallback(
    (n: PoolSize) => {
      if (n === poolSize) return;
      const hasRemovals = removed.size > 0;
      const msg = hasRemovals
        ? `Switch to top ${n}? Your tap-to-removes will reset and the pool refetches from Spotify.`
        : `Switch to top ${n}? The pool refetches from Spotify.`;
      if (!confirm(msg)) return;
      setPoolSize(n);
      clearBuiltPool();
      clearCompareState();
      window.location.reload();
    },
    [poolSize, removed.size]
  );

  // Targets vary by mode — solo/shared rank `poolSize`, group rank slotSize.
  const myTarget = useMemo(() => {
    if (mode.kind === "group")
      return slotSizeFn(mode.params.groupSize, mode.params.slotIndex, mode.params.totalSize);
    return poolSize;
  }, [mode, poolSize]);

  const friendCount = friendTracks.length;
  const totalCount = friendCount + myKept.length;
  const totalTarget = mode.kind === "group" ? friendCount + myTarget : poolSize;

  const myReady = myKept.length === myTarget;

  // ----- Render guards -----

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
          <div className="text-2xl font-semibold">
            {mode.kind === "group" ? "Loading group bracket…" : "Building your pool…"}
          </div>
          <div className="text-zinc-500 text-sm">
            {mode.kind === "group"
              ? "Pulling friends' contributions and your tracks"
              : "Pulling recent + all-time + filling gaps"}
          </div>
        </div>
      </main>
    );
  }

  // ----- Footer action handler -----

  function onPrimaryAction() {
    if (!myReady) return;
    // Hard guard: the reveal page promises a "Top 25". If the user removed
    // enough songs that the merged pool can't fill the floor, the playlist
    // export silently ships short. Surface that here, where it's still
    // recoverable, instead of after they've voted 200 times.
    const finalSize =
      mode.kind === "group" && mode.params.slotIndex === mode.params.groupSize
        ? friendTracks.length + myKept.length
        : myKept.length;
    if (mode.kind !== "group" || mode.params.slotIndex === mode.params.groupSize) {
      if (finalSize < FLOOR) {
        window.alert(
          `Your pool is ${finalSize} tracks but the bracket needs at least ${FLOOR} ` +
            `to produce a Top 25. Add ${FLOOR - finalSize} more before continuing.`,
        );
        return;
      }
    }
    if (mode.kind === "group") {
      const combined = [...friendTracks.map((t) => t.id), ...myKept.map((t) => t.id)];
      const isLast = mode.params.slotIndex === mode.params.groupSize;
      if (isLast) {
        // Last slot — rank the merged pool. Friends and you can both have
        // contributed the same song (different IDs, same name+artist), so
        // dedupe by trackKey before saving — otherwise the compare engine's
        // dupe-skip path during floor-fill leaves the saved top 25 short.
        const seenId = new Set<string>();
        const seenKey = new Set<string>();
        const merged: PoolEntry[] = [];
        for (const t of [...friendTracks, ...myKept]) {
          if (!t || !t.id || seenId.has(t.id)) continue;
          const k = trackKey(t);
          if (seenKey.has(k)) continue;
          seenId.add(t.id);
          seenKey.add(k);
          merged.push(t);
        }
        saveKeptPool(merged);
        clearCompareState();
        // Strip group params before navigating.
        window.location.href = `${basePath}/compare/`;
        return;
      }
      // Otherwise build the handoff URL and share/copy it.
      const url = buildHandoffUrl({
        origin: window.location.origin,
        basePath,
        groupSize: mode.params.groupSize,
        nextSlot: mode.params.slotIndex + 1,
        totalSize: mode.params.totalSize,
        combinedIds: combined,
      });
      // SMS/iMessage/Twitter clip URLs over ~2KB silently — that would drop
      // tracks from the receiving slot's pool and the next person would
      // wonder why their list is short. Surface it before the user copies.
      if (url.length > HANDOFF_URL_SAFE_LIMIT) {
        const proceed = window.confirm(
          `Heads up — this handoff link is ${url.length} characters. Some apps ` +
            `(iMessage, SMS) may truncate links over ~${HANDOFF_URL_SAFE_LIMIT}. ` +
            `Send it via a chat app that doesn't truncate (Discord, Signal, email) ` +
            `or trim a few tracks from the pool. Continue anyway?`,
        );
        if (!proceed) return;
      }
      shareOrCopy(url, `Your turn — slot ${mode.params.slotIndex + 1}/${mode.params.groupSize}`);
      return;
    }
    // solo / shared
    saveKeptPool(myKept);
    clearCompareState();
    window.location.href = `${basePath}/compare/`;
  }

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-50 pb-28">
      <header className="sticky top-0 z-10 backdrop-blur bg-zinc-950/85 border-b border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight">
              {mode.kind === "group"
                ? `Group bracket · slot ${mode.params.slotIndex}/${mode.params.groupSize}`
                : mode.kind === "shared"
                ? "Shared pool"
                : `Your ${poolSize}`}
            </h1>
            {mode.kind === "group" ? (
              <p className="text-[11px] text-zinc-500 leading-tight truncate">
                {friendCount} from friends · contribute {myTarget}
              </p>
            ) : composition ? (
              <p className="text-[11px] text-zinc-500 leading-tight truncate">
                {composition.shared
                  ? `${composition.shared} shared`
                  : `${pool.length} tracks · ${
                      SOURCE_LEGEND_ORDER.filter((s) => composition[s] > 0).length
                    } sources`}
              </p>
            ) : null}
          </div>
          <div className="text-right flex-none">
            {mode.kind === "group" ? (
              <>
                <div
                  className={`text-base font-semibold leading-tight tabular-nums ${
                    myReady ? "text-emerald-400" : myKept.length > myTarget ? "text-amber-400" : "text-zinc-200"
                  }`}
                >
                  {myKept.length}/{myTarget}
                </div>
                <div className="text-[11px] text-zinc-500 leading-tight">
                  {myReady
                    ? "ready"
                    : myKept.length < myTarget
                    ? `add ${myTarget - myKept.length}`
                    : `remove ${myKept.length - myTarget}`}
                </div>
              </>
            ) : (
              <>
                <div
                  className={`text-base font-semibold leading-tight tabular-nums ${
                    myReady ? "text-emerald-400" : myKept.length > poolSize ? "text-amber-400" : "text-zinc-200"
                  }`}
                >
                  {myKept.length}/{poolSize}
                </div>
                <div className="text-[11px] text-zinc-500 leading-tight">
                  {myReady
                    ? "ready"
                    : myKept.length < poolSize
                    ? `add ${poolSize - myKept.length}`
                    : `remove ${myKept.length - poolSize}`}
                </div>
              </>
            )}
          </div>
        </div>

        {mode.kind === "group" && expectedFromCount(mode.params.groupSize, mode.params.slotIndex, mode.params.totalSize) !== friendCount && (
          <div className="bg-amber-950/40 border-t border-amber-800/40 px-4 py-1.5 text-[11px] text-amber-200">
            Expected {expectedFromCount(mode.params.groupSize, mode.params.slotIndex, mode.params.totalSize)} tracks from earlier slots, got
            {" "}{friendCount}. Some IDs may have been invalid.
          </div>
        )}
      </header>

      <div className="max-w-3xl mx-auto px-2 pt-2">
        {/* Friend contributions section (group mode only) — locked. */}
        {mode.kind === "group" && friendTracks.length > 0 && (
          <div className="mb-3">
            <div className="px-1 mb-1 flex items-center justify-between">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider">
                Locked from friends · {friendTracks.length}
              </p>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
              {friendTracks.map((t) => (
                <FriendTile key={`f-${t.id}`} track={t} />
              ))}
            </div>
          </div>
        )}

        {/* Solo-mode size toggle. Hidden in shared/group because the size
            is dictated by the inbound link, not the current user. */}
        {mode.kind === "solo" && (
          <div className="px-1 mb-2 flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">Pool size</span>
            <div className="inline-flex rounded-full border border-zinc-800 bg-zinc-900 p-0.5" role="tablist">
              {([64, 128] as PoolSize[]).map((n) => (
                <button
                  key={n}
                  role="tab"
                  aria-selected={poolSize === n}
                  onClick={() => onChangeSize(n)}
                  className={`px-3 h-7 rounded-full text-xs font-semibold tabular-nums transition ${
                    poolSize === n
                      ? "bg-zinc-100 text-zinc-900"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-zinc-600 hidden sm:inline">
              {poolSize === 64 ? "quicker · ~100 votes" : "deeper · ~220 votes"}
            </span>
          </div>
        )}

        {/* Source legend. Only meaningful when the pool was built locally
            (solo/shared modes) — group mode pools blend across users and
            the per-source counts become misleading. Sources with zero
            tracks are hidden so the strip stays tight. */}
        {mode.kind !== "group" && composition && pool.length > 0 && (
          <div
            className="px-1 mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400"
            aria-label="Pool source legend"
          >
            {SOURCE_LEGEND_ORDER.filter((s) => composition[s] > 0).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${SOURCE_DOT[s]}`}
                  aria-hidden
                />
                <span>
                  {SOURCE_LABEL[s]}{" "}
                  <span className="tabular-nums text-zinc-500">
                    ({composition[s]})
                  </span>
                </span>
              </span>
            ))}
          </div>
        )}

        {/* Your contributable pool. */}
        {mode.kind === "group" && (
          <p className="px-1 mt-4 mb-1 text-[11px] text-zinc-500 uppercase tracking-wider">
            Your contribution · keep {myTarget}
          </p>
        )}
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

        <div className="text-center mt-6 pb-4 space-y-2">
          {mode.kind === "solo" && (
            <>
              <div>
                <ShareButton kept={myKept} />
              </div>
              <div>
                <button
                  onClick={() => setGroupModalOpen(true)}
                  disabled={myKept.length === 0}
                  className="text-xs text-zinc-400 hover:text-zinc-200 underline disabled:opacity-40"
                >
                  start group bracket →
                </button>
              </div>
            </>
          )}
          <div>
            <button
              onClick={() => {
                if (confirm("Refetch your pool from Spotify? Your tap-to-removes will reset.")) {
                  clearBuiltPool();
                  const u = new URL(window.location.href);
                  u.searchParams.delete("p");
                  u.searchParams.delete("g");
                  u.searchParams.delete("s");
                  window.location.replace(u.toString());
                }
              }}
              className="text-xs text-zinc-500 hover:text-zinc-300 underline"
            >
              rebuild pool from Spotify
            </button>
          </div>
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
            disabled={!myReady}
            className={`h-12 px-5 rounded-full font-semibold flex-none text-sm sm:text-base ${
              myReady ? "bg-[#1DB954] active:bg-[#1ed760] text-black" : "bg-zinc-800 text-zinc-500"
            }`}
            onClick={onPrimaryAction}
          >
            {primaryLabel(mode, totalCount, totalTarget)}
          </button>
        </div>
      </footer>

      {searchOpen && (
        <SearchModal
          onClose={() => setSearchOpen(false)}
          onPick={(t) => {
            addManual(t);
          }}
          onImport={(tracks) => addManyManual(tracks)}
          existingIds={new Set([...myKept.map((p) => p.id), ...friendTracks.map((p) => p.id)])}
        />
      )}

      {groupModalOpen && (
        <GroupSetupModal
          onClose={() => setGroupModalOpen(false)}
          keptIds={myKept.map((t) => t.id)}
          basePath={basePath}
          initialTotal={poolSize}
        />
      )}
    </main>
  );
}

function primaryLabel(mode: Mode, totalCount: number, totalTarget: number): string {
  if (mode.kind === "group") {
    const isLast = mode.params.slotIndex === mode.params.groupSize;
    if (isLast) return `Start ranking (${totalCount}/${totalTarget}) →`;
    return `Send to slot ${mode.params.slotIndex + 1} →`;
  }
  return "Start →";
}

function blankComposition(): Record<PoolSource, number> {
  return {
    playlist: 0,
    short_term: 0,
    medium_term: 0,
    recently_played: 0,
    long_term: 0,
    recap: 0,
    daylist: 0,
    saved_early: 0,
    genre_fill: 0,
    manual: 0,
    shared: 0,
  };
}

async function shareOrCopy(url: string, title: string) {
  type Nav = Navigator & { share?: (data: ShareData) => Promise<void> };
  const nav = navigator as Nav;
  if (typeof nav.share === "function") {
    try {
      await nav.share({ title: "Songrank", text: title, url });
      return;
    } catch {
      // user cancelled — fall through
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    alert("Link copied — paste into iMessage / DM to your friend.");
  } catch {
    window.prompt("Copy this link:", url);
  }
}

function FriendTile({ track }: { track: PoolEntry }) {
  const art = track.album.images?.[0]?.url ?? "";
  return (
    <div
      title={`${track.name} — ${track.artists.map((a) => a.name).join(", ")}`}
      className="relative aspect-square rounded-md overflow-hidden border border-sky-800/60"
    >
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art} alt={track.album.name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-zinc-800" />
      )}
      <span className="absolute top-1 left-1 w-2 h-2 rounded-full bg-sky-400" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/55 to-transparent p-1 pt-5 text-left">
        <div className="text-[10px] font-medium leading-tight line-clamp-1">{track.name}</div>
        <div className="text-[10px] text-zinc-400 leading-tight line-clamp-1">
          {track.artists.map((a) => a.name).join(", ")}
        </div>
      </div>
    </div>
  );
}

function GroupSetupModal({
  onClose,
  keptIds,
  basePath,
  initialTotal,
}: {
  onClose: () => void;
  keptIds: string[];
  basePath: string;
  initialTotal: PoolSize;
}) {
  const [size, setSize] = useState(4);
  const [totalSize, setTotalSize] = useState<PoolSize>(initialTotal);

  const mySize = slotSizeFn(size, 1, totalSize);
  const enoughKept = keptIds.length >= mySize;

  function onStart() {
    // Take the first `mySize` IDs as the host's contribution. The host can
    // re-curate later if they want by tap-removing then re-running.
    const myContribution = keptIds.slice(0, mySize);
    const url = buildHandoffUrl({
      origin: window.location.origin,
      basePath,
      groupSize: size,
      nextSlot: 2,
      totalSize,
      combinedIds: myContribution,
    });
    shareOrCopy(
      url,
      `Slot 2/${size} — your turn to add ${slotSizeFn(size, 2, totalSize)} tracks`,
    );
    onClose();
  }

  return (
    <div className="fixed inset-0 z-30 bg-zinc-950/95 backdrop-blur flex items-center justify-center p-4">
      <div className="max-w-sm w-full rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Group bracket</h2>
          <p className="text-zinc-400 text-sm mt-1 leading-snug">
            Up to 4 friends each contribute a slice of the pool. Last person ranks
            the merged {totalSize}.
          </p>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">
            Total pool size
          </label>
          <div className="flex gap-2">
            {([64, 128] as PoolSize[]).map((n) => (
              <button
                key={n}
                onClick={() => setTotalSize(n)}
                className={`flex-1 h-11 rounded-lg border font-semibold transition ${
                  totalSize === n
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                    : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                Top {n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">
            How many people total?
          </label>
          <div className="flex gap-2">
            {Array.from({ length: MAX_GROUP - MIN_GROUP + 1 }, (_, i) => i + MIN_GROUP).map((n) => (
              <button
                key={n}
                onClick={() => setSize(n)}
                className={`flex-1 h-12 rounded-lg border font-semibold transition ${
                  size === n
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                    : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-zinc-400">Each slot contributes:</span>
            <span className="font-mono">
              {slotSizeFn(size, 1, totalSize)} (last: {slotSizeFn(size, size, totalSize)})
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">You contribute:</span>
            <span className={`font-mono ${enoughKept ? "text-zinc-200" : "text-amber-400"}`}>
              {Math.min(mySize, keptIds.length)}/{mySize}
            </span>
          </div>
        </div>

        {!enoughKept && (
          <div className="text-xs text-amber-400 leading-snug">
            Your pool only has {keptIds.length} tracks — need at least {mySize} to host a group of {size}.
            Add more songs first.
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-11 rounded-full bg-zinc-800 active:bg-zinc-700 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            disabled={!enoughKept}
            onClick={onStart}
            className="flex-1 h-11 rounded-full bg-[#1DB954] active:bg-[#1ed760] disabled:opacity-50 text-black text-sm font-semibold"
          >
            Send to slot 2 →
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareButton({ kept }: { kept: PoolEntry[] }) {
  const [copied, setCopied] = useState(false);

  async function onShare() {
    if (kept.length === 0) return;
    const ids = kept.map((t) => t.id).join(",");
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const url = `${window.location.origin}${basePath}/pool/?p=${ids}`;

    type Nav = Navigator & { share?: (data: ShareData) => Promise<void> };
    const nav = navigator as Nav;
    if (typeof nav.share === "function") {
      try {
        await nav.share({
          title: "Songrank pool",
          text: `Rank these ${kept.length} songs:`,
          url,
        });
        return;
      } catch {
        // fall through
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  return (
    <button
      onClick={onShare}
      disabled={kept.length === 0}
      className="text-xs text-zinc-400 hover:text-zinc-200 underline disabled:opacity-40"
    >
      {copied ? "link copied ✓" : "share this pool →"}
    </button>
  );
}

function SearchModal({
  onClose,
  onPick,
  onImport,
  existingIds,
}: {
  onClose: () => void;
  onPick: (track: SpotifyTrack) => void;
  onImport: (tracks: SpotifyTrack[]) => { added: number; restored: number; skipped: number };
  existingIds: Set<string>;
}) {
  const [tab, setTab] = useState<"search" | "playlist">("search");

  return (
    <div className="fixed inset-0 z-30 bg-zinc-950/95 backdrop-blur flex flex-col">
      <div className="flex-none border-b border-zinc-800">
        <div className="max-w-3xl mx-auto px-3 pt-2 pb-2 flex items-center justify-between gap-2">
          {/* Tab toggle — Search by song name vs Import a whole playlist. */}
          <div
            role="tablist"
            aria-label="Add to pool from"
            className="inline-flex items-center gap-1 p-1 rounded-full border border-zinc-800 bg-zinc-900/60"
          >
            <button
              role="tab"
              aria-selected={tab === "search"}
              onClick={() => setTab("search")}
              className={`text-xs sm:text-sm font-medium px-3 sm:px-3.5 h-8 rounded-full transition ${
                tab === "search" ? "bg-zinc-50 text-black" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Search
            </button>
            <button
              role="tab"
              aria-selected={tab === "playlist"}
              onClick={() => setTab("playlist")}
              className={`text-xs sm:text-sm font-medium px-3 sm:px-3.5 h-8 rounded-full transition ${
                tab === "playlist" ? "bg-zinc-50 text-black" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Playlist
            </button>
          </div>
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg bg-zinc-800 active:bg-zinc-700 text-sm font-medium"
          >
            Done
          </button>
        </div>
      </div>

      {tab === "search" ? (
        <SearchTab onPick={onPick} existingIds={existingIds} />
      ) : (
        <PlaylistTab onImport={onImport} existingIds={existingIds} />
      )}
    </div>
  );
}

function SearchTab({
  onPick,
  existingIds,
}: {
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
  const searchTokenRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Sequence-token guard: typing "kendrick" then quickly correcting to
    // "kendrik" used to allow the slower "kendrick" response to overwrite the
    // fresher "kendrik" results. Each render bumps the token; only the
    // most-recent fetch is allowed to set state.
    const myToken = ++searchTokenRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const items = await searchTracks(q);
        if (myToken !== searchTokenRef.current) return; // stale
        setResults(items);
        setErr(null);
      } catch (e) {
        if (myToken !== searchTokenRef.current) return;
        setErr(e instanceof Error ? e.message : "search failed");
      } finally {
        if (myToken === searchTokenRef.current) setLoading(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  return (
    <>
      <div className="flex-none border-b border-zinc-900">
        <div className="max-w-3xl mx-auto px-3 py-2">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search song or artist…"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full h-11 rounded-lg bg-zinc-900 border border-zinc-800 px-3 text-sm focus:outline-none focus:border-zinc-600"
          />
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
              Type a song or &ldquo;song artist&rdquo;. Tap a result to add it to your pool.
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
    </>
  );
}

function PlaylistTab({
  onImport,
  existingIds,
}: {
  onImport: (tracks: SpotifyTrack[]) => { added: number; restored: number; skipped: number };
  existingIds: Set<string>;
}) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null); // id currently importing
  // Per-playlist toast: counts after most recent import. Sticks until the
  // user navigates away or imports the same playlist again.
  const [imported, setImported] = useState<
    Record<string, { added: number; restored: number; skipped: number; total: number }>
  >({});
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancel = false;
    listMyPlaylists()
      .then((items) => {
        if (cancel) return;
        setPlaylists(items);
      })
      .catch((e) => {
        if (cancel) return;
        setErr(e instanceof Error ? e.message : "couldn't load playlists");
      });
    return () => {
      cancel = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!playlists) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return playlists;
    return playlists.filter(
      (p) => p.name.toLowerCase().includes(q) || p.ownerName.toLowerCase().includes(q),
    );
  }, [playlists, filter]);

  async function importPlaylist(p: PlaylistSummary) {
    if (importing) return;
    setImporting(p.id);
    setErr(null);
    try {
      const tracks = await playlistTracks(p.id);
      const result = onImport(tracks);
      setImported((prev) => ({
        ...prev,
        [p.id]: { ...result, total: tracks.length },
      }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "import failed");
    } finally {
      setImporting(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="max-w-3xl mx-auto px-3 pt-3">
        <p className="text-zinc-500 text-xs px-1 mb-2 leading-snug">
          Tap a playlist to bulk-add every song. Then tap any song in your pool to deselect it
          before voting.
        </p>
        {playlists && playlists.length > 8 && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter playlists…"
            className="w-full h-10 rounded-lg bg-zinc-900 border border-zinc-800 px-3 text-sm mb-3 focus:outline-none focus:border-zinc-600"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        )}
        {err && (
          <div className="rounded-lg border border-red-700/60 bg-red-950/40 px-3 py-2 text-xs text-red-200 mb-3 break-all">
            {err}
          </div>
        )}
        {!playlists && !err && (
          <div className="text-center text-zinc-500 text-sm py-8">Loading your playlists…</div>
        )}
        {playlists && playlists.length === 0 && !err && (
          <div className="text-center text-zinc-500 text-sm py-8">
            No playlists found on your Spotify account.
          </div>
        )}

        <ul className="space-y-1.5 mt-1">
          {filtered.map((p) => {
            const isImporting = importing === p.id;
            const result = imported[p.id];
            return (
              <li key={p.id}>
                <button
                  disabled={isImporting}
                  onClick={() => importPlaylist(p)}
                  className="w-full flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/40 p-1.5 pr-3 text-left transition active:scale-[0.99] active:border-emerald-500 disabled:opacity-60"
                >
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageUrl}
                      alt=""
                      className="w-11 h-11 rounded-md object-cover flex-none"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-md bg-zinc-800 flex-none" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm leading-tight truncate">{p.name}</div>
                    <div className="text-[11px] text-zinc-500 leading-tight truncate mt-0.5">
                      {p.trackCount} {p.trackCount === 1 ? "track" : "tracks"}
                      {p.isOwn ? " · yours" : ` · ${p.ownerName}`}
                      {p.collaborative ? " · collab" : ""}
                    </div>
                  </div>
                  <span className="text-[11px] flex-none text-emerald-400">
                    {isImporting
                      ? "importing…"
                      : result
                        ? result.added + result.restored > 0
                          ? `+${result.added + result.restored} ✓`
                          : "all in pool ✓"
                        : "+ import"}
                  </span>
                </button>
                {result && (
                  <div className="text-[10px] text-zinc-500 mt-1 px-2 leading-snug">
                    {summarizeImport(result)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
  // existingIds is intentionally unused in the per-row UI — the
  // bulk-import addManyManual call already handles dedupe and
  // un-removal, and surfacing per-row "in pool" state for hundreds
  // of tracks would just be noise. The summary toast tells the
  // user how many were new vs already-present.
  void existingIds;
}

function summarizeImport(r: { added: number; restored: number; skipped: number; total: number }): string {
  const parts: string[] = [];
  if (r.added) parts.push(`${r.added} added`);
  if (r.restored) parts.push(`${r.restored} restored`);
  if (r.skipped) parts.push(`${r.skipped} dupes`);
  if (parts.length === 0) parts.push("nothing new — all already in pool");
  return `${parts.join(" · ")} (of ${r.total})`;
}
