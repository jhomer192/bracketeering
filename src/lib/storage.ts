// Tiny typed wrappers around localStorage for the bracket run state.
// Everything is per-browser; no syncing, no backend.

import { trackKey, type PoolEntry, type PoolSource } from "./pool";
import type { CompareState } from "./compare";

/** Parse a JSON string from localStorage with safety nets:
 *  - Catches malformed JSON (extension corruption, partial writes on tab kill).
 *  - Optionally validates shape via the predicate.
 *  - Auto-clears the key on failure so the next load is clean rather than
 *    stuck on the same crash.
 *
 *  Without this, a single corrupt entry would throw inside `loadKeptPool`
 *  / `loadRanked` / etc., bubble to error.tsx, and "Try again" would just
 *  re-run the same parse and crash again — a real loop with no escape. */
function safeJsonRead<T>(key: string, predicate?: (v: unknown) => v is T): T | null {
  const s = (typeof localStorage !== "undefined" && localStorage.getItem(key)) || null;
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    if (predicate && !predicate(v)) {
      localStorage.removeItem(key);
      return null;
    }
    return v as T;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

const isPoolEntryArray = (v: unknown): v is PoolEntry[] =>
  Array.isArray(v) && v.every((t) => t && typeof (t as PoolEntry).id === "string");
const isCompareState = (v: unknown): v is CompareState =>
  !!v && typeof v === "object";
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const isComposition = (v: unknown): v is Record<PoolSource, number> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Heal pre-existing caches that were written before cross-release dedup
 *  landed (e.g. "Pink Pony Club" appearing twice with different IDs).
 *  Idempotent — applying it to an already-clean pool is a no-op. */
function dedupePool(pool: PoolEntry[]): PoolEntry[] {
  const seenId = new Set<string>();
  const seenKey = new Set<string>();
  const out: PoolEntry[] = [];
  for (const t of pool) {
    if (!t || !t.id || seenId.has(t.id)) continue;
    const k = trackKey(t);
    if (seenKey.has(k)) continue;
    seenId.add(t.id);
    seenKey.add(k);
    out.push(t);
  }
  return out;
}

const KEYS = {
  /** Pool freshly built from Spotify — cached so revisits don't refetch. */
  builtPool: "bracketeering.built_pool",
  builtComposition: "bracketeering.built_composition",
  kept: "bracketeering.kept_pool",
  compare: "bracketeering.compare_state",
  ranked: "bracketeering.ranked",
  /** User-curated final ordering on the reveal page. List of track IDs in
   *  order. When set, takes precedence over the default vote+tail stitch.
   *  Stored separately from `ranked` so re-running compare doesn't clobber
   *  manual reorders, and so the heal-on-load logic only touches `ranked`. */
  fullOrdering: "bracketeering.full_ordering",
  /** Shared-pool import queued before login. Comma-sep Spotify track IDs. */
  pendingImport: "bracketeering.pending_import",
  /** User's chosen pool size (64 or 128). Persists across sessions so the
   *  rebuild button doesn't silently re-flip back to 128. */
  poolSize: "bracketeering.pool_size",
} as const;

export type PoolSize = 64 | 128;
const VALID_SIZES: PoolSize[] = [64, 128];

export function getPoolSize(): PoolSize {
  const v = parseInt(localStorage.getItem(KEYS.poolSize) ?? "", 10);
  return (VALID_SIZES as number[]).includes(v) ? (v as PoolSize) : 128;
}
export function setPoolSize(size: PoolSize) {
  localStorage.setItem(KEYS.poolSize, String(size));
}

export function setPendingImport(ids: string) {
  localStorage.setItem(KEYS.pendingImport, ids);
}
export function takePendingImport(): string | null {
  const v = localStorage.getItem(KEYS.pendingImport);
  if (v) localStorage.removeItem(KEYS.pendingImport);
  return v;
}

export function saveBuiltPool(pool: PoolEntry[], composition: Record<PoolSource, number>) {
  localStorage.setItem(KEYS.builtPool, JSON.stringify(pool));
  localStorage.setItem(KEYS.builtComposition, JSON.stringify(composition));
}
export function loadBuiltPool(): { pool: PoolEntry[]; composition: Record<PoolSource, number> } | null {
  const pool = safeJsonRead<PoolEntry[]>(KEYS.builtPool, isPoolEntryArray);
  const composition = safeJsonRead<Record<PoolSource, number>>(
    KEYS.builtComposition,
    isComposition,
  );
  if (!pool || !composition) return null;
  return { pool: dedupePool(pool), composition };
}
export function clearBuiltPool() {
  localStorage.removeItem(KEYS.builtPool);
  localStorage.removeItem(KEYS.builtComposition);
}

export function saveKeptPool(pool: PoolEntry[]) {
  localStorage.setItem(KEYS.kept, JSON.stringify(pool));
}
export function loadKeptPool(): PoolEntry[] | null {
  const v = safeJsonRead<PoolEntry[]>(KEYS.kept, isPoolEntryArray);
  return v ? dedupePool(v) : null;
}

export function saveCompareState(state: CompareState) {
  localStorage.setItem(KEYS.compare, JSON.stringify(state));
}
export function loadCompareState(): CompareState | null {
  return safeJsonRead<CompareState>(KEYS.compare, isCompareState);
}
export function clearCompareState() {
  localStorage.removeItem(KEYS.compare);
}

export function saveRanked(ranked: PoolEntry[]) {
  localStorage.setItem(KEYS.ranked, JSON.stringify(ranked));
}
export function loadRanked(): PoolEntry[] | null {
  const v = safeJsonRead<PoolEntry[]>(KEYS.ranked, isPoolEntryArray);
  return v ? dedupePool(v) : null;
}

/** Persist the user's hand-curated final ordering (list of track IDs).
 *  Reveal page applies this on top of the default vote+tail stitch so
 *  reorders survive reloads, and the Spotify export uses this order. */
export function saveFullOrdering(ids: string[]) {
  localStorage.setItem(KEYS.fullOrdering, JSON.stringify(ids));
}
export function loadFullOrdering(): string[] | null {
  return safeJsonRead<string[]>(KEYS.fullOrdering, isStringArray);
}
export function clearFullOrdering() {
  localStorage.removeItem(KEYS.fullOrdering);
}

export function clearRunState() {
  localStorage.removeItem(KEYS.builtPool);
  localStorage.removeItem(KEYS.builtComposition);
  localStorage.removeItem(KEYS.kept);
  localStorage.removeItem(KEYS.compare);
  localStorage.removeItem(KEYS.ranked);
  localStorage.removeItem(KEYS.fullOrdering);
  localStorage.removeItem(KEYS.pendingImport);
}
