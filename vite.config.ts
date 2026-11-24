import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";

// In dev the app and the API share one origin through this proxy, as they do in production.
const core = process.env.CORE_URL ?? "http://127.0.0.1:8791";
const proxy = Object.fromEntries(
  ["/v1", "/oauth", "/mcp", "/.well-known", "/c"].map((p) => [p, { target: core, changeOrigin: false }]),
);

export default defineConfig({
  plugins: [preact()],
  server: { port: 8792, strictPort: true, host: "127.0.0.1", proxy },
  build: { target: "es2022", sourcemap: false },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
