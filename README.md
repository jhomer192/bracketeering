# Bracketeering

Vote "this or that" on 128 of your songs. Walk away with a real top 10 — and Spotify playlists that prove it.

**Live**: <https://jhomer192.github.io/bracketeering/>

## How it works

Bracketeering is a static SPA. There is no backend. The OAuth flow is
**Authorization Code with PKCE** — you paste your own Spotify Client ID
once, and every Spotify call goes browser → `api.spotify.com` directly,
authed with your own access token. Nothing about your account, your music,
or your keys ever leaves your browser.

**Why BYO Client ID?** Spotify caps each developer app at 5 friends. So
each user creates their own free dev app — 90-second one-time setup —
and Bracketeering uses it. No shared cap.

## What's working today

- PKCE OAuth (no client_secret anywhere)
- Seed pool builder (Layer 1 recent + Layer 2 all-time + Layer 3 genre fill)
- 128-track sub-in grid (mobile-first, source-coded album-art tiles)

## Not built yet

- Search-to-add on sub-in screen
- Comparison engine (Beli-style binary insertion with rank-10 floor)
- Reveal screen
- Playlist export + auto cover art
- Bracket export image
- Predict-my-top-10 share link

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
- Web Crypto for PKCE (no node crypto, no shims)
- localStorage for client_id + tokens, sessionStorage for the in-flight verifier

## Routes (all static)

| Path | What |
|---|---|
| `/` | Landing |
| `/setup` | One-time: paste Client ID |
| `/callback` | PKCE token exchange |
| `/pool` | Sub-in screen — review the 128, drop what you don't want |

## Deploy

GitHub Actions (`.github/workflows/pages.yml`) builds on every push to
`main` and deploys to GitHub Pages. The `NEXT_PUBLIC_BASE_PATH` env var
is set to `/bracketeering` in CI so links resolve under the repo path.
