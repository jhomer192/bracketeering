// Beli-style binary-insertion ranking with a "top-N floor".
//
// We never fully sort all 128 — we only fully rank the top 25. For every
// new track we either binary-insert it into the ranked top-25 (≤log2(26)
// ≈ 5 comparisons) or eliminate it after a single comparison against the
// current bottom of the top-25. That's ~200–250 votes total for 128 tracks
// vs ~900 for full sort. Top 10 is then just the first 10 of the top 25.
//
// State machine (so React can drive the UI): each tick either yields a
// matchup `{ a, b }` for the user to vote on, or returns `done` once the
// remaining queue is empty. Pure logic — no DOM, no localStorage.

import { trackKey, type PoolEntry } from "./pool";

export const FLOOR = 25; // fully rank only the top 25

export type Matchup = {
  /** Track being placed (the challenger). */
  a: PoolEntry;
  /** Track currently held against it (an already-ranked incumbent). */
  b: PoolEntry;
};

export type CompareState = {
  /** Tracks not yet placed. We pop from the end. */
  queue: PoolEntry[];
  /** Ranked tracks, best → worst, capped at FLOOR. */
  ranked: PoolEntry[];
  /** Track currently being placed. */
  placing: PoolEntry | null;
  /** Binary-search bounds within `ranked` for the current placement. */
  lo: number;
  hi: number;
  /** Total comparisons cast so far (for the progress UI). */
  votes: number;
  /** Estimated comparisons remaining. Updated lazily. */
  estRemaining: number;
};

export type Vote = "a" | "b";

/** Initialize from a built pool. Order of `pool` is preserved as a tiebreaker
 *  hint — earlier-source tracks (recent → all-time → genre) get placed first
 *  so the top of `ranked` settles around the user's most-played stuff first. */
export function initCompare(pool: PoolEntry[]): CompareState {
  // Pop from the end → reverse so first-popped = first-pool-entry.
  const queue = [...pool].reverse();
  const s: CompareState = {
    queue,
    ranked: [],
    placing: null,
    lo: 0,
    hi: 0,
    votes: 0,
    estRemaining: estimateRemaining(pool.length, 0),
  };
  return advance(s);
}

/** Compute the next matchup, or finalize the current placement if its
 *  binary-search range has collapsed. Returns the same state object updated
 *  in place (reducer-style — caller should treat as immutable from outside). */
function advance(s: CompareState): CompareState {
  // Finalize any in-flight placement whose lo/hi have collapsed.
  if (s.placing && s.lo >= s.hi) {
    insertAt(s, s.placing, s.lo);
    s.placing = null;
  }

  // Pull the next track from the queue if we don't have one in flight.
  while (!s.placing && s.queue.length > 0) {
    const next = s.queue.pop()!;

    // Defense-in-depth: skip any track that's effectively a duplicate of
    // something already ranked (same ID OR same normalized name+artist).
    // Pool-build dedup catches this upstream, but in-flight CompareStates
    // saved before that fix can still contain dupes — silently dropping
    // them prevents "Pink Pony Club vs Pink Pony Club" matchups.
    const nextKey = trackKey(next);
    if (s.ranked.some((r) => r.id === next.id || trackKey(r) === nextKey)) {
      continue;
    }

    if (s.ranked.length < FLOOR) {
      // Floor not yet full — binary-insert into the whole ranked list.
      s.placing = next;
      s.lo = 0;
      s.hi = s.ranked.length;
      if (s.lo >= s.hi) {
        // Empty ranked → just push.
        insertAt(s, next, 0);
        s.placing = null;
        continue;
      }
      break;
    }

    // Floor full → first compare against current #FLOOR.
    s.placing = next;
    s.lo = 0;
    s.hi = FLOOR;
    // Special case handled in vote(): when ranked is full we always test
    // against position FLOOR-1 first; if challenger loses we discard it
    // without paying log2(FLOOR) comparisons.
    break;
  }

  s.estRemaining = estimateRemaining(s.queue.length + (s.placing ? 1 : 0), s.ranked.length);
  return s;
}

/** Apply the user's vote. `winner` is "a" if challenger beat incumbent. */
export function vote(s: CompareState, winner: Vote): CompareState {
  if (!s.placing) return s; // shouldn't happen — guard anyway
  s.votes += 1;

  // Floor-eviction shortcut: when ranked is full, the very first vote is
  // against position FLOOR-1 (see currentMatchup). Lose → discard;
  // win → narrow to [0, FLOOR-1] and binary-search from there.
  if (s.ranked.length === FLOOR && s.lo === 0 && s.hi === FLOOR) {
    if (winner === "b") {
      s.placing = null;
      return advance(s);
    }
    s.hi = FLOOR - 1;
    return advance(s);
  }

  const mid = midOf(s.lo, s.hi);
  if (winner === "a") {
    // Challenger beat the incumbent at `mid` → it ranks higher (smaller index)
    s.hi = mid;
  } else {
    // Challenger lost → it ranks lower
    s.lo = mid + 1;
  }
  return advance(s);
}

/** Get the current matchup the UI should display. */
export function currentMatchup(s: CompareState): Matchup | null {
  if (!s.placing) return null;
  // First comparison against position FLOOR-1 if ranked is full and we
  // haven't started narrowing yet — gives us the cheap-discard path.
  let incumbentIdx: number;
  if (s.ranked.length === FLOOR && s.lo === 0 && s.hi === FLOOR) {
    incumbentIdx = FLOOR - 1;
  } else {
    incumbentIdx = midOf(s.lo, s.hi);
  }
  const incumbent = s.ranked[incumbentIdx];
  if (!incumbent) return null;
  return { a: s.placing, b: incumbent };
}

export function isDone(s: CompareState): boolean {
  return !s.placing && s.queue.length === 0;
}

// ---- internals ----

function midOf(lo: number, hi: number) {
  return Math.floor((lo + hi) / 2);
}

function insertAt(s: CompareState, t: PoolEntry, idx: number) {
  s.ranked.splice(idx, 0, t);
  if (s.ranked.length > FLOOR) s.ranked.length = FLOOR; // evict bottom
}

function estimateRemaining(queueAhead: number, rankedSoFar: number): number {
  // Average per track:
  //   - while ranked < FLOOR: ~log2(rankedSoFar+1) comparisons
  //   - after FLOOR full: 1 (eviction test) + p * log2(FLOOR), p ≈ 0.2
  let total = 0;
  let r = rankedSoFar;
  for (let i = 0; i < queueAhead; i++) {
    if (r < FLOOR) {
      total += Math.max(1, Math.ceil(Math.log2(r + 1)));
      r += 1;
    } else {
      total += 1 + 0.2 * Math.ceil(Math.log2(FLOOR));
    }
  }
  return Math.round(total);
}
