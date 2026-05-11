import { describe, it, expect, beforeEach } from "vitest";
import { runStartupMigrations } from "./migrations";

beforeEach(() => {
  localStorage.clear();
});

describe("runStartupMigrations", () => {
  it("renames every bracketeering.* key to songrank.*", () => {
    localStorage.setItem("bracketeering.access_token", "tok");
    localStorage.setItem("bracketeering.ranked", JSON.stringify([{ id: "a" }]));
    localStorage.setItem("bracketeering.preview.v3", "{}");
    localStorage.setItem("songrank.unrelated", "leave-me");

    runStartupMigrations();

    expect(localStorage.getItem("songrank.access_token")).toBe("tok");
    expect(localStorage.getItem("songrank.ranked")).toBe(
      JSON.stringify([{ id: "a" }]),
    );
    expect(localStorage.getItem("songrank.preview.v3")).toBe("{}");
    expect(localStorage.getItem("songrank.unrelated")).toBe("leave-me");
    expect(localStorage.getItem("bracketeering.access_token")).toBeNull();
    expect(localStorage.getItem("bracketeering.ranked")).toBeNull();
    expect(localStorage.getItem("bracketeering.preview.v3")).toBeNull();
  });

  it("is idempotent — running twice doesn't clobber post-migration writes", () => {
    localStorage.setItem("bracketeering.ranked", "old-value");
    runStartupMigrations();
    // User does something that writes the new key.
    localStorage.setItem("songrank.ranked", "new-value");

    // Even if we re-ran the migration (e.g. fresh tab opens that somehow
    // still has both keys), it must not overwrite the new value.
    localStorage.setItem("bracketeering.ranked", "stale-old-value");
    runStartupMigrations();

    expect(localStorage.getItem("songrank.ranked")).toBe("new-value");
  });

  it("prefers an existing new-key over an old-key on conflict", () => {
    // Multi-tab edge case: tab A migrates and writes songrank.kept. Tab B
    // (which never migrated) writes bracketeering.kept again. When tab B
    // eventually reloads, the new key already exists and is more recent.
    localStorage.setItem("bracketeering.kept", "stale-from-tab-b");
    localStorage.setItem("songrank.kept", "fresh-from-tab-a");

    runStartupMigrations();

    expect(localStorage.getItem("songrank.kept")).toBe("fresh-from-tab-a");
    expect(localStorage.getItem("bracketeering.kept")).toBeNull();
  });

  it("sets a sentinel so subsequent calls early-exit", () => {
    runStartupMigrations();
    const sentinel = localStorage.getItem("songrank.migrations.v1.run");
    expect(sentinel).not.toBeNull();

    // Add a new old-prefix key after the migration ran — the sentinel
    // should prevent it from being migrated (otherwise we'd never settle).
    localStorage.setItem("bracketeering.late_write", "x");
    runStartupMigrations();
    expect(localStorage.getItem("bracketeering.late_write")).toBe("x");
    expect(localStorage.getItem("songrank.late_write")).toBeNull();
  });
});
