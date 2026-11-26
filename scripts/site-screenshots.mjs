// Screenshots of the real app for the product page (site/), taken from a
// fictional demo life so no real person's data is ever in the repo.
//
//   npm run build && node scripts/site-screenshots.mjs
//
// Starts the built server on a scratch database, drives Chromium through each
// scene, and writes site/img/*.png. CHROMIUM_PATH picks the browser binary;
// without it, the locally installed Chrome is used.

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8795;
const BASE = `http://localhost:${PORT}`;
const OUT = "site/img";

const utc = (year, month = 1, day = 1) => Date.UTC(year, month - 1, day);
const date = (ms, precision = "month", extra = {}) => ({ ms, precision, ...extra });

// ---------- the demo life: Mara, her family, and the world ----------

let order = 0;
const nextOrder = () => order++;

function demoDataset() {
  const groups = [
    { id: "g-mara", label: "Mara", icon: "🧭", birthDate: utc(1990, 4, 12), collapsed: false, order: nextOrder() },
    { id: "g-family", label: "Family", icon: "🏡", collapsed: false, order: nextOrder() },
    { id: "g-henrik", parentGroupId: "g-family", label: "Henrik (Dad)", icon: "⛵", birthDate: utc(1958, 2, 3), collapsed: false, order: 0 },
    { id: "g-ingrid", parentGroupId: "g-family", label: "Ingrid (Mom)", icon: "📚", birthDate: utc(1961, 9, 21), collapsed: false, order: 1 },
  ];
  const rows = [
    { id: "r-places", groupId: "g-mara", label: "Places lived", icon: "🏠", color: "#8ba66f", order: 0 },
    { id: "r-education", groupId: "g-mara", label: "Education", icon: "🎓", color: "#7c6aa6", order: 1 },
    { id: "r-work", groupId: "g-mara", label: "Work", icon: "💼", color: "#4f6fa8", order: 2 },
    { id: "r-love", groupId: "g-mara", label: "Relationships", icon: "❤️", color: "#a8433b", order: 3 },
    { id: "r-running", groupId: "g-mara", label: "Running", icon: "🏃", color: "#3f7d54", order: 4 },
    { id: "r-henrik-work", groupId: "g-henrik", label: "Work", icon: "🔧", color: "#4f6fa8", order: 0 },
    { id: "r-henrik-sailing", groupId: "g-henrik", label: "Sailing", icon: "⛵", color: "#3b82a0", order: 1 },
    { id: "r-ingrid-work", groupId: "g-ingrid", label: "Work", icon: "🍎", color: "#b45309", order: 0 },
    { id: "r-ole", groupId: "g-family", label: "Ole (brother)", icon: "🎸", color: "#8a7a2f", birthDate: utc(1993, 7, 30), order: 2 },
  ];
  const place = (city, country) => ({ fullName: `${city}, ${country}`, city, country });
  const entries = [
    { id: "e-hamburg", rowId: "r-places", title: "Hamburg", place: place("Hamburg", "Germany"), start: date(utc(1990, 4, 12), "day"), end: date(utc(2008, 8), "month") },
    { id: "e-utrecht", rowId: "r-places", title: "Utrecht", place: place("Utrecht", "Netherlands"), start: date(utc(2008, 9)), end: date(utc(2012, 7)) },
    { id: "e-berlin", rowId: "r-places", title: "Berlin", place: place("Berlin", "Germany"), start: date(utc(2012, 8)), end: date(utc(2019, 2)) },
    { id: "e-lisbon", rowId: "r-places", title: "Lisbon", place: place("Lisbon", "Portugal"), start: date(utc(2019, 3)), description: "The flat with the yellow tiles." },
    { id: "e-school", rowId: "r-education", title: "School", start: date(utc(1996, 8), "year"), end: date(utc(2008, 6), "year") },
    { id: "e-bsc", rowId: "r-education", title: "BSc Psychology", subtitle: "Utrecht University", start: date(utc(2008, 9)), end: date(utc(2011, 7)) },
    { id: "e-msc", rowId: "r-education", title: "MSc Human–Computer Interaction", shortTitle: "MSc HCI", start: date(utc(2012, 10)), end: date(utc(2014, 9)) },
    { id: "e-barista", rowId: "r-work", title: "Barista", subtitle: "Café on the Oudegracht", start: date(utc(2009, 6), "circa"), end: date(utc(2011, 6), "circa") },
    { id: "e-northwind", rowId: "r-work", title: "UX Researcher", subtitle: "Northwind Labs", start: date(utc(2014, 10)), end: date(utc(2019, 2)) },
    { id: "e-fjord", rowId: "r-work", title: "Design Lead", subtitle: "Fjord & Co.", start: date(utc(2019, 4)) },
    { id: "e-jonas", rowId: "r-love", title: "Jonas", start: date(utc(2010, 5)), end: date(utc(2016, 1)), fadeOutDays: 150 },
    { id: "e-elena", rowId: "r-love", title: "Elena", start: date(utc(2018, 6)), fadeInDays: 90, description: "Met at a friend's rooftop party. She beat me at chess." },
    { id: "e-club", rowId: "r-running", title: "Running club", start: date(utc(2015, 3), "year") },
    { id: "e-apprentice", rowId: "r-henrik-work", title: "Shipbuilding apprenticeship", shortTitle: "Apprenticeship", start: date(utc(1974, 8), "year"), end: date(utc(1978, 6), "year") },
    { id: "e-engineer", rowId: "r-henrik-work", title: "Marine engineer", subtitle: "Hamburg harbour", start: date(utc(1978, 9), "year"), end: date(utc(2021, 3)) },
    { id: "e-sailing", rowId: "r-henrik-sailing", title: "Sailing club", start: date(utc(1970, 6), "circa") },
    { id: "e-training", rowId: "r-ingrid-work", title: "Teacher training", start: date(utc(1981, 10), "year"), end: date(utc(1986, 7), "year") },
    { id: "e-teacher", rowId: "r-ingrid-work", title: "Teacher, Gymnasium", start: date(utc(1986, 8), "year"), end: date(utc(2024, 7)) },
    { id: "e-ole-hamburg", rowId: "r-ole", title: "Hamburg", start: date(utc(1993, 7, 30), "day"), end: date(utc(2012, 8)) },
    { id: "e-ole-cph", rowId: "r-ole", title: "Copenhagen", start: date(utc(2012, 9)) },
  ];
  const events = [
    { id: "v-keys", rowId: "r-places", title: "Got the keys", icon: "🔑", date: date(utc(2019, 3, 2), "day") },
    { id: "v-wedding", rowId: "r-love", title: "Married Elena", icon: "💍", date: date(utc(2022, 9, 17), "day") },
    { id: "v-marathon", rowId: "r-running", title: "First marathon", icon: "🏅", date: date(utc(2016, 10, 9), "day") },
    { id: "v-pb", rowId: "r-running", title: "Berlin Marathon PB", icon: "⏱️", date: date(utc(2018, 9, 16), "day") },
  ];
  return { schemaVersion: 11, groups, rows, entries, events, selfGroupId: "g-mara" };
}

// ---------- the browser and the server ----------

const dataDir = mkdtempSync(join(tmpdir(), "chronicle-site-"));
const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "dist-server/main.mjs"], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, TRUST_PROXY: "false" },
  stdio: ["ignore", "inherit", "inherit"],
});
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${BASE}/version`)).ok) break;
  } catch {
    // not up yet
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chrome" },
);
mkdirSync(OUT, { recursive: true });

async function open({ width = 1440, height = 860, scale = 1, dark = false, locale = "en-US" } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: dark ? "dark" : "light",
    locale,
    isMobile: width < 600,
    hasTouch: width < 600,
  });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => window.__chronicleStore?.getState().loaded === true);
  return page;
}

async function closeOnboarding(page) {
  if ((await page.locator(".assistant-overlay").count()) > 0) await page.keyboard.press("Escape");
}

async function loadDemo(page, { world = true } = {}) {
  await closeOnboarding(page);
  await page.evaluate(
    ({ dataset, world }) => {
      window.__chronicleActions.replaceDataset(dataset);
      if (world) window.__chronicleActions.toggleWorldEvents("iphone-releases");
    },
    { dataset: demoDataset(), world },
  );
  await page.waitForTimeout(300);
}

async function frame(page, from, to) {
  await page.evaluate(([a, b]) => window.__chronicleEngine.zoomToRange(a, b), [from, to]);
  await page.waitForTimeout(250);
}

const shot = (page, name, options = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...options });

try {
  // The whole life, light and dark.
  for (const dark of [false, true]) {
    const page = await open({ dark });
    await loadDemo(page);
    await frame(page, utc(1952), utc(2030));
    await shot(page, dark ? "hero-dark" : "hero");
    await page.context().close();
  }

  // Zoomed in: fuzzy dates, moments, the detail panel.
  {
    const page = await open();
    await loadDemo(page);
    await frame(page, utc(2014, 6), utc(2023, 6));
    await page.evaluate(() => window.__chronicleActions.selectEntry("e-elena"));
    await page.waitForTimeout(300);
    await shot(page, "detail");
    await page.context().close();
  }

  // The phone.
  {
    const page = await open({ width: 390, height: 844, scale: 2 });
    await loadDemo(page);
    await frame(page, utc(1985), utc(2026));
    await shot(page, "mobile");
    await page.context().close();
  }

  // The setup assistant a new visitor meets, a few answers in: places lived,
  // then school and after, with the live preview drawing both.
  {
    // German locale: Mara grew up in Hamburg, so the school chips are German.
    const page = await open({ width: 1180, height: 780, scale: 2, locale: "de-DE" });
    await page.waitForSelector(".assistant-overlay input");
    await page.keyboard.type("Mara");
    await page.keyboard.press("Enter");
    await page.getByRole("slider", { name: "Age" }).fill("36");
    await page.locator(".onboarding-go").click();
    for (const city of ["Hamburg", "Utrecht", "Berlin", "Lisbon"]) {
      await page.locator(".seq-add input").fill(city);
      await page.locator(".seq-add input").press("Enter");
    }
    await page.locator(".onboarding-go").click();
    for (const chip of ["Grundschule", "Gymnasium", "Bachelor", "Gap", "Master"]) {
      await page.locator(".seq-chip", { hasText: chip }).first().click();
    }
    await page.waitForTimeout(400);
    await page.locator(".assistant-overlay > *").first().screenshot({ path: `${OUT}/onboarding.png` });
    await page.context().close();
  }

  // Creating an account: passkey first.
  {
    const page = await open({ width: 1180, height: 700, scale: 2 });
    await closeOnboarding(page);
    await page.click("button.account-button");
    await page.fill('input[name="username"]', "mara");
    await page.fill('input[name="name"]', "Mara");
    await page.locator(".account-popover").screenshot({ path: `${OUT}/passkey.png` });
    await page.context().close();
  }

  // Sharing with Dad, live: he has one of his entries open while Mara looks
  // at the same one and at who can edit his group.
  {
    const mara = await open();
    await loadDemo(mara);
    // Signing up adopts the timelines already on the device.
    await mara.click("button.account-button");
    await mara.click("text=Use a password instead");
    await mara.fill('input[name="username"]', "mara");
    await mara.fill('input[name="name"]', "Mara");
    await mara.fill('input[name="password"]', "demo password");
    await mara.click('button[type="submit"]');
    await mara.waitForFunction(() => {
      const sync = window.__chronicleStore.getState().sync;
      return sync.status === "online" && sync.pending === 0;
    });
    await mara.click(".popover-backdrop");
    const ids = await mara.evaluate(() => {
      const d = window.__chronicleStore.getState().dataset;
      return {
        henrik: d.groups.find((g) => g.label === "Henrik (Dad)").id,
        engineer: d.entries.find((e) => e.title === "Marine engineer").id,
      };
    });
    const token = await mara.evaluate(async (henrik) => {
      const response = await fetch("/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json", "x-chronicle": "1" },
        body: JSON.stringify({ subject: { kind: "group", id: henrik }, role: "editor" }),
      });
      return (await response.json()).token;
    }, ids.henrik);

    // Henrik opens the invite, makes an account in the same card, accepts.
    const henrik = await open({ width: 1280, height: 800 });
    await henrik.goto(`${BASE}/#/invite/${token}`);
    await henrik.reload();
    await henrik.waitForSelector(".invite-landing input[name=username]");
    await henrik.click("text=Use a password instead");
    await henrik.fill('input[name="username"]', "henrik");
    await henrik.fill('input[name="name"]', "Henrik");
    await henrik.fill('input[name="password"]', "demo password");
    await henrik.click('button[type="submit"]');
    await henrik.waitForSelector("text=Go to my timelines");
    await henrik.click("text=Go to my timelines");
    await henrik.waitForFunction((id) => window.__chronicleStore.getState().dataset.entries.some((e) => e.id === id), ids.engineer);
    await henrik.evaluate((id) => window.__chronicleActions.selectEntry(id), ids.engineer);

    await frame(mara, utc(1952), utc(2030));
    await mara.evaluate((id) => window.__chronicleActions.selectEntry(id), ids.engineer);
    await mara.waitForSelector(".presence-chip");
    const group = mara.locator(`[data-rail-kind="group"][data-rail-id="${ids.henrik}"]`);
    await group.hover();
    await group.locator('button[title^="Group settings"]').click();
    await mara.click("text=Share…");
    await mara.waitForTimeout(400);
    await shot(mara, "sharing");
    await henrik.context().close();
    await mara.context().close();
  }
} finally {
  await browser.close();
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(`screenshots written to ${OUT}/`);
