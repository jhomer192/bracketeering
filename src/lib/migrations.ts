// One-time client-side migrations run on app load.
//
// Today there's just one: rename every `bracketeering.*` localStorage key to
// `songrank.*` so users who built brackets before the 2026-05-11 rename
// don't lose their state. The app keeps a `songrank.migrations.v1.run`
// sentinel so we never run this twice — the second run would clobber any
// post-rename writes back over the old keys.

const SENTINEL_KEY = "songrank.migrations.v1.run";
const OLD_PREFIX = "bracketeering.";
const NEW_PREFIX = "songrank.";

export function runStartupMigrations(): void {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(SENTINEL_KEY)) return;
    // Snapshot keys first — renaming while iterating localStorage is
    // implementation-defined (Chrome/Safari behave differently).
    const oldKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(OLD_PREFIX)) oldKeys.push(k);
    }
    for (const oldKey of oldKeys) {
      const newKey = NEW_PREFIX + oldKey.slice(OLD_PREFIX.length);
      // Don't clobber if the user already has the new key (e.g. they
      // opened a new tab post-rename before the old tab migrated).
      if (localStorage.getItem(newKey) !== null) {
        localStorage.removeItem(oldKey);
        continue;
      }
      const v = localStorage.getItem(oldKey);
      if (v !== null) localStorage.setItem(newKey, v);
      localStorage.removeItem(oldKey);
    }
    localStorage.setItem(SENTINEL_KEY, String(Date.now()));
  } catch {
    // Storage quota / private mode / etc. — non-fatal, the app degrades
    // to a fresh-state experience instead of crashing.
  }
}
