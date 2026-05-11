import { defineConfig } from "vitest/config";
import path from "node:path";

// happy-dom (rather than jsdom) because preview.ts feature-detects `window`
// and uses localStorage — node-only doesn't exercise the cache path.
export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
