// Build the 128-track candidate pool:
//   Layer 1 — playlist (your own playlists' tracks) ← strongest curation signal
//   Layer 2 — medium_term top (last 6 months)        ← current favorites
//   Layer 3 — long_term top (last several years)     ← all-time favorites
//   Layer 4 — short_term top (last 4 weeks)          ← only if pool < target
//   Layer 5 — genre fill                              ← last-resort backstop
//
// Layers 1-3 are admitted UNCONDITIONALLY: playlist + medium + all 50 of
// long_term go in regardless of how full the pool is, because Spotify's
// long_term top 50 is the most defensible "this person actually likes
// this song" list available. If overshoots happen they're trimmed at the
// end, but short_term and genre_fill are the only layers that get
// skipped when the pool is already at target.
//
// Removed (with intent, see commits):
//   - saved library: tapping the heart means "remember this exists," not
//     "I love this song." Most-recent-saves was producing one-time-played
//     tracks in brackets, which is the exact opposite of the goal.
//   - recently_played replays: ≥2 plays in the last 50 tracks heard is
//     noise (one afternoon of listening), not a favorite signal. short_term
//     top covers recent favorites with Spotify's own play-volume weighting.

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

const DEFAULT_TARGET = 128;

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

export async function buildPool(target: number = DEFAULT_TARGET): Promise<{
  pool: PoolEntry[];
  composition: Record<PoolSource, number>;
}> {
  const TARGET = target;
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
  // Tracks the user manually compiled into their own playlists are the
  // strongest "I genuinely chose this" signal Spotify exposes — far stronger
  // than any algorithmic top list. Best-effort: skip silently on scope error.
  try {
    const playlistTracks = await fetchOwnPlaylistTracks();
    tag(playlistTracks, "playlist");
  } catch {
    // 403 = old token without playlist-read-private scope; user re-auth fixes.
  }

  // ---------- Layer 2 — medium_term top (last 6 months) ----------
  // Best "current favorites" signal — recent enough to reflect actual taste,
  // long enough to require sustained listening to register. Admitted in full
  // unconditionally.
  const mediumTerm = await spotifyFetch<{ items: SpotifyTrack[] }>(
    "/me/top/tracks?time_range=medium_term&limit=50"
  );
  tag(mediumTerm.items, "medium_term");

  // ---------- Layer 3 — long_term top (all-time) ----------
  // Spotify's long_term top 50 is the strongest "this person actually likes
  // this song" list we can pull. Admitted in full unconditionally, even if
  // the pool is already above target — final trim happens at the end and
  // prefers to drop short_term/genre_fill before long_term.
  const longTerm = await spotifyFetch<{ items: SpotifyTrack[] }>(
    "/me/top/tracks?time_range=long_term&limit=50"
  );
  tag(longTerm.items, "long_term");

  // ---------- Layer 4 — short_term top (last 4 weeks) ----------
  // Only fill from short_term if the pool is short of target. Short_term
  // entries that already overlap with playlist/medium/long are already in
  // the pool with their stronger source tag (tag() won't re-admit them).
  // Spotify orders /me/top/tracks by descending listening volume, so when
  // we DO need to fill, the top entries are the ones the user leaned into.
  if (out.length < TARGET) {
    const shortTerm = await spotifyFetch<{ items: SpotifyTrack[] }>(
      "/me/top/tracks?time_range=short_term&limit=50"
    );
    tag(shortTerm.items, "short_term");
  }

  // ---------- Layer 5 — genre fill (last-resort backstop) ----------
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
  // Defense-in-depth: even though `parseGroupParams` and `takePendingImport`
  // both validate IDs upstream, this is the single chokepoint that builds
  // a Spotify URL from them. Filtering here means a future caller can't
  // accidentally let unchecked input flow into the API path.
  const valid = ids.filter((s) => /^[A-Za-z0-9]{22}$/.test(s));
  const out: SpotifyTrack[] = [];
  for (let i = 0; i < valid.length; i += 50) {
    const chunk = valid.slice(i, i + 50);
    const res = await spotifyFetch<{ tracks: Array<SpotifyTrack | null> }>(
      `/tracks?ids=${chunk.join(",")}`
    );
    for (const t of res.tracks ?? []) {
      if (t && t.id) out.push(t);
    }
  }
  return out;
}

export type PlaylistSummary = {
  id: string;
  name: string;
  trackCount: number;
  imageUrl: string | null;
  ownerName: string;
  isOwn: boolean;
  collaborative: boolean;
};

/** All playlists the current user owns or follows, paginated until exhausted.
 *  Used by the "import a playlist" UI on the pool page — the user picks one
 *  and bulk-adds its tracks to the candidate pool to down-select from. */
export async function listMyPlaylists(): Promise<PlaylistSummary[]> {
  const me = await spotifyFetch<{ id: string }>("/me");
  const out: PlaylistSummary[] = [];
  let url: string | null = "/me/playlists?limit=50";
  // Spotify caps each page at 50; loop on `next` until null. Hard ceiling at
  // 1000 to avoid runaway loops on absurdly large libraries.
  for (let safety = 0; url && safety < 20; safety++) {
    type Page = {
      items: Array<{
        id: string;
        name: string;
        collaborative: boolean;
        owner: { id: string; display_name?: string | null };
        tracks: { total: number };
        images: Array<{ url: string }> | null;
      }>;
      next: string | null;
    };
    // After page 1 the `next` URL is absolute (https://api.spotify.com/v1/...).
    // Strip the API prefix so spotifyFetch's relative-path contract holds.
    const path = url.startsWith("http") ? url.replace(/^https?:\/\/api\.spotify\.com\/v1/, "") : url;
    const page: Page = await spotifyFetch<Page>(path);
    for (const p of page.items ?? []) {
      if (!p || !p.id) continue;
      out.push({
        id: p.id,
        name: p.name,
        trackCount: p.tracks?.total ?? 0,
        imageUrl: p.images?.[0]?.url ?? null,
        ownerName: p.owner?.display_name ?? "—",
        isOwn: p.owner?.id === me.id,
        collaborative: !!p.collaborative,
      });
    }
    url = page.next;
  }
  return out;
}

/** All tracks in a playlist, paginated. Skips locally-owned files and
 *  episode (podcast) entries — only Spotify-track entries are returned. */
export async function playlistTracks(playlistId: string): Promise<SpotifyTrack[]> {
  const fields =
    "items(track(id,name,uri,duration_ms,artists(id,name),album(id,name,images),is_local,type)),next";
  const out: SpotifyTrack[] = [];
  let url: string | null =
    `/playlists/${playlistId}/tracks?limit=100&fields=${encodeURIComponent(fields)}`;
  // Hard ceiling at 50 pages × 100 = 5000 tracks. Spotify allows up to 10,000
  // per playlist but pulling that many would also blow the pool-build budget.
  for (let safety = 0; url && safety < 50; safety++) {
    type Page = {
      items: Array<{
        track:
          | (SpotifyTrack & { is_local?: boolean; type?: string })
          | null;
      }>;
      next: string | null;
    };
    const path = url.startsWith("http") ? url.replace(/^https?:\/\/api\.spotify\.com\/v1/, "") : url;
    const page: Page = await spotifyFetch<Page>(path);
    for (const item of page.items ?? []) {
      const t = item?.track;
      if (!t || !t.id) continue;
      if (t.is_local) continue; // local files have no streamable Spotify URI
      if (t.type && t.type !== "track") continue; // episodes / shows
      out.push(t);
    }
    url = page.next;
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
