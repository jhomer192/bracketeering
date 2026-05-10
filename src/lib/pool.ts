// Build the 128-track candidate pool per spec:
//   Layer 1 — recent (target 64): short_term top + recently-played high-replay
//   Layer 2 — all-time (target 64): long_term top + early-saved tracks
//   Layer 3 — genre fill (only if 1+2 short)
//   Layer 4 — graceful degradation (run with whatever pool we got)

import { spotifyFetch, type SpotifyTrack, type SpotifyArtist } from "./spotify";

export type PoolSource = "short_term" | "recently_played" | "long_term" | "saved_early" | "genre_fill";

export type PoolEntry = SpotifyTrack & {
  source: PoolSource;
};

const TARGET = 128;
const RECENT_TARGET = 64;
const ALLTIME_TARGET = 64;

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

  // ---------- Layer 1 ----------
  const shortTerm = await spotifyFetch<{ items: SpotifyTrack[] }>(
    "/me/top/tracks?time_range=short_term&limit=50"
  );
  tag(shortTerm.items, "short_term");

  if (countSources(out, ["short_term", "recently_played"]) < RECENT_TARGET) {
    const recent = await spotifyFetch<{ items: Array<{ track: SpotifyTrack }> }>(
      "/me/player/recently-played?limit=50"
    );
    // Group by track.id, count plays, prefer high-replay tracks
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

  // ---------- Layer 2 ----------
  const longTerm = await spotifyFetch<{ items: SpotifyTrack[] }>(
    "/me/top/tracks?time_range=long_term&limit=50"
  );
  tag(longTerm.items, "long_term");

  if (out.length < RECENT_TARGET + ALLTIME_TARGET) {
    // Saved tracks oldest-first as identity layer
    const saved = await spotifyFetch<{ items: Array<{ track: SpotifyTrack }> }>(
      "/me/tracks?limit=50&offset=0"
    );
    tag(
      (saved.items ?? []).map((i) => i.track).filter(Boolean),
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
    { short_term: 0, recently_played: 0, long_term: 0, saved_early: 0, genre_fill: 0 }
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
