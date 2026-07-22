/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base is the GitHub Pages project path (https://<user>.github.io/Timeline/).
export default defineConfig({
  base: "/Timeline/",
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
