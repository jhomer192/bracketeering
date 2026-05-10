// Quick sanity test for the comparison engine. Not a real test framework —
// just a script that simulates a perfect-judge user (always picks the
// "actually-better" track per a hidden ground-truth ranking) and verifies
// the engine recovers the top 25 in correct order.
//
// Run: node scripts/test-compare.mjs

// Mirror of src/lib/compare.ts logic — kept here so the test runs in
// plain Node without a TS toolchain. If you change one, change both.

const FLOOR = 25;

function midOf(lo, hi) { return Math.floor((lo + hi) / 2); }

function insertAt(s, t, idx) {
  s.ranked.splice(idx, 0, t);
  if (s.ranked.length > FLOOR) s.ranked.length = FLOOR;
}

function advance(s) {
  if (s.placing && s.lo >= s.hi) {
    insertAt(s, s.placing, s.lo);
    s.placing = null;
  }
  while (!s.placing && s.queue.length > 0) {
    const next = s.queue.pop();
    if (s.ranked.length < FLOOR) {
      s.placing = next;
      s.lo = 0;
      s.hi = s.ranked.length;
      if (s.lo >= s.hi) {
        insertAt(s, next, 0);
        s.placing = null;
        continue;
      }
      break;
    }
    s.placing = next;
    s.lo = 0;
    s.hi = FLOOR;
    break;
  }
  return s;
}

function initCompare(pool) {
  const queue = [...pool].reverse();
  return advance({ queue, ranked: [], placing: null, lo: 0, hi: 0, votes: 0 });
}

function currentMatchup(s) {
  if (!s.placing) return null;
  let idx;
  if (s.ranked.length === FLOOR && s.lo === 0 && s.hi === FLOOR) idx = FLOOR - 1;
  else idx = midOf(s.lo, s.hi);
  return { a: s.placing, b: s.ranked[idx] };
}

function vote(s, winner) {
  s.votes += 1;
  if (s.ranked.length === FLOOR && s.lo === 0 && s.hi === FLOOR) {
    if (winner === "b") { s.placing = null; return advance(s); }
    s.hi = FLOOR - 1;
    return advance(s);
  }
  const mid = midOf(s.lo, s.hi);
  if (winner === "a") s.hi = mid;
  else s.lo = mid + 1;
  return advance(s);
}

function isDone(s) { return !s.placing && s.queue.length === 0; }

// Build 128 tracks with a hidden ground-truth ranking: track.id = rank (0 best).
const POOL_SIZE = 128;
const truth = Array.from({ length: POOL_SIZE }, (_, i) => ({ id: i }));

// Shuffle so insertion order doesn't trivially produce a sorted output.
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let s = initCompare(shuffle(truth));
while (!isDone(s)) {
  const m = currentMatchup(s);
  if (!m) break;
  // Perfect judge: lower id = better. Pick "a" iff challenger has lower id.
  s = vote(s, m.a.id < m.b.id ? "a" : "b");
}

const got = s.ranked.map((t) => t.id);
const expected = Array.from({ length: 25 }, (_, i) => i);
const ok = got.length === 25 && got.every((id, i) => id === expected[i]);

console.log("ranked:", got);
console.log("expected:", expected);
console.log("votes:", s.votes);
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
