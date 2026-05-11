"use client";

import { useEffect } from "react";
import { runStartupMigrations } from "@/lib/migrations";

/** Mounted once at the root layout. Runs synchronous client-only setup —
 *  today just the localStorage rename from `bracketeering.*` → `songrank.*`.
 *  Kept as a component (not a layout call) so it runs in the client, not
 *  during SSR where `localStorage` is undefined. */
export default function ClientStartup() {
  useEffect(() => {
    runStartupMigrations();
  }, []);
  return null;
}
