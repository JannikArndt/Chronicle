// Renders public/icon.svg into the PNG icons a home screen asks for:
// apple-touch-icon.png (iOS reads only that name and PNG, never an SVG) and
// the 192/512 pair the web app manifest lists for Android.
//
//   CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/app-icons.mjs
//
// The PNGs are committed; run this again after changing the SVG.

import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const SOURCE = "public/icon.svg";
const OUTPUTS = {
  "public/apple-touch-icon.png": 180,
  "public/icon-192.png": 192,
  "public/icon-512.png": 512,
};

const svg = readFileSync(SOURCE, "utf8");
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chrome" },
);
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [path, size] of Object.entries(OUTPUTS)) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><body style="margin:0">${svg.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body>`,
  );
  await page.screenshot({ path, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`${path} ${size}×${size}`);
}
await browser.close();
