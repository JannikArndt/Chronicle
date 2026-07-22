/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base is the GitHub Pages project path — the remote repo is named
// "Chronicle" (https://<user>.github.io/Chronicle/), even though the local
// folder is called Timeline.
export default defineConfig({
  base: "/Chronicle/",
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
