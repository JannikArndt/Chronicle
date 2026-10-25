// test/deploy-contract.test.mjs — the deploy conventions, as tests.
// Template from the app-conventions skill. Fails when the Dockerfile ships
// something the build id does not hash, when a pin floats, when a workflow
// runs without permissions or a timeout, when a command is undocumented.
// Delete a block only if the repo has no such thing (e.g. no Dockerfile on
// GitHub Pages) — never to get green.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const has = (p) => existsSync(join(ROOT, p));

if (has("Dockerfile")) {
  const { INPUTS } = await import("../server/buildid.mjs");
  const docker = read("Dockerfile");
  const present = INPUTS.filter(has).sort();

  test("the Dockerfile copies exactly what the build id hashes", () => {
    // Only COPY lines from the build context (not --from=<stage>).
    const copied = [...docker.matchAll(/^COPY (?!--from)(.+)$/gm)]
      .flatMap(([, args]) => args.trim().split(/\s+/).slice(0, -1))
      .map((s) => s.replace(/\/$/, ""));
    assert.deepEqual([...new Set(copied)].sort(), present);
  });

  test("nothing the build id hashes is excluded by .dockerignore", () => {
    if (!has(".dockerignore")) return;
    const rules = read(".dockerignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    for (const input of present) {
      for (const rule of rules) {
        const re = new RegExp("^" + rule.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "(/|$)");
        assert.ok(!re.test(input), `.dockerignore rule "${rule}" excludes ${input}, which the build id hashes`);
      }
    }
  });

  test("the image is pinned, stamped, unprivileged and health-checked", () => {
    for (const [, ref] of docker.matchAll(/^FROM (\S+)/gm)) assert.match(ref, /@sha256:[0-9a-f]{64}$/, `FROM ${ref} is not pinned by digest`);
    assert.match(docker, /buildid\.mjs > (dist-server\/)?BUILD_ID/, "the image does not stamp BUILD_ID");
    // Either USER <non-root>, or an entrypoint that drops to node after
    // fixing the volume's ownership (docker-entrypoint.sh).
    const dropsPrivileges = /^ENTRYPOINT .*docker-entrypoint\.sh/m.test(docker) && has("docker-entrypoint.sh") && /su-exec node|setpriv --reuid=node/.test(read("docker-entrypoint.sh"));
    assert.ok(/^USER (?!root)\S+/m.test(docker) || dropsPrivileges, "the container runs as root");
    assert.match(docker, /^HEALTHCHECK /m, "no HEALTHCHECK");
  });
}

if (has("Dockerfile")) {
  test("/version reports package.json's version, and the image carries package.json", () => {
    // npm_package_version is unset under plain `node`; it once left /version at a stale constant.
    assert.ok(!read("server/main.ts").includes("process.env.npm_package_version"), "server/main.ts reads process.env.npm_package_version");
    assert.match(read("Dockerfile"), /^COPY --from=build \/app\/package\.json /m, "the runtime image has no package.json");
  });
}

const workflows = has(".github/workflows") ? readdirSync(join(ROOT, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f)) : [];

test("every action is pinned to a commit SHA with its version as a comment", () => {
  for (const f of workflows) {
    for (const [line, ref] of read(`.github/workflows/${f}`).matchAll(/uses:\s*(\S+)(.*)$/gm)) {
      if (ref.startsWith("./")) continue;
      assert.match(line, /@[0-9a-f]{40}\s+#\s*v\d/, `${f}: ${ref.trim()} is not pinned to a SHA with a # vX comment`);
    }
  }
});

test("every workflow declares permissions and every job a timeout", () => {
  for (const f of workflows) {
    const y = read(`.github/workflows/${f}`);
    assert.match(y, /^permissions:/m, `${f} has no top-level permissions`);
    const jobs = y.split(/^jobs:\s*$/m)[1] || "";
    const names = [...jobs.matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]);
    for (const name of names) {
      const body = jobs.split(new RegExp(`^ {2}${name}:\\s*$`, "m"))[1].split(/^ {2}[\w-]+:\s*$/m)[0];
      assert.match(body, /timeout-minutes:/, `${f}: job ${name} has no timeout-minutes`);
    }
  }
});

test("CLAUDE.md exists and names every npm script", () => {
  assert.ok(has("CLAUDE.md"), "CLAUDE.md is missing");
  if (!has("package.json")) return;
  const claude = read("CLAUDE.md");
  const scripts = Object.keys(JSON.parse(read("package.json")).scripts || {});
  for (const s of ["verify", "live", "ship"]) assert.ok(scripts.includes(s), `package.json has no "${s}" script`);
  for (const s of scripts) assert.match(claude, new RegExp(`npm (run )?${s}\\b`), `CLAUDE.md does not mention npm run ${s}`);
});
