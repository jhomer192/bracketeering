// Spotify Embed Iframe API wrapper for in-bracket previews.
//
// Why not the `preview_url` field on tracks? Spotify deprecated it in
// late 2024 — most tracks now return `preview_url: null`, so the old
// HTML5 <audio> path silently broke for the majority of songs.
//
// The Iframe API wraps Spotify's official embed player. It works for
// every track in Spotify's catalog (no preview_url dependency), plays
// 30-sec previews for free users, and full tracks for Premium users.
// Compliance bonus: the embed itself is the "prominent display" Spotify
// requires when using their content.
//
// Singleton because the API is global (`window.onSpotifyIframeApiReady`)
// and we only ever need one player on the page at a time.

type EmbedController = {
  loadUri: (uri: string) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  destroy: () => void;
  addListener: (event: string, cb: (e: { data: PlaybackUpdate }) => void) => void;
};

type PlaybackUpdate = {
  isPaused: boolean;
  isBuffering: boolean;
  duration: number;
  position: number;
};

type IFrameAPI = {
  createController: (
    element: HTMLElement,
    options: { uri?: string; width?: string | number; height?: string | number },
    callback: (controller: EmbedController) => void,
  ) => void;
};

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: IFrameAPI) => void;
    __spotifyIframeApi?: IFrameAPI;
  }
}

let apiPromise: Promise<IFrameAPI> | null = null;

/** Load `https://open.spotify.com/embed/iframe-api/v1` once and cache the
 *  resolved API on `window` so subsequent loads are instant. */
function loadIframeApi(): Promise<IFrameAPI> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.__spotifyIframeApi) {
      resolve(window.__spotifyIframeApi);
      return;
    }
    window.onSpotifyIframeApiReady = (api) => {
      window.__spotifyIframeApi = api;
      resolve(api);
    };
    const s = document.createElement("script");
    s.src = "https://open.spotify.com/embed/iframe-api/v1";
    s.async = true;
    s.onerror = () => reject(new Error("Failed to load Spotify iframe API"));
    document.head.appendChild(s);
  });
  return apiPromise;
}

export type PreviewState = {
  /** Spotify URI currently loaded (e.g. spotify:track:abc) — null if nothing. */
  uri: string | null;
  /** True when audio is actually playing (not paused, not buffering). */
  playing: boolean;
};

type Listener = (state: PreviewState) => void;

class SpotifyPreviewPlayer {
  private controller: EmbedController | null = null;
  private initPromise: Promise<void> | null = null;
  private currentUri: string | null = null;
  private listeners = new Set<Listener>();
  private lastState: PreviewState = { uri: null, playing: false };
  // A user can click "play" before the iframe API script finishes loading.
  // Stash the requested URI and replay it once the controller arrives, so
  // the first click never silently no-ops on a slow connection.
  private pendingUri: string | null = null;

  /** Mount the iframe inside `host`. Idempotent. */
  init(host: HTMLElement): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = loadIframeApi().then(
      (api) =>
        new Promise<void>((resolve) => {
          api.createController(
            host,
            { width: "100%", height: 80 },
            (c) => {
              this.controller = c;
              c.addListener("playback_update", (e) => {
                const d = e.data;
                // Only emit a change when something user-visible flips,
                // so React re-renders stay quiet during scrub-tick spam.
                const playing = !d.isPaused && !d.isBuffering;
                if (
                  playing !== this.lastState.playing ||
                  this.currentUri !== this.lastState.uri
                ) {
                  this.lastState = { uri: this.currentUri, playing };
                  this.emit();
                }
              });
              // Drain any click that landed before the controller existed.
              if (this.pendingUri) {
                const u = this.pendingUri;
                this.pendingUri = null;
                this.play(u);
              }
              resolve();
            },
          );
        }),
    );
    return this.initPromise;
  }

  /** Play `uri` (e.g. "spotify:track:abc"). If already playing same URI,
   *  this is a no-op. If a different URI is playing, swap. If the iframe
   *  API hasn't finished loading yet, queue the request — init() drains it. */
  async play(uri: string) {
    if (!this.controller) {
      this.pendingUri = uri;
      return;
    }
    if (this.currentUri === uri) {
      this.controller.play();
      return;
    }
    this.currentUri = uri;
    this.controller.loadUri(uri);
    // `loadUri` returns immediately but the embed needs a tick before
    // play() actually starts. The iframe handles the queue internally,
    // so calling play() right after almost always works — no setTimeout.
    this.controller.play();
    this.lastState = { uri, playing: false }; // optimistic; real state via listener
    this.emit();
  }

  pause() {
    this.controller?.pause();
  }

  /** Subscribe to state changes. Returns an unsubscribe fn. */
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.lastState);
    return () => {
      this.listeners.delete(cb);
    };
  }

  state(): PreviewState {
    return this.lastState;
  }

  destroy() {
    this.controller?.destroy();
    this.controller = null;
    this.initPromise = null;
    this.currentUri = null;
    this.listeners.clear();
    this.lastState = { uri: null, playing: false };
  }

  private emit() {
    for (const l of this.listeners) l(this.lastState);
  }
}

let singleton: SpotifyPreviewPlayer | null = null;

export function getPreviewPlayer(): SpotifyPreviewPlayer {
  if (!singleton) singleton = new SpotifyPreviewPlayer();
  return singleton;
}

/** Build a Spotify URI from a bare track ID. */
export function trackUri(id: string): string {
  return `spotify:track:${id}`;
}
