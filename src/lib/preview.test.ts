import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resolvePreviewUrl } from "./preview";
import {
  loveHangoverJennie,
  itunesLoveHangoverResponse,
  itunesEmptyResponse,
} from "./__fixtures__/spotify-tracks";

// Stub a fetch response. Keeps tests synchronous to set up and easy to
// assert on the calls made (URL, query terms).
function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      statusText: ok ? "OK" : "Error",
    }),
  );
}

beforeEach(() => {
  // Fresh localStorage and fetch mock per test — preview.ts caches both
  // in localStorage AND in a module-level inflight Map. localStorage is
  // owned by happy-dom so we just clear it. The inflight Map clears
  // itself in `finally`, so each test starting from a clean fetch mock
  // gives us a clean lookup.
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolvePreviewUrl — Love Hangover by JENNIE", () => {
  const { id, name } = loveHangoverJennie;
  const primaryArtist = loveHangoverJennie.artists[0].name; // "JENNIE"

  it("returns the iTunes preview URL for a known track", async () => {
    mockFetchOnce(itunesLoveHangoverResponse);

    const result = await resolvePreviewUrl(id, name, primaryArtist);

    expect(result).toEqual({
      url: itunesLoveHangoverResponse.results[0].previewUrl,
      definitive: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("queries iTunes with '{primary artist} {track name}' on the first pass", async () => {
    mockFetchOnce(itunesLoveHangoverResponse);

    await resolvePreviewUrl(id, name, primaryArtist);

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    // URL-encoded "JENNIE Love Hangover (feat. Dominic Fike)".
    expect(calledUrl).toContain("itunes.apple.com/search");
    expect(calledUrl).toContain(
      encodeURIComponent(`${primaryArtist} ${name}`),
    );
    // limit=1 keeps the call cheap and the response small. limit is also
    // load-bearing for ranking — iTunes orders results by relevance, so the
    // first hit is the best match for "{artist} {track}".
    expect(calledUrl).toContain("limit=1");
    expect(calledUrl).toContain("entity=song");
  });

  it("caches a definitive hit so a second lookup hits localStorage, not iTunes", async () => {
    mockFetchOnce(itunesLoveHangoverResponse);

    const first = await resolvePreviewUrl(id, name, primaryArtist);
    const second = await resolvePreviewUrl(id, name, primaryArtist);

    expect(first).toEqual(second);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to a track-name-only query when the artist-joined query misses", async () => {
    // iTunes returns 0 results for "JENNIE Love Hangover (feat. Dominic
    // Fike)" — e.g. because the parenthesized featured-artist string trips
    // up the search ranker. Fallback should retry with just the track name.
    mockFetchOnce(itunesEmptyResponse);
    mockFetchOnce(itunesLoveHangoverResponse);

    const result = await resolvePreviewUrl(id, name, primaryArtist);

    expect(result.definitive).toBe(true);
    expect(result.url).toBe(itunesLoveHangoverResponse.results[0].previewUrl);
    expect(fetch).toHaveBeenCalledTimes(2);

    const secondUrl = vi.mocked(fetch).mock.calls[1][0] as string;
    // Fallback drops the artist — just "{track name}".
    expect(secondUrl).toContain(encodeURIComponent(name));
    expect(secondUrl).not.toContain(encodeURIComponent(primaryArtist));
  });

  it("returns definitive:false on transient HTTP errors so the caller can retry", async () => {
    // A 503 / rate-limit response is exactly what poisoned the v1 cache:
    // every track that happened to hit one had its play button greyed
    // out for 30 days. Now we return non-definitive and leave the cache
    // untouched.
    mockFetchOnce({}, false, 503);
    mockFetchOnce({}, false, 503);

    const result = await resolvePreviewUrl(id, name, primaryArtist);

    expect(result).toEqual({ url: null, definitive: false });
    // Both calls fired (primary + fallback), both transient, no cache write.
    expect(fetch).toHaveBeenCalledTimes(2);

    // Verify no cache entry was written — a second call should fire fetch
    // again rather than returning a cached null.
    mockFetchOnce(itunesLoveHangoverResponse);
    const retry = await resolvePreviewUrl(id, name, primaryArtist);
    expect(retry.definitive).toBe(true);
    expect(retry.url).toBe(itunesLoveHangoverResponse.results[0].previewUrl);
  });

  it("returns definitive:true with null when iTunes truly has no match for the track", async () => {
    // Both the artist-joined query AND the track-name-only fallback come
    // back empty. That's a definitive "no preview available" — the compare
    // page should disable the play button.
    mockFetchOnce(itunesEmptyResponse);
    mockFetchOnce(itunesEmptyResponse);

    const result = await resolvePreviewUrl(id, name, primaryArtist);

    expect(result).toEqual({ url: null, definitive: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("survives network exceptions (DNS, CORS, offline) without poisoning the cache", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const result = await resolvePreviewUrl(id, name, primaryArtist);

    expect(result).toEqual({ url: null, definitive: false });

    // Cache is clean — a retry with a good response should resolve normally.
    mockFetchOnce(itunesLoveHangoverResponse);
    const retry = await resolvePreviewUrl(id, name, primaryArtist);
    expect(retry).toEqual({
      url: itunesLoveHangoverResponse.results[0].previewUrl,
      definitive: true,
    });
  });

  it("dedupes parallel lookups for the same track ID into one iTunes call", async () => {
    // Two cards rendering the same matchup (or strict-mode double effect)
    // should not double-bill iTunes.
    mockFetchOnce(itunesLoveHangoverResponse);

    const [a, b] = await Promise.all([
      resolvePreviewUrl(id, name, primaryArtist),
      resolvePreviewUrl(id, name, primaryArtist),
    ]);

    expect(a).toEqual(b);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
