// scripts/verify.mjs — what CI runs, with only what needs reading printed.
// Template from the app-conventions skill.
//   node scripts/verify.mjs            all steps
//   node scripts/verify.mjs test lint  some of them
// Every step runs even when an earlier one fails, so one call says
// everything. The last line is `VERIFY: PASS` or `VERIFY: FAIL (<steps>)`.
//
// ADAPT STEPS: the npm scripts (or commands) CI's verify job relies on.
// Never name `verify` itself here.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// build = tsc -b (typechecks the tests too) + vite build + the server bundle.
// contract = the deploy conventions (Dockerfile vs build id, pins, docs).
const STEPS = {
  contract: "node --test test/deploy-contract.test.mjs",
  test: "npm test --silent",
  build: "npm run --silent build",
};

const pkg = existsSync("package.json") ? JSON.parse(readFileSync("package.json", "utf8")) : { scripts: {} };
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(STEPS);
// A step without its npm script is skipped (and said), unless STEPS gives a command.
const steps = wanted.filter((s) => pkg.scripts?.[s] || (STEPS[s] && !STEPS[s].startsWith("npm")) || (console.log(`- ${s} (no script)`), false));

const failed = [];
for (const step of steps) {
  const started = Date.now();
  const r = spawnSync(STEPS[step] || `npm run --silent ${step}`, { shell: true, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (r.status === 0) { console.log(`✓ ${step} (${secs} s)`); continue; }
  failed.push(step);
  console.log(`✗ ${step} (${secs} s)`);
  const out = `${r.stdout}\n${r.stderr}`.split("\n");
  // For node --test: the failing tests' blocks only; otherwise the tail.
  const notOk = out.flatMap((l, i) => (/^\s*not ok /.test(l) ? out.slice(i, i + 25) : []));
  console.log((notOk.length ? notOk : out.slice(-40)).join("\n").trim());
}
console.log(failed.length ? `VERIFY: FAIL (${failed.join(" ")})` : "VERIFY: PASS");
process.exit(failed.length ? 1 : 0);
