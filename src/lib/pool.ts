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
// Emergency: editorial popular tracks (Spotify Today's Top Hits
// playlist). Triggers when the four primary signals can't fill the pool.
// (We don't fall back to the saved library — a save without any other
// signal just means "I clicked the heart once," not "this is a favorite."
// Anything genuinely loved enough to be saved AND played AND/OR curated
// onto a playlist will already be admitted via top_tracks or playlist
// frequency. Pure-save signals are noise.)
//
// Album diversity cap, gated by playlist corroboration:
//   - If the album has ANY track in ANY of the user's own playlists, cap
//     at 3. They've curated from it — singles + a deep cut is reasonable.
//   - If nothing from the album appears in any playlist, cap at 1. The
//     album only shows up because of raw listening volume (top_tracks
//     ranks every song from an album played end-to-end), which is a
//     binge signal, not a curation signal.
// Net effect: a current-rotation album with no playlist presence
// contributes ONE track to the bracket — its strongest — instead of
// flooding it with deep cuts the user hasn't actually endorsed.

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

// (Constant retained for back-compat with older cached pools whose
// entries are tagged saved_early; no new admits use this source.)
//
// Per-album admit caps. Two tiers based on playlist corroboration:
//   - CORROBORATED: at least one track from this album appears in one of
//     the user's own playlists. They've explicitly curated something from
//     it — bigger cap is justified ("singles + a deep cut").
//   - UNCORROBORATED: nothing from this album in any playlist. The album
//     only shows up because of raw listening volume (top_tracks ranks
//     every song from an album played end-to-end). Treat as 1-vote
//     signal: surface the strongest track, drop the rest as binge noise.
//
// Concretely: a current-rotation album you've played end-to-end but
// haven't yet added anything to a playlist from contributes ONE track to
// the bracket, not its entire tracklist.
const ALBUM_CAP_CORROBORATED = 3;
const ALBUM_CAP_UNCORROBORATED = 1;

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
  const albumCount = new Map<string, number>(); // by album ID, for cap enforcement
  const out: PoolEntry[] = [];

  // Filled after the playlist scan returns. Albums not in this set are
  // treated as uncorroborated — listening-binge artifacts — and capped
  // harder.
  let corroboratedAlbumIds: Set<string> = new Set();

  // Admit every track in `tracks` (subject to dedup + album cap + TARGET
  // ceiling), tagged with `source`. Caller controls volume by slicing
  // `tracks` before passing. The dedup check makes this a no-op for tracks
  // already in the pool from a stronger signal. The album cap is global —
  // tracks beyond the per-album quota are silently skipped regardless of
  // signal strength.
  const admit = (tracks: SpotifyTrack[], source: PoolSource): number => {
    let admitted = 0;
    for (const t of tracks) {
      if (out.length >= TARGET) break;
      if (!t || !t.id || seen.has(t.id)) continue;
      const key = trackKey(t);
      if (seenKey.has(key)) continue;
      const albumId = t.album?.id;
      if (albumId) {
        const cap = corroboratedAlbumIds.has(albumId)
          ? ALBUM_CAP_CORROBORATED
          : ALBUM_CAP_UNCORROBORATED;
        const count = albumCount.get(albumId) ?? 0;
        if (count >= cap) continue;
        albumCount.set(albumId, count + 1);
      }
      seen.add(t.id);
      seenKey.add(key);
      out.push({ ...t, source });
      admitted += 1;
    }
    return admitted;
  };

  // Pre-fetch the four signals in parallel — they're independent and each
  // costs 1-9 API calls. Doing them upfront avoids per-pass round-trips.
  const [longTermRes, mediumTermRes, shortTermRes, playlistScan] = await Promise.all([
    spotifyFetch<{ items: SpotifyTrack[] }>(
      "/me/top/tracks?time_range=long_term&limit=50"
    ).catch(() => ({ items: [] as SpotifyTrack[] })),
    spotifyFetch<{ items: SpotifyTrack[] }>(
      "/me/top/tracks?time_range=medium_term&limit=50"
    ).catch(() => ({ items: [] as SpotifyTrack[] })),
    spotifyFetch<{ items: SpotifyTrack[] }>(
      "/me/top/tracks?time_range=short_term&limit=50"
    ).catch(() => ({ items: [] as SpotifyTrack[] })),
    // playlist cross-frequency + album corroboration. Catch errors so a
    // 403 (missing scope) doesn't kill the whole build.
    crossPlaylistFrequency().catch(() => ({
      tracks: [] as SpotifyTrack[],
      albumIds: new Set<string>(),
    })),
  ]);
  const longTerm = longTermRes.items ?? [];
  const mediumTerm = mediumTermRes.items ?? [];
  const shortTerm = shortTermRes.items ?? [];
  const playlistFreqList = playlistScan.tracks;
  corroboratedAlbumIds = playlistScan.albumIds;

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

  // Emergency: editorial popular fallback. Only fires when top_tracks +
  // playlist signal couldn't fill the pool — effectively brand-new
  // accounts with thin listening history. We deliberately skip the saved
  // library here: a bare save is "I clicked the heart once," not a
  // favorite, and surfacing arbitrary saved tracks dilutes the bracket
  // with songs the user has neither played nor curated.
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

/** Rank the user's own playlists' tracks by cross-playlist appearance count,
 *  and return the set of album IDs that appear ANYWHERE in those playlists.
 *
 *  A track that appears in 7 of your playlists has been "voted for" 7 times
 *  by you — much stronger curation signal than appearing in just one. The
 *  primary return — `tracks` — is sorted by descending appearance count,
 *  filtered to those that appear in at least `playlistThreshold(playlistCount)`
 *  of them. The threshold scales with the user's playlist count (25% of
 *  total, floor 2) so the filter means the same thing for a 4-playlist user
 *  and a 40-playlist user. Ties ordered by Spotify's playlist insertion
 *  order — stable, not random.
 *
 *  The secondary return — `albumIds` — is every album that has ANY track
 *  in ANY of the user's owned playlists (no threshold). Used as a
 *  corroboration signal for the per-album admit cap: an album the user
 *  has curated from gets the higher cap; a pure listening-binge album
 *  gets the lower one.
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
async function crossPlaylistFrequency(): Promise<{
  tracks: SpotifyTrack[];
  albumIds: Set<string>;
}> {
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
  const albumIds = new Set<string>();
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
          // Record album corroboration BEFORE the per-playlist dedup —
          // the same album appearing twice in one playlist still proves
          // the user has curated from it.
          if (t.album?.id) albumIds.add(t.album.id);
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
  const tracks = [...byKey.values()]
    .filter((e) => e.count >= threshold)
    .sort((a, b) => b.count - a.count || a.firstSeenOrder - b.firstSeenOrder)
    .map((e) => e.track);
  return { tracks, albumIds };
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

