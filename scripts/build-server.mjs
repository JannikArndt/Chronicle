// Bundles server/main.ts (and the few src/ modules it shares with the
// client) into one dependency-free ES module, dist-server/main.mjs.
//
//   node scripts/build-server.mjs          build once
//   node scripts/build-server.mjs --watch  rebuild on change and restart the
//                                          server (npm run dev:server)

import { spawn } from "node:child_process";
import { build, context } from "esbuild";

const options = {
  entryPoints: ["server/main.ts"],
  outfile: "dist-server/main.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  logLevel: "info",
};

if (!process.argv.includes("--watch")) {
  await build(options);
} else {
  let child;
  const restart = () => {
    child?.kill();
    child = spawn(process.execPath, ["--enable-source-maps", "dist-server/main.mjs"], {
      stdio: "inherit",
      env: { PORT: "8787", DATA_DIR: ".data", TRUST_PROXY: "false", ...process.env },
    });
  };
  const ctx = await context({
    ...options,
    plugins: [{ name: "restart", setup: (b) => b.onEnd((result) => result.errors.length === 0 && restart()) }],
  });
  await ctx.watch();
}
