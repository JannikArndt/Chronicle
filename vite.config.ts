/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from the root of its own origin (chronicle.timpanini.com) by the
// Chronicle server, which also answers /api. In `npm run dev` Vite serves the
// client and forwards /api and /version to `npm run dev:server` on :8787.
export default defineConfig({
  base: "/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: false },
      "/version": { target: "http://localhost:8787", changeOrigin: false },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
