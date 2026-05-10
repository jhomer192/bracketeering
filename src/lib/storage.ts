// Tiny typed wrappers around localStorage for the bracket run state.
// Everything is per-browser; no syncing, no backend.

import { trackKey, type PoolEntry, type PoolSource } from "./pool";
import type { CompareState } from "./compare";

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
  /** Shared-pool import queued before login. Comma-sep Spotify track IDs. */
  pendingImport: "bracketeering.pending_import",
} as const;

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
  const p = localStorage.getItem(KEYS.builtPool);
  const c = localStorage.getItem(KEYS.builtComposition);
  if (!p || !c) return null;
  return {
    pool: dedupePool(JSON.parse(p) as PoolEntry[]),
    composition: JSON.parse(c) as Record<PoolSource, number>,
  };
}
export function clearBuiltPool() {
  localStorage.removeItem(KEYS.builtPool);
  localStorage.removeItem(KEYS.builtComposition);
}

export function saveKeptPool(pool: PoolEntry[]) {
  localStorage.setItem(KEYS.kept, JSON.stringify(pool));
}
export function loadKeptPool(): PoolEntry[] | null {
  const s = localStorage.getItem(KEYS.kept);
  return s ? dedupePool(JSON.parse(s) as PoolEntry[]) : null;
}

export function saveCompareState(state: CompareState) {
  localStorage.setItem(KEYS.compare, JSON.stringify(state));
}
export function loadCompareState(): CompareState | null {
  const s = localStorage.getItem(KEYS.compare);
  return s ? (JSON.parse(s) as CompareState) : null;
}
export function clearCompareState() {
  localStorage.removeItem(KEYS.compare);
}

export function saveRanked(ranked: PoolEntry[]) {
  localStorage.setItem(KEYS.ranked, JSON.stringify(ranked));
}
export function loadRanked(): PoolEntry[] | null {
  const s = localStorage.getItem(KEYS.ranked);
  return s ? dedupePool(JSON.parse(s) as PoolEntry[]) : null;
}

export function clearRunState() {
  localStorage.removeItem(KEYS.builtPool);
  localStorage.removeItem(KEYS.builtComposition);
  localStorage.removeItem(KEYS.kept);
  localStorage.removeItem(KEYS.compare);
  localStorage.removeItem(KEYS.ranked);
  localStorage.removeItem(KEYS.pendingImport);
}
