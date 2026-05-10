// Build the 128-track candidate pool:
//   Layer 1 — playlist (your own playlists' tracks) ← strongest curation signal
//   Layer 2 — short_term top (last 4 weeks)
//   Layer 3 — medium_term top (last 6 months)
//   Layer 4 — recently_played replays (≥2 plays in last 50)
//   Layer 5 — saved library (newest saves first)
//   Layer 6 — long_term top (flaky — backstop only)
//   Layer 7 — genre fill (only if everything above is short)
// playlist is layer 1 because tracks the user manually compiled into their
// own playlists are the strongest "I genuinely chose this" signal Spotify
// exposes — far stronger than algorithmic top tracks.

import { spotifyFetch, type SpotifyTrack, type SpotifyArtist } from "./spotify";

export type PoolSource =
  | "playlist"
  | "short_term"
  | "medium_term"
  | "recently_played"
  | "long_term"
  | "saved_early"
  | "genre_fill"
  | "manual"
  | "shared";

export type PoolEntry = SpotifyTrack & {
  source: PoolSource;
};

const TARGET = 128;
const RECENT_TARGET = 64;

/** Normalize a track title for cross-release dedup. Spotify gives the same
 *  recording multiple IDs across single/album/deluxe/regional/remaster
 *  releases — e.g. "Pink Pony Club" appears as both the 2020 single and
 *  the 2023 album cut. We strip:
 *    - " - <suffix>"   (radio edits, remasters, "from <movie>", etc.)
 *    - "(<version-marker>)"  conservative match: only suffixes containing
 *      known version keywords get dropped, so "(feat. X)" is preserved
 *      since those are genuinely different recordings. */
const VERSION_PAREN_RE =
  /\s*\((?:[^)]*\b(?:remaster(?:ed)?|live|version|edit|mono|stereo|deluxe|explicit|clean|demo|acoustic|remix|bonus|single|album|radio|extended|original|anniversary|sped\s*up|slowed|reissue|re-?recorded|taylor's\s*version)\b[^)]*)\)\s*$/i;

function normalizeTitle(name: string): string {
  let s = name.toLowerCase().trim();
  // " - <anything>" Spotify suffix — almost always a version marker.
  s = s.replace(/\s+-\s+.+$/, "");
  // "(<version-marker>)" trailing parens — only if matches known keywords.
  s = s.replace(VERSION_PAREN_RE, "");
  return s.trim();
}

/** Stable dedup key: normalized title + primary artist (lowercased). Two
 *  tracks with the same key are treated as the same song for pool-building. */
export function trackKey(t: { name: string; artists: Array<{ name: string }> }): string {
  const artist = (t.artists?.[0]?.name ?? "").toLowerCase().trim();
  return `${normalizeTitle(t.name)}|${artist}`;
}

export async function buildPool(): Promise<{
  pool: PoolEntry[];
  composition: Record<PoolSource, number>;
}> {
  const seen = new Set<string>();      // by Spotify track ID
  const seenKey = new Set<string>();   // by normalized name+artist (cross-release dedup)
  const out: PoolEntry[] = [];

  const tag = (tracks: SpotifyTrack[], source: PoolSource) => {
    for (const t of tracks) {
      if (!t || !t.id || seen.has(t.id)) continue;
      const key = trackKey(t);
      if (seenKey.has(key)) continue; // same song under a different ID
      seen.add(t.id);
      seenKey.add(key);
      out.push({ ...t, source });
    }
  };

  // ---------- Layer 1 — user's own playlists ----------
  // Best-effort: skip silently if scope not granted (older sessions).
  try {
    const playlistTracks = await fetchOwnPlaylistTracks();
    tag(playlistTracks, "playlist");
  } catch {
    // 403 = old token without playlist-read-private scope; user re-auth fixes.
  }

  // ---------- Layer 2 — short_term top (last 4 weeks) ----------
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
      playlist: 0,
      short_term: 0,
      medium_term: 0,
      recently_played: 0,
      long_term: 0,
      saved_early: 0,
      genre_fill: 0,
      manual: 0,
      shared: 0,
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

/** Hydrate a list of Spotify track IDs into full track objects (for shared pool
 *  imports). Spotify caps /tracks at 50 ids per call, so batch. */
export async function tracksByIds(ids: string[]): Promise<SpotifyTrack[]> {
  const out: SpotifyTrack[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await spotifyFetch<{ tracks: Array<SpotifyTrack | null> }>(
      `/tracks?ids=${chunk.join(",")}`
    );
    for (const t of res.tracks ?? []) {
      if (t && t.id) out.push(t);
    }
  }
  return out;
}

/** Fetch tracks from the user's own playlists. Filters out Spotify-made
 *  playlists (Daily Mix etc.) by checking owner.id === current user. Caps
 *  at 8 playlists × 100 tracks to keep API budget bounded. */
async function fetchOwnPlaylistTracks(): Promise<SpotifyTrack[]> {
  const me = await spotifyFetch<{ id: string }>("/me");
  const list = await spotifyFetch<{
    items: Array<{ id: string; owner: { id: string }; name: string }>;
  }>("/me/playlists?limit=50");

  const own = (list.items ?? [])
    .filter((p) => p.owner.id === me.id)
    .filter((p) => !/^Liked Songs$/i.test(p.name))
    .slice(0, 8);

  const fields =
    "items(track(id,name,uri,duration_ms,artists(id,name),album(id,name,images)))";
  const out: SpotifyTrack[] = [];
  for (const pl of own) {
    try {
      const trk = await spotifyFetch<{
        items: Array<{ track: SpotifyTrack | null }>;
      }>(`/playlists/${pl.id}/tracks?limit=100&fields=${encodeURIComponent(fields)}`);
      for (const item of trk.items ?? []) {
        if (item.track && item.track.id) out.push(item.track);
      }
    } catch {
      // Single playlist failures shouldn't kill the whole layer.
    }
  }
  return out;
}
