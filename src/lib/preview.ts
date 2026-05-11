// 30-second song previews via iTunes Search API + <audio>.
//
// Why not Spotify? Two failed approaches we burned weeks on:
//   1. `preview_url` on the Spotify track object — deprecated late 2024,
//      most tracks now return null. Half the bracket had silent cards.
//   2. Spotify Iframe Embed API — works on desktop, flaky on iOS Safari
//      because user-gesture activation doesn't transfer through the
//      postMessage boundary into a cross-origin iframe. play() silently
//      no-ops without an error to surface.
//
// iTunes Search API is the workaround everyone in the music-app world
// quietly migrated to:
//   - CORS-enabled (reflects Origin), no auth required
//   - Returns `previewUrl` (30-sec m4a/aac) for ~every commercial track
//   - Plays in <audio> — gesture rules are the standard ones, no iframe
//     postMessage indirection
//
// We resolve by "{artist} {track}" search. False matches are possible on
// remixes / covers but rare enough to ignore for a personal-top-N tool.
// Cached in localStorage by Spotify track ID with a 30-day TTL so the
// second pass through a song is instant.

type CacheEntry = { url: string | null; ts: number };
const CACHE_KEY = "bracketeering.preview.v1";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function loadCache(): Record<string, CacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CacheEntry>) : {};
  } catch {
    return {};
  }
}

function saveCache(c: Record<string, CacheEntry>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    // QuotaExceeded — non-fatal. We'll just resolve again next time.
  }
}

function cacheGet(trackId: string): string | null | undefined {
  const c = loadCache();
  const e = c[trackId];
  if (!e) return undefined;
  if (Date.now() - e.ts > CACHE_TTL_MS) return undefined;
  return e.url;
}

function cacheSet(trackId: string, url: string | null) {
  const c = loadCache();
  c[trackId] = { url, ts: Date.now() };
  saveCache(c);
}

// In-memory dedupe so two cards rendering the same matchup don't fire
// two parallel iTunes requests for the same track.
const inflight = new Map<string, Promise<string | null>>();

/** Resolve a Spotify track to an iTunes preview URL. Returns null if iTunes
 *  has no match. Cached in localStorage; deduped in memory. */
export async function resolvePreviewUrl(
  trackId: string,
  trackName: string,
  artistName: string,
): Promise<string | null> {
  const cached = cacheGet(trackId);
  if (cached !== undefined) return cached;
  const existing = inflight.get(trackId);
  if (existing) return existing;

  const p = (async (): Promise<string | null> => {
    const term = encodeURIComponent(`${artistName} ${trackName}`);
    const url = `https://itunes.apple.com/search?term=${term}&entity=song&limit=1&media=music`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        cacheSet(trackId, null);
        return null;
      }
      const data = (await res.json()) as {
        results?: Array<{ previewUrl?: string }>;
      };
      const previewUrl = data.results?.[0]?.previewUrl ?? null;
      cacheSet(trackId, previewUrl);
      return previewUrl;
    } catch {
      // Transient (network blip, DNS) — don't poison the cache; retry next time.
      return null;
    } finally {
      inflight.delete(trackId);
    }
  })();
  inflight.set(trackId, p);
  return p;
}

export type PreviewState = {
  /** Spotify track ID currently active in the player (loading or playing). */
  trackId: string | null;
  /** True when audio is actively playing (not paused, not loading). */
  playing: boolean;
  /** True while waiting for the audio buffer to be ready. */
  loading: boolean;
};

type Listener = (state: PreviewState) => void;

class PreviewPlayer {
  private audio: HTMLAudioElement | null = null;
  private listeners = new Set<Listener>();
  private state: PreviewState = { trackId: null, playing: false, loading: false };

  /** Lazy-create the singleton <audio> element. Called on first play so we
   *  never instantiate a media element during SSR / before user intent. */
  private ensureAudio(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const a = new Audio();
    a.preload = "none";
    // `crossOrigin` is intentionally unset — iTunes preview CDN doesn't
    // need cross-origin reads (no canvas/MediaSource), so opting in just
    // adds an Origin header that could trigger weird caching paths.
    a.addEventListener("playing", () => this.patch({ playing: true, loading: false }));
    a.addEventListener("pause", () => this.patch({ playing: false }));
    a.addEventListener("ended", () => this.patch({ playing: false, trackId: null }));
    a.addEventListener("error", () => this.patch({ playing: false, loading: false, trackId: null }));
    a.addEventListener("waiting", () => this.patch({ loading: true }));
    this.audio = a;
    return a;
  }

  /** Play a resolved preview URL for `trackId`. MUST be called synchronously
   *  inside a user gesture handler — iOS Safari rejects audio.play() otherwise. */
  play(trackId: string, previewUrl: string): Promise<void> {
    const audio = this.ensureAudio();
    if (this.state.trackId === trackId && !audio.paused) {
      // Same track already playing — tap-to-pause.
      audio.pause();
      return Promise.resolve();
    }
    if (this.state.trackId === trackId && audio.paused) {
      // Same track, paused — resume.
      return audio.play().catch(() => {
        this.patch({ playing: false, trackId: null });
      });
    }
    // Different track (or first play) — swap src and start.
    // Critical: src assignment + play() happen in the same synchronous
    // tick as the user click, preserving gesture activation on iOS.
    audio.src = previewUrl;
    this.patch({ trackId, playing: false, loading: true });
    return audio.play().catch(() => {
      this.patch({ playing: false, loading: false, trackId: null });
    });
  }

  pause() {
    this.audio?.pause();
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    this.patch({ trackId: null, playing: false, loading: false });
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.state);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private patch(p: Partial<PreviewState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l(this.state);
  }
}

let singleton: PreviewPlayer | null = null;
export function getPreviewPlayer(): PreviewPlayer {
  if (!singleton) singleton = new PreviewPlayer();
  return singleton;
}
