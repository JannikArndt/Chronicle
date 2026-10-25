// scripts/live.mjs — is this tree's build what the live app serves?
// Template from the app-conventions skill.
//   node scripts/live.mjs                 answers now (exit 1 if not)
//   node scripts/live.mjs --wait          polls every 5 s, up to 10 min
//   node scripts/live.mjs --url <base>    another host (dev, a custom domain)
// Last line: `LIVE: <build>` or `NOT LIVE: want <a>, <url> serves <b>`.
//
// ADAPT: DEFAULT_URL; want() if the build id is not server/buildid.mjs
// (Pages without a build: the VERSION in sw.js, fetched from <url>/sw.js).
import { buildId } from "../server/buildid.mjs";

const DEFAULT_URL = "https://chronicle.timpanini.com";
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const base = (arg("--url") || process.env.APP_URL || DEFAULT_URL).replace(/\/$/, "");
const wait = process.argv.includes("--wait");
const want = buildId();
const started = Date.now();

async function served() {
  try {
    const res = await fetch(`${base}/version`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const body = await res.json().catch(() => ({}));
    return body.build || `HTTP ${res.status}`;
  } catch (err) {
    return err.cause?.code || err.name;
  }
}

let last = "";
for (;;) {
  const got = await served();
  if (got === want) { console.log(`LIVE: ${want}`); process.exit(0); }
  const secs = Math.round((Date.now() - started) / 1000);
  if (!wait || secs > 600) { console.log(`NOT LIVE: want ${want}, ${base} serves ${got}`); process.exit(1); }
  if (got !== last) { console.log(`  ${secs} s: ${base} serves ${got}`); last = got; }
  await new Promise((r) => setTimeout(r, 5000));
}
