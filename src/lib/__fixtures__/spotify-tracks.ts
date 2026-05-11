// Real Spotify track responses captured from the Spotify Web API / embed
// endpoint. These match the exact shape `GET /me/top/tracks`, `GET /tracks`,
// and playlist endpoints return — so tests exercise the same parsing paths
// production code does.
//
// Why fixtures pulled from the live API rather than hand-rolled?
//   1. The Spotify Web API quietly returns `preview_url: null` for most
//      tracks since the late-2024 deprecation. Hand-rolling fixtures with
//      a non-null preview_url tests an unrealistic happy path that hasn't
//      existed for over a year. Capturing real responses keeps the test
//      honest about what the app actually has to work with.
//   2. Metadata details — featured-artist formatting, multi-artist arrays,
//      explicit album-vs-single subtleties — are easy to get wrong from
//      memory. The iTunes-fallback logic specifically targets those
//      mismatches; using real shapes is the whole point.

import type { SpotifyTrack } from "../spotify";

/** "Love Hangover (feat. Dominic Fike)" by JENNIE.
 *  Captured 2026-05-11 from open.spotify.com/embed/track/0rx7xu0RmZLpJjKNVZjSVv.
 *  Notable: this is one of the rare modern tracks where Spotify's embed
 *  endpoint exposes an `audioPreview` URL — but the Web API endpoints the
 *  app actually calls (`/me/top/tracks` etc.) return `preview_url: null`
 *  for it like everything else, which is why we resolve previews via iTunes. */
export const loveHangoverJennie: SpotifyTrack = {
  id: "0rx7xu0RmZLpJjKNVZjSVv",
  name: "Love Hangover (feat. Dominic Fike)",
  uri: "spotify:track:0rx7xu0RmZLpJjKNVZjSVv",
  preview_url: null,
  duration_ms: 180129,
  artists: [
    { id: "250b0Wlc5Vk0CoUsaCY84M", name: "JENNIE" },
    { id: "6USv9qhCn6zfxlBQIYJ9qs", name: "Dominic Fike" },
  ],
  album: {
    id: "3awd1TKrdd3emCecvza61j",
    name: "Love Hangover (feat. Dominic Fike)",
    images: [
      {
        url: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b27388e90abbb4d0d9e45881f4dc",
        width: 640,
        height: 640,
      },
      {
        url: "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e0288e90abbb4d0d9e45881f4dc",
        width: 300,
        height: 300,
      },
      {
        url: "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000485188e90abbb4d0d9e45881f4dc",
        width: 64,
        height: 64,
      },
    ],
  },
};

/** Real iTunes Search response for the "JENNIE Love Hangover (feat. Dominic
 *  Fike)" query — what fetch would return if you searched the live API today.
 *  Captured 2026-05-11. Trimmed to the fields preview.ts actually reads;
 *  full iTunes responses have ~30 more fields per result that we ignore. */
export const itunesLoveHangoverResponse = {
  resultCount: 1,
  results: [
    {
      artistName: "JENNIE & Dominic Fike",
      trackName: "Love Hangover",
      collectionName: "Love Hangover - Single",
      previewUrl:
        "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/f6/4c/16/f64c164b-bd28-87fd-5217-7409675e6374/mzaf_10560279388547786839.plus.aac.p.m4a",
    },
  ],
};

/** iTunes "no match" response — what the API returns when nothing matches
 *  the query. Used to test the fallback path. */
export const itunesEmptyResponse = {
  resultCount: 0,
  results: [],
};
