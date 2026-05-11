// Predict-my-top-10 share feature.
//
// Sender (you, after voting): generates a URL like
//   /predict/?t=id1,id2,id3,...,id10
// where the IDs are in true rank order (#1 first). Spotify track IDs are
// 22 chars each; 10 of them with commas is ~229 chars, well under any
// chat platform's URL clip limit.
//
// Receiver (your friend): visits the link in any browser, sees the same
// 10 tracks in shuffled order, drags them into their predicted order,
// submits, and the page scores them against the true ranking.
//
// Why no obfuscation of the answer key? It's a casual share game, not
// a security boundary. A determined cheater can view source either way;
// the average user just plays. The URL fits in a tweet either way.
//
// Why oEmbed for metadata? The recipient may not have done the BYO
// Client ID setup — forcing them to register a Spotify dev app to play
// a 30-second guessing game would kill the feature. Spotify's public
// oEmbed endpoint returns title + thumbnail with no auth and CORS open.

export type PredictMeta = {
  id: string;
  title: string;
  artist: string;
  thumbnailUrl: string | null;
};

const ID_RE = /^[A-Za-z0-9]{22}$/;

/** Build the share URL. `topTen` is the 10 PoolEntry-shaped objects in
 *  true rank order; we only encode the IDs, the rest is reconstructed
 *  recipient-side via oEmbed. */
export function buildPredictUrl(opts: {
  origin: string;
  basePath: string;
  topTenIds: string[];
}): string {
  const ids = opts.topTenIds.filter((id) => ID_RE.test(id)).slice(0, 10);
  return `${opts.origin}${opts.basePath}/predict/?t=${ids.join(",")}`;
}

/** Parse the `t=` param into a clean list of valid Spotify track IDs.
 *  Defensive: anyone can hand-craft a URL, so reject malformed/oversize
 *  inputs rather than passing them downstream to oEmbed. */
export function parsePredictParam(raw: string | null): string[] {
  if (!raw) return [];
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ID_RE.test(s));
  // Cap at 10 even if the URL has more. The whole UI assumes 10.
  return ids.slice(0, 10);
}

/** Spotify's oEmbed endpoint returns track metadata without requiring an
 *  access token. Used so /predict works for anyone who clicks the link
 *  — they don't need to have done the BYO Client ID setup.
 *
 *  Endpoint: https://open.spotify.com/oembed?url=...
 *  Response: { title, thumbnail_url, ... }
 *  `title` is shaped "TrackName by ArtistName" — we split on " by " for
 *  display. Falls back to whole-string title if the format ever changes. */
export async function fetchPredictMeta(id: string): Promise<PredictMeta> {
  const trackUrl = `https://open.spotify.com/track/${id}`;
  const res = await fetch(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(trackUrl)}`,
  );
  if (!res.ok) {
    throw new Error(`spotify oembed ${res.status}`);
  }
  const data = (await res.json()) as { title?: string; thumbnail_url?: string };
  const fullTitle = data.title ?? "Unknown track";
  // Spotify titles are "Track by Artist[, Artist]" — preserve any "by"
  // inside a track title by splitting on the LAST " by " occurrence.
  const lastBy = fullTitle.lastIndexOf(" by ");
  let title = fullTitle;
  let artist = "";
  if (lastBy > 0) {
    title = fullTitle.slice(0, lastBy);
    artist = fullTitle.slice(lastBy + 4);
  }
  return {
    id,
    title,
    artist,
    thumbnailUrl: data.thumbnail_url ?? null,
  };
}

/** Deterministic Fisher-Yates shuffle seeded so a refresh doesn't reshuffle
 *  the cards (would be jarring) — but a different visitor sees a different
 *  starting order. The seed is derived from the IDs themselves so two
 *  recipients of the same link see the same starting order, which is also
 *  the right behavior: lets people compare scores fairly. */
export function shuffleStable<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    // Mulberry32 step — small, deterministic, good enough for shuffle.
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

/** Hash the joined ID string to a 32-bit seed. djb2 — fast, no dependency. */
export function seedFromIds(ids: string[]): number {
  let h = 5381;
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) {
      h = ((h << 5) + h + id.charCodeAt(i)) | 0;
    }
  }
  return h >>> 0;
}

export type PredictScore = {
  /** Number of tracks placed at exactly the right rank (0-10). */
  exact: number;
  /** Number of pairs (i,j) with i<j where the relative order matches
   *  the truth — out of C(10,2)=45 pairs. The "are you in the right
   *  ballpark" metric: even a guess that gets 0 exact ranks can score
   *  highly here if the overall shape is right. */
  pairs: number;
  /** Total absolute rank distance summed across all 10 picks. Lower is
   *  better. Theoretical max for n=10 is 50 (perfect reverse). */
  distance: number;
  /** A 0-100 friendly score — heavier weight on pairs (overall taste
   *  alignment) than exact placements (luck). */
  percent: number;
};

/** Score a predicted ordering against the true ordering. Both are arrays
 *  of track IDs of the same length. Truth[0] is the true #1. */
export function scoreGuess(truth: string[], guess: string[]): PredictScore {
  const n = truth.length;
  if (n === 0 || guess.length !== n) {
    return { exact: 0, pairs: 0, distance: 0, percent: 0 };
  }

  // Map truth ID → its true rank (0-indexed).
  const trueRank = new Map<string, number>();
  truth.forEach((id, i) => trueRank.set(id, i));

  let exact = 0;
  let distance = 0;
  for (let i = 0; i < n; i++) {
    if (guess[i] === truth[i]) exact++;
    const tr = trueRank.get(guess[i]);
    if (tr !== undefined) distance += Math.abs(tr - i);
  }

  // Count pairs (i,j) where guess preserves relative order.
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

  // Friendly score: 60% pair-ordering + 40% exact-placement, scaled to 0-100.
  // Pair score by itself feels harsh on a perfect-shape guess that's
  // off-by-one everywhere; exact alone is too unforgiving. The blend reads
  // intuitive: "you got the vibe right" vs "you nailed it."
  const pairFrac = pairCount > 0 ? pairs / pairCount : 0;
  const exactFrac = n > 0 ? exact / n : 0;
  const percent = Math.round((0.6 * pairFrac + 0.4 * exactFrac) * 100);

  return { exact, pairs, distance, percent };
}
