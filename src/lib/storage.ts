// Tiny typed wrappers around localStorage for the bracket run state.
// Everything is per-browser; no syncing, no backend.

import type { PoolEntry, PoolSource } from "./pool";
import type { CompareState } from "./compare";

const KEYS = {
  /** Pool freshly built from Spotify — cached so revisits don't refetch. */
  builtPool: "bracketeering.built_pool",
  builtComposition: "bracketeering.built_composition",
  kept: "bracketeering.kept_pool",
  compare: "bracketeering.compare_state",
  ranked: "bracketeering.ranked",
} as const;

export function saveBuiltPool(pool: PoolEntry[], composition: Record<PoolSource, number>) {
  localStorage.setItem(KEYS.builtPool, JSON.stringify(pool));
  localStorage.setItem(KEYS.builtComposition, JSON.stringify(composition));
}
export function loadBuiltPool(): { pool: PoolEntry[]; composition: Record<PoolSource, number> } | null {
  const p = localStorage.getItem(KEYS.builtPool);
  const c = localStorage.getItem(KEYS.builtComposition);
  if (!p || !c) return null;
  return { pool: JSON.parse(p) as PoolEntry[], composition: JSON.parse(c) as Record<PoolSource, number> };
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
  return s ? (JSON.parse(s) as PoolEntry[]) : null;
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
  return s ? (JSON.parse(s) as PoolEntry[]) : null;
}

export function clearRunState() {
  localStorage.removeItem(KEYS.builtPool);
  localStorage.removeItem(KEYS.builtComposition);
  localStorage.removeItem(KEYS.kept);
  localStorage.removeItem(KEYS.compare);
  localStorage.removeItem(KEYS.ranked);
}
