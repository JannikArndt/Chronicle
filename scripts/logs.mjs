// scripts/logs.mjs — the running container's recent log, via the CapRover
// API (CapRover keeps only the current container's). Read-only.
// Needs CAPROVER_URL and CAPROVER_PASSWORD (admin; never in git, never a
// GitHub secret). Template from the app-conventions skill.
//   node scripts/logs.mjs [lines=80] [app=chronicle]
const [lines = "80", app = "chronicle"] = process.argv.slice(2);
const { CAPROVER_URL, CAPROVER_PASSWORD } = process.env;
if (!CAPROVER_URL || !CAPROVER_PASSWORD) { console.error("Set CAPROVER_URL and CAPROVER_PASSWORD."); process.exit(1); }
const base = `${CAPROVER_URL.replace(/\/$/, "")}/api/v2`;
async function call(path, method = "GET", body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", "x-namespace": "captain", ...(token ? { "x-captain-auth": token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  if (j.status !== 100 && j.status !== 101) throw new Error(`${path}: ${j.description}`);
  return j.data;
}
const { token } = await call("/login", "POST", { password: CAPROVER_PASSWORD });
const { logs } = await call(`/user/apps/appData/${encodeURIComponent(app)}/logs`, "GET", null, token);
// Docker prefixes every frame with an 8-byte header (stream, 0, 0, 0, size).
const clean = String(logs).replace(/[\u0000-\u0002]\u0000\u0000\u0000[\s\S]{4}/g, "");
console.log(clean.trimEnd().split("\n").slice(-Number(lines)).join("\n"));
