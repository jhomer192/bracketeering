# Bracketeering

Vote "this or that" on 128 of your songs. Walk away with a real top 10 — and Spotify playlists that prove it.

## What's working today

- Spotify OAuth (auth code flow with refresh)
- Seed pool builder (Layer 1 recent + Layer 2 all-time + Layer 3 genre fill)
- 128-track sub-in grid (mobile-first, source-coded album-art tiles)
- Supabase wired (using shared side-projects DB, tables to be namespaced `bracketeering_*`)

## Not built yet

- Search-to-add on sub-in screen
- Comparison engine (Beli-style binary insertion with rank-10 floor)
- Reveal screen
- Playlist export + auto cover art
- Bracket export image
- Predict-my-top-10 share link

## Setup

```bash
cp .env.example .env.local
# Fill SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET (see below)
# SUPABASE_* and SESSION_PASSWORD already set if running locally on Jack's VPS
npm install
npm run dev
```

### Spotify Developer App

1. Go to <https://developer.spotify.com/dashboard>
2. Create app → name "Bracketeering"
3. Redirect URIs: add `http://localhost:3000/api/spotify/callback` for dev,
   plus the Vercel preview/prod URLs once deployed
4. Copy Client ID + Client Secret into `.env.local`

### Supabase

Uses the shared side-projects database. All tables prefixed with
`bracketeering_`. No schema required yet — the sub-in MVP runs on session-only state.

## Tech

- Next.js 16 (App Router, Turbopack)
- TypeScript, Tailwind v4
- Spotify Web API (typed `fetch` wrappers in `src/lib/spotify.ts`, no SDK)
- iron-session for encrypted-cookie session
- Supabase for persistence (when comparison engine lands)
- `sharp` for auto cover-art composition

## Routes

| Path | What |
|---|---|
| `/` | Landing — "Connect Spotify" |
| `/api/spotify/login` | Begin OAuth flow |
| `/api/spotify/callback` | Token exchange |
| `/api/pool` | Build the 128-track candidate pool (auth required) |
| `/pool` | Sub-in screen — review the 128, drop what you don't want |

## Local dev

```bash
npm run dev
# open http://localhost:3000
```

First Spotify connect builds the pool in ~5 sec. After that it's instant.
