# Songrank

Vote "this or that" on 128 of your songs. Walk away with a ranked top 10 — and Spotify playlists that prove it.

**Live**: <https://jhomer192.github.io/bracketeering/>

> The deploy path is still `/bracketeering` because each user's Spotify
> dev app has the old redirect URI registered. Renaming the GitHub repo
> would require every user to add a new redirect URI before next login —
> sticky for now.

## How it works

Songrank is a static SPA. There is no backend. The OAuth flow is
**Authorization Code with PKCE** — you paste your own Spotify Client ID
once, and every Spotify call goes browser → `api.spotify.com` directly,
authed with your own access token. Nothing about your account, your music,
or your keys ever leaves your browser.

**Why BYO Client ID?** Spotify caps each developer app at 5 friends. So
each user creates their own free dev app — 90-second one-time setup —
and Songrank uses it. No shared cap.

## What's working today

- PKCE OAuth (no client_secret anywhere)
- Seed pool builder (Layer 1 recent + Layer 2 all-time + Layer 3 genre fill)
- 128-track sub-in grid (mobile-first, source-coded album-art tiles)
- Beli-style comparison engine — binary insertion with a top-25 floor
  (~370 votes for a 128-track pool, vs ~900 for full sort). Run state
  persists in localStorage, so refresh / close-the-tab is fine.
- Reveal screen — top 10 ranked, expand to top 25
- Playlist export — creates "My Top 10" + "My Top 25" playlists in your
  Spotify, each with composed-mosaic cover art (2×2 / 3×3, JPEG ≤256KB,
  drawn in-browser via `<canvas>`)
- Search-to-add on sub-in screen — both single-track search and full
  playlist import (paginated, dedupes by name+artist)
- Per-tier shareable image cards — 1080×1920 PNG of any tier (Top 10/25/
  50/100/128) as a numbered list or dense mosaic
- **Single-image bracket export** — 1080×1920 PNG of the top 16 (or top 8
  for shallower pools) drawn as a seeded bracket, with connector lines
  and a champion badge. (Bracket-as-visualization, not bracket-as-algorithm
  — the ranker uses binary insertion, not single-elim.)
- **Predict-my-top-10** — share a `/predict/?t=…` link with a friend; they
  see your top 10 in shuffled order, drag to guess, get a score (0–100%
  blend of pair-order correctness and exact-rank hits). No Spotify auth
  required on the recipient side; metadata loads via Spotify oEmbed.
- **30-sec audio previews** — resolved via iTunes Search API (Spotify's
  `preview_url` field is mostly null since late 2024, and their iframe
  embed has unfixable iOS gesture bugs). Plays through `<audio>`, cached
  in localStorage.
- Group brackets — 2-4 friends each contribute a slice of the pool; last
  person ranks the merged result

## Not built yet

(Nothing on the public roadmap — file an issue if you want something.)

## Local dev

```bash
npm install
npm run dev
# open http://127.0.0.1:3000 (Spotify OAuth requires 127.0.0.1, not localhost)
```

For local dev your redirect URI in your Spotify dev app should be
`http://127.0.0.1:3000/callback/`. For prod (GitHub Pages) it's
`https://jhomer192.github.io/bracketeering/callback/`. Each Spotify dev
app can register multiple redirect URIs — add both.

## Tech

- Next.js 16 with `output: 'export'` (static SPA)
- TypeScript, Tailwind v4
- Spotify Web API via typed `fetch` wrappers in `src/lib/spotify.ts`
- iTunes Search API for 30-sec previews (`src/lib/preview.ts`)
- Web Crypto for PKCE (no node crypto, no shims)
- localStorage for client_id + tokens, sessionStorage for the in-flight verifier

## Routes (all static)

| Path | What |
|---|---|
| `/` | Landing |
| `/setup` | One-time: paste Client ID |
| `/callback` | PKCE token exchange |
| `/pool` | Sub-in screen — review the 128, drop what you don't want |
| `/compare` | This-or-that voting (~370 taps for a full pool) |
| `/reveal` | Top 10 ranking + Save to Spotify |
| `/predict` | Public — friend guesses your top 10, gets a score (no auth) |

## Deploy

GitHub Actions (`.github/workflows/pages.yml`) builds on every push to
`main` and deploys to GitHub Pages. The `NEXT_PUBLIC_BASE_PATH` env var
is set to `/bracketeering` in CI so links resolve under the repo path.
