// Build the 128-track candidate pool:
//   Layer 1 — short_term top (last 4 weeks)
//   Layer 2 — medium_term top (last 6 months) ← best signal for "current favorites"
//   Layer 3 — recently_played replays (≥2 plays in last 50)
//   Layer 4 — saved library (newest saves first — Spotify's default order)
//   Layer 5 — long_term top (flaky for many users, kept as backstop)
//   Layer 6 — genre fill (only if everything above is short)
// long_term is demoted because Spotify's algorithm there can surface tracks
// you barely played — medium_term + saved-library are stronger taste signals.

import { spotifyFetch, type SpotifyTrack, type SpotifyArtist } from "./spotify";

export type PoolSource =
  | "short_term"
  | "medium_term"
  | "recently_played"
  | "long_term"
  | "saved_early"
  | "genre_fill"
  | "manual";

export type PoolEntry = SpotifyTrack & {
  source: PoolSource;
};

const TARGET = 128;
const RECENT_TARGET = 64;

export async function buildPool(): Promise<{
  pool: PoolEntry[];
  composition: Record<PoolSource, number>;
}> {
  const seen = new Set<string>();
  const out: PoolEntry[] = [];

  const tag = (tracks: SpotifyTrack[], source: PoolSource) => {
    for (const t of tracks) {
      if (!t || !t.id || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ ...t, source });
    }
  };

  // ---------- Layer 1 — short_term top (last 4 weeks) ----------
  const shortTerm = await spotifyFetch<{ items: SpotifyTrack[] }>(
    "/me/top/tracks?time_range=short_term&limit=50"
  );
  tag(shortTerm.items, "short_term");

  // ---------- Layer 2 — medium_term top (last 6 months) ----------
  // This is usually the best "current favorites" signal — recent enough to
  // reflect actual taste, long enough to be stable.
  const mediumTerm = await spotifyFetch<{ items: SpotifyTrack[] }>(
    "/me/top/tracks?time_range=medium_term&limit=50"
  );
  tag(mediumTerm.items, "medium_term");

  // ---------- Layer 3 — recently played replays (only if recent slate light) ----------
  if (countSources(out, ["short_term", "recently_played"]) < RECENT_TARGET) {
    const recent = await spotifyFetch<{ items: Array<{ track: SpotifyTrack }> }>(
      "/me/player/recently-played?limit=50"
    );
    const counts = new Map<string, { track: SpotifyTrack; count: number }>();
    for (const item of recent.items ?? []) {
      const t = item.track;
      if (!t || !t.id) continue;
      const cur = counts.get(t.id);
      if (cur) cur.count += 1;
      else counts.set(t.id, { track: t, count: 1 });
    }
    const replayPicks = [...counts.values()]
      .filter((x) => x.count >= 2)
      .sort((a, b) => b.count - a.count)
      .map((x) => x.track);
    tag(replayPicks, "recently_played");
  }

  // ---------- Layer 4 — saved library (newest saves) ----------
  // Spotify /me/tracks default order is added_at desc — these are tracks the
  // user explicitly saved, which is a stronger signal than algorithmic "top".
  if (out.length < TARGET) {
    const saved = await spotifyFetch<{ items: Array<{ track: SpotifyTrack }> }>(
      "/me/tracks?limit=50&offset=0"
    );
    tag(
      (saved.items ?? []).map((i) => i.track).filter(Boolean),
      "saved_early"
    );
  }

  // ---------- Layer 5 — long_term as backstop ----------
  // Demoted because Spotify's long_term algorithm can include tracks you
  // barely played. Only pulled if we still need bodies.
  if (out.length < TARGET) {
    const longTerm = await spotifyFetch<{ items: SpotifyTrack[] }>(
      "/me/top/tracks?time_range=long_term&limit=50"
    );
    tag(longTerm.items, "long_term");
  }

  // Pull a second page of saves if we still need more.
  if (out.length < TARGET) {
    const saved2 = await spotifyFetch<{ items: Array<{ track: SpotifyTrack }> }>(
      "/me/tracks?limit=50&offset=50"
    );
    tag(
      (saved2.items ?? []).map((i) => i.track).filter(Boolean),
      "saved_early"
    );
  }

  // ---------- Layer 3 — genre fill (only if still under target) ----------
  if (out.length < TARGET) {
    try {
      const genreFill = await fillFromGenres(TARGET - out.length, seen);
      tag(genreFill, "genre_fill");
    } catch {
      // Genre fill is best-effort; pool can run smaller.
    }
  }

  // Trim to target
  const pool = out.slice(0, TARGET);

  const composition = pool.reduce<Record<PoolSource, number>>(
    (acc, t) => {
      acc[t.source] = (acc[t.source] ?? 0) + 1;
      return acc;
    },
    {
      short_term: 0,
      medium_term: 0,
      recently_played: 0,
      long_term: 0,
      saved_early: 0,
      genre_fill: 0,
      manual: 0,
    }
  );

  return { pool, composition };
}

function countSources(pool: PoolEntry[], sources: PoolSource[]) {
  return pool.filter((t) => sources.includes(t.source)).length;
}

async function fillFromGenres(
  needed: number,
  alreadySeen: Set<string>
): Promise<SpotifyTrack[]> {
  // Spotify deprecated /recommendations in 2024. Fallback: derive top genres from
  // top artists, then search Spotify for popular tracks tagged in those genres.
  const artists = await spotifyFetch<{ items: SpotifyArtist[] }>(
    "/me/top/artists?time_range=long_term&limit=50"
  );
  const genreCount = new Map<string, number>();
  for (const a of artists.items ?? []) {
    for (const g of a.genres ?? []) genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
  }
  const topGenres = [...genreCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);

  const out: SpotifyTrack[] = [];
  for (const genre of topGenres) {
    if (out.length >= needed) break;
    const q = encodeURIComponent(`genre:"${genre}"`);
    const search = await spotifyFetch<{ tracks: { items: SpotifyTrack[] } }>(
      `/search?q=${q}&type=track&limit=${Math.min(50, needed - out.length + 10)}`
    );
    for (const t of search.tracks.items ?? []) {
      if (!alreadySeen.has(t.id)) out.push(t);
    }
  }
  return out;
}

/** Free-text track search for the "add a song" UI. Returns top 10 hits. */
export async function searchTracks(query: string): Promise<SpotifyTrack[]> {
  const q = query.trim();
  if (!q) return [];
  const enc = encodeURIComponent(q);
  const res = await spotifyFetch<{ tracks: { items: SpotifyTrack[] } }>(
    `/search?q=${enc}&type=track&limit=10`
  );
  return res.tracks.items ?? [];
}
