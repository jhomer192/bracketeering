// Quick sanity test for the predict scoring + bracket seeding helpers.
// Not a real test framework — just a script that asserts on hand-computed
// expectations. Run: node scripts/test-predict.mjs
//
// Mirror of src/lib/predict.ts and src/lib/bracketExport.ts logic — kept
// here so the test runs in plain Node without a TS toolchain. If you
// change one, change both.

// ---------- mirror of src/lib/predict.ts: scoreGuess ----------

function scoreGuess(truth, guess) {
  const n = truth.length;
  if (n === 0 || guess.length !== n) {
    return { exact: 0, pairs: 0, distance: 0, percent: 0 };
  }
  const trueRank = new Map();
  truth.forEach((id, i) => trueRank.set(id, i));
  let exact = 0;
  let distance = 0;
  for (let i = 0; i < n; i++) {
    if (guess[i] === truth[i]) exact++;
    const tr = trueRank.get(guess[i]);
    if (tr !== undefined) distance += Math.abs(tr - i);
  }
  let pairs = 0;
  let pairCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ri = trueRank.get(guess[i]);
      const rj = trueRank.get(guess[j]);
      if (ri === undefined || rj === undefined) continue;
      pairCount++;
      if (ri < rj) pairs++;
    }
  }
  const pairFrac = pairCount > 0 ? pairs / pairCount : 0;
  const exactFrac = n > 0 ? exact / n : 0;
  const percent = Math.round((0.6 * pairFrac + 0.4 * exactFrac) * 100);
  return { exact, pairs, distance, percent };
}

// ---------- mirror of src/lib/predict.ts: shuffleStable + seedFromIds ----------

function shuffleStable(items, seed) {
  const out = items.slice();
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function seedFromIds(ids) {
  let h = 5381;
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) {
      h = ((h << 5) + h + id.charCodeAt(i)) | 0;
    }
  }
  return h >>> 0;
}

// ---------- mirror of src/lib/bracketExport.ts: seededMatchups ----------

function seededMatchups(size) {
  if (size === 8) return [[1, 8], [4, 5], [3, 6], [2, 7]];
  return [
    [1, 16], [8, 9], [5, 12], [4, 13],
    [6, 11], [3, 14], [7, 10], [2, 15],
  ];
}

// ---------- assertions ----------

let passed = 0;
let failed = 0;
function assert(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function assertEq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(name, ok, ok ? null : `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

console.log("scoreGuess:");

const truth = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

// Perfect guess
{
  const s = scoreGuess(truth, truth.slice());
  assertEq("perfect → 10/10 exact", s.exact, 10);
  assertEq("perfect → 45/45 pairs", s.pairs, 45);
  assertEq("perfect → 0 distance", s.distance, 0);
  assertEq("perfect → 100%", s.percent, 100);
}

// Worst possible guess (full reverse)
{
  const s = scoreGuess(truth, truth.slice().reverse());
  assertEq("reverse → 0 exact", s.exact, 0);
  assertEq("reverse → 0 pairs", s.pairs, 0);
  assertEq("reverse → 50 distance (n=10)", s.distance, 50);
  assertEq("reverse → 0%", s.percent, 0);
}

// Two adjacent swaps — should still score very high on pairs
{
  const guess = ["b", "a", "c", "d", "e", "f", "g", "h", "i", "j"];
  const s = scoreGuess(truth, guess);
  assertEq("one swap → 8 exact (a,b moved)", s.exact, 8);
  // 44 of 45 pairs preserved (only a,b is inverted)
  assertEq("one swap → 44 pairs", s.pairs, 44);
  assertEq("one swap → 2 distance", s.distance, 2);
  // 0.6*(44/45) + 0.4*(8/10) = 0.5867 + 0.32 = 0.9067 → 91%
  assert("one swap → ~91%", Math.abs(s.percent - 91) <= 1, `got ${s.percent}`);
}

// Length mismatch defends against malformed inputs
{
  const s = scoreGuess(truth, ["a", "b"]);
  assertEq("length mismatch → zeros", [s.exact, s.pairs, s.distance, s.percent], [0, 0, 0, 0]);
}

console.log("\nshuffleStable:");

// Determinism: same seed → same output
{
  const a = shuffleStable([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 42);
  const b = shuffleStable([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 42);
  assertEq("deterministic same seed", a, b);
}

// Different seed → different output (probabilistic but reliable for n=10)
{
  const a = shuffleStable([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1);
  const b = shuffleStable([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2);
  assert("different seed differs", JSON.stringify(a) !== JSON.stringify(b));
}

// All elements preserved (no loss/dup)
{
  const a = shuffleStable([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 12345);
  const sorted = [...a].sort((x, y) => x - y);
  assertEq("preserves all elements", sorted, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
}

// Seed derived from the IDs themselves: same IDs → same start order
{
  const ids = ["aaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccccc"];
  const seed1 = seedFromIds(ids);
  const seed2 = seedFromIds(ids);
  assertEq("seedFromIds deterministic", seed1, seed2);
}

console.log("\nseededMatchups:");

// 16-bracket: every seed 1..16 appears exactly once
{
  const m = seededMatchups(16);
  const seen = new Set();
  for (const [a, b] of m) { seen.add(a); seen.add(b); }
  assertEq("16-bracket covers 1..16", [...seen].sort((x, y) => x - y), Array.from({ length: 16 }, (_, i) => i + 1));
  // Standard property: each pair sums to 17 (1+16, 8+9, 5+12, 4+13, ...)
  const allSeventeen = m.every(([a, b]) => a + b === 17);
  assert("16-bracket: every pair sums to 17", allSeventeen);
}

// 8-bracket: same property, sums to 9
{
  const m = seededMatchups(8);
  const seen = new Set();
  for (const [a, b] of m) { seen.add(a); seen.add(b); }
  assertEq("8-bracket covers 1..8", [...seen].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8]);
  const allNine = m.every(([a, b]) => a + b === 9);
  assert("8-bracket: every pair sums to 9", allNine);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
