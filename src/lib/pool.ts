// Build the 128-track candidate pool via a pass-based algorithm.
//
// Each pass takes a balanced slice from four signals:
//   - long_term top tracks      ← Spotify's all-time favorites
//   - medium_term top tracks    ← last 6 months
//   - short_term top tracks     ← last 4 weeks; capped at 5 forever
//   - playlist cross-frequency  ← songs in ≥25% of the user's own playlists
//                                  (auto-gen excluded), with a floor of 2.
//                                  Adding a song to a single playlist is
//                                  "I added this once," not "this is a
//                                  favorite." The percentage adapts: a
//                                  user with 4 playlists needs the song in
//                                  2+, a user with 40 needs it in 10+.
//
// Pass 1: 20 / 20 / 5 / 20    = up to 65 admits
// Pass 2: 40 / 40 / 5 / 40    = up to 125 cumulative
// Pass 3: 50 / 50 / 5 / 80    = up to 185 cumulative (Spotify maxes top
//                               tracks at 50 per window, so 50 is the
//                               ceiling on long/medium; playlist keeps
//                               expanding by appearance count)
// Pass 4: drain remaining playlist cross-frequency entries
//
// short_term stops growing after pass 1 because the 4-week window is
// noisy: a one-off "you have to hear this" play can crack top 50 of a
// small denominator. Top 5 is the only short_term cohort that requires
// real listening volume to occupy.
//
// Emergency: liked songs (saved library). Falls back here only if the
// four primary signals don't fill the pool.
//
// Absolute emergency: editorial popular tracks (Spotify Today's Top Hits
// playlist). Triggers when the user has fewer total played+saved tracks
// than the pool target — i.e. a brand-new account.
//
// Album diversity cap: at most 3 tracks per album across the entire pool.
// Spotify's /me/top/tracks ranks every song from an album played
// end-to-end, so a single beloved album can crack the top 50 with 10+
// tracks and dominate the bracket. Worse, the album-bloat eats slots the
// primary signals would have filled, forcing the saves-emergency to
// fire and bring in arbitrary "this one is liked" tracks. Capping at 3
// preserves the album's signal (it's clearly a favorite) while leaving
// room for breadth, AND keeps the emergency dormant.

import { spotifyFetch, type SpotifyTrack } from "./spotify";

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

// How many tracks to admit from each signal per pass. short_term is fixed
// at 5 across all passes (the top-5-only rule); long/medium are capped at
// Spotify's 50 max; playlist cross-frequency keeps growing until exhausted.
const PASS_QUOTAS = [
  { long: 20, medium: 20, short: 5, playlist: 20 },
  { long: 40, medium: 40, short: 5, playlist: 40 },
  { long: 50, medium: 50, short: 5, playlist: 80 },
] as const;

// Spotify editorial playlist used as the absolute-emergency fallback when
// the user has fewer played+saved tracks than the pool target.
// "Today's Top Hits" — a stable Spotify-owned playlist that always exists.
const TODAYS_TOP_HITS_PLAYLIST_ID = "37i9dQZF1DXcBWIGoYBM5M";

// Cross-playlist signal threshold. A track has to appear in a meaningful
// PORTION of the user's playlists to count — fixed thresholds break across
// user types (4-playlist user vs. 40-playlist user). We scale relative to
// the user's playlist count, with a strict floor of 2 because "cross-
// playlist" can't mean anything below 2 appearances.
//
//   threshold = max(2, ceil(playlistCount * 0.25))
//
// Examples:
//   3 playlists  → in 2+   (≥67%)   ← almost universal
//   4 playlists  → in 2+   (≥50%)
//   8 playlists  → in 2+   (≥25%)
//   12 playlists → in 3+   (≥25%)
//   20 playlists → in 5+   (≥25%)
//   50 playlists → in 13+  (≥26%)
//
// Picked 25% as the cutoff because below that, "appearance in one quarter
// of your playlists" stops feeling like curation and starts feeling like
// "this song is in my workout, road-trip, AND chill playlists" — which is
// exactly the cross-context signal we want.
const PLAYLIST_FRACTION_THRESHOLD = 0.25;
const MIN_PLAYLIST_APPEARANCES_FLOOR = 2;

// Max tracks per album across the entire pool. 3 is enough to capture a
// genuine album-favorite ("I love the singles AND a deep cut") without
// letting one album occupy 10+ of 128 slots. Applies to every source —
// long_term, medium_term, short_term, playlist, and saves — so the cap
// can't be circumvented by an album dominating one signal.
const ALBUM_CAP = 3;

function playlistThreshold(playlistCount: number): number {
  return Math.max(
    MIN_PLAYLIST_APPEARANCES_FLOOR,
    Math.ceil(playlistCount * PLAYLIST_FRACTION_THRESHOLD),
  );
}

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
  const albumCount = new Map<string, number>(); // by album ID, for ALBUM_CAP
  const out: PoolEntry[] = [];

  // Admit every track in `tracks` (subject to dedup + ALBUM_CAP + TARGET
  // ceiling), tagged with `source`. Caller controls volume by slicing
  // `tracks` before passing. The dedup check makes this a no-op for tracks
  // already in the pool from a stronger signal. The album cap is global —
  // tracks beyond the per-album quota are silently skipped regardless of
  // signal strength.
  const admit = (tracks: SpotifyTrack[], source: PoolSource): void => {
    for (const t of tracks) {
      if (out.length >= TARGET) break;
      if (!t || !t.id || seen.has(t.id)) continue;
      const key = trackKey(t);
      if (seenKey.has(key)) continue;
      const albumId = t.album?.id;
      if (albumId) {
        const count = albumCount.get(albumId) ?? 0;
        if (count >= ALBUM_CAP) continue;
        albumCount.set(albumId, count + 1);
      }
      seen.add(t.id);
      seenKey.add(key);
      out.push({ ...t, source });
    }
  };

  // Pre-fetch the four signals in parallel — they're independent and each
  // costs 1-9 API calls. Doing them upfront avoids per-pass round-trips.
  const [longTermRes, mediumTermRes, shortTermRes, playlistFreqList] = await Promise.all([
    spotifyFetch<{ items: SpotifyTrack[] }>(
      "/me/top/tracks?time_range=long_term&limit=50"
    ).catch(() => ({ items: [] as SpotifyTrack[] })),
    spotifyFetch<{ items: SpotifyTrack[] }>(
      "/me/top/tracks?time_range=medium_term&limit=50"
    ).catch(() => ({ items: [] as SpotifyTrack[] })),
    spotifyFetch<{ items: SpotifyTrack[] }>(
      "/me/top/tracks?time_range=short_term&limit=50"
    ).catch(() => ({ items: [] as SpotifyTrack[] })),
    // playlist cross-frequency: catch errors so a 403 (missing scope)
    // doesn't kill the whole build.
    crossPlaylistFrequency().catch(() => [] as SpotifyTrack[]),
  ]);
  const longTerm = longTermRes.items ?? [];
  const mediumTerm = mediumTermRes.items ?? [];
  const shortTerm = shortTermRes.items ?? [];

  // Per-signal position cursor: tracks how many positions from the source
  // list each pass has already consumed. Each pass slices [cursor, quota),
  // covering only NEW positions — so if a high-rank long_term track was
  // already admitted via playlist (dedup'd inside admit), we don't waste
  // work re-checking it in pass 2.
  const cursor = { long: 0, medium: 0, short: 0, playlist: 0 };

  for (const quota of PASS_QUOTAS) {
    if (out.length >= TARGET) break;
    admit(longTerm.slice(cursor.long, quota.long), "long_term");
    cursor.long = quota.long;
    if (out.length >= TARGET) break;
    admit(mediumTerm.slice(cursor.medium, quota.medium), "medium_term");
    cursor.medium = quota.medium;
    if (out.length >= TARGET) break;
    admit(shortTerm.slice(cursor.short, quota.short), "short_term");
    cursor.short = quota.short;
    if (out.length >= TARGET) break;
    admit(playlistFreqList.slice(cursor.playlist, quota.playlist), "playlist");
    cursor.playlist = quota.playlist;
  }

  // Drain any remaining cross-playlist entries we didn't reach in the
  // pass schedule. All entries here are already ≥3-playlist songs, so
  // they're still legitimate curation — just lower-ranked.
  if (out.length < TARGET && cursor.playlist < playlistFreqList.length) {
    admit(playlistFreqList.slice(cursor.playlist), "playlist");
  }

  // Emergency: liked songs. Only fires when the four primary signals
  // didn't fill the pool — e.g. a user with few playlists and limited
  // listening history. We pull saved library pages until the pool fills
  // or saves are exhausted.
  if (out.length < TARGET) {
    let offset = 0;
    while (out.length < TARGET && offset < 500) {
      const page = await spotifyFetch<{
        items: Array<{ track: SpotifyTrack | null }>;
        next: string | null;
      }>(`/me/tracks?limit=50&offset=${offset}`).catch(() => null);
      if (!page) break;
      const tracks = (page.items ?? [])
        .map((i) => i.track)
        .filter((t): t is SpotifyTrack => !!t && !!t.id);
      const before = out.length;
      admit(tracks, "saved_early");
      if (out.length === before && !page.next) break; // nothing new this page
      if (!page.next) break;
      offset += 50;
    }
  }

  // Absolute emergency: editorial popular fallback. Only fires when the
  // user's combined played + saved + playlist signal can't fill the pool
  // (effectively, brand-new accounts).
  if (out.length < TARGET) {
    try {
      const popular = await playlistTracks(TODAYS_TOP_HITS_PLAYLIST_ID);
      admit(popular, "genre_fill");
    } catch {
      // Best-effort — pool can run smaller than TARGET if even this fails.
    }
  }

  // Defensive: nothing above can overshoot because admit() respects
  // TARGET, but slice() makes that contract explicit.
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

/** Rank the user's own playlists' tracks by cross-playlist appearance count.
 *
 *  A track that appears in 7 of your playlists has been "voted for" 7 times
 *  by you — much stronger curation signal than appearing in just one. Returns
 *  tracks sorted by descending appearance count, filtered to those that
 *  appear in at least `playlistThreshold(playlistCount)` of them. The
 *  threshold scales with the user's playlist count (25% of total, floor 2)
 *  so the filter means the same thing for a 4-playlist user and a
 *  40-playlist user. Ties ordered by Spotify's playlist insertion order —
 *  stable, not random.
 *
 *  Excludes:
 *    - playlists owned by Spotify (Daily Mix, Discover Weekly, Release Radar,
 *      anything auto-generated) — filter via owner.id !== user.id
 *    - the implicit "Liked Songs" library (which doesn't appear in /me/playlists
 *      anyway, but defensively filtered by name)
 *
 *  Scans up to 50 of the user's owned playlists (one /me/playlists page).
 *  Per playlist, pulls up to 300 tracks across 3 pages. Errors on individual
 *  playlists are swallowed so one bad playlist doesn't break the signal.
 */
async function crossPlaylistFrequency(): Promise<SpotifyTrack[]> {
  const me = await spotifyFetch<{ id: string }>("/me");
  const list = await spotifyFetch<{
    items: Array<{ id: string; owner: { id: string }; name: string }>;
  }>("/me/playlists?limit=50");

  const own = (list.items ?? [])
    .filter((p) => p.owner.id === me.id)
    .filter((p) => !/^Liked Songs$/i.test(p.name));

  // Map track ID → { track, count }. Use ID as the primary key (cheap),
  // and use trackKey separately to merge cross-release duplicates so
  // "Pink Pony Club" (single) + "Pink Pony Club" (album) count together.
  type Entry = { track: SpotifyTrack; count: number; firstSeenOrder: number };
  const byKey = new Map<string, Entry>();
  let order = 0;

  const fields =
    "items(track(id,name,uri,duration_ms,artists(id,name),album(id,name,images))),next";

  // 3 pages × 100 = up to 300 tracks per playlist. Covers most playlists in
  // full; the rare 300+ track playlist gets its tail truncated. API budget
  // cap: 50 playlists × 3 pages = 150 calls worst-case.
  const PAGES_PER_PLAYLIST = 3;

  for (const pl of own) {
    const seenInPl = new Set<string>();
    let url: string | null =
      `/playlists/${pl.id}/tracks?limit=100&fields=${encodeURIComponent(fields)}`;
    for (let page = 0; page < PAGES_PER_PLAYLIST && url; page++) {
      try {
        type Page = {
          items: Array<{ track: SpotifyTrack | null }>;
          next: string | null;
        };
        const path = url.startsWith("http")
          ? url.replace(/^https?:\/\/api\.spotify\.com\/v1/, "")
          : url;
        const data: Page = await spotifyFetch<Page>(path);
        // De-dup within a single playlist before counting — a song listed
        // twice in the same playlist is one "vote," not two.
        for (const item of data.items ?? []) {
          const t = item.track;
          if (!t || !t.id) continue;
          const key = trackKey(t);
          if (seenInPl.has(key)) continue;
          seenInPl.add(key);
          const existing = byKey.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            byKey.set(key, { track: t, count: 1, firstSeenOrder: order++ });
          }
        }
        url = data.next;
      } catch {
        // One playlist failure shouldn't poison the signal.
        break;
      }
    }
  }

  const threshold = playlistThreshold(own.length);
  return [...byKey.values()]
    .filter((e) => e.count >= threshold)
    .sort((a, b) => b.count - a.count || a.firstSeenOrder - b.firstSeenOrder)
    .map((e) => e.track);
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

