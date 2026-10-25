// scripts/ship.mjs — the one way to deploy by hand: clean tree, verify, push
// main, wait until it is live. Template from the app-conventions skill.
// GitHub Actions does the deploy; this only watches for the result.
import { execSync, spawnSync } from "node:child_process";

const sh = (c) => execSync(c, { encoding: "utf8" }).trim();
if (sh("git status --porcelain")) {
  console.log(sh("git status --short"));
  console.log("SHIP: FAIL (commit first; the tree has changes)");
  process.exit(1);
}
const run = (cmd) => spawnSync(cmd, { shell: true, stdio: "inherit" }).status === 0;
if (!run("npm run verify")) { console.log("SHIP: FAIL (verify)"); process.exit(1); }
if (!run("git push origin HEAD:main")) { console.log("SHIP: FAIL (push)"); process.exit(1); }
process.exit(run("npm run live -- --wait") ? 0 : 1);
