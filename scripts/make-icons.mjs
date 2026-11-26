// Draws the Home Screen icons: four parallel bars of different lengths and
// offsets on one shared axis, which is the whole app. PNG, no dependencies.
// Run: node scripts/make-icons.mjs   (the PNGs are committed; see CLAUDE.md)
//
// Why PNG: iOS takes `apple-touch-icon` for "Add to Home Screen", Apple
// documents it as PNG, and it wins over the manifest's icons.
// Why full-bleed and opaque: iOS rounds the corners itself.
// Why a separate maskable icon: Android keeps only the middle 80 %.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = "public/icons";
// :root tokens of src/ui/styles.css (light mode), not new colours.
const BG = [0xfa, 0xfa, 0xf8]; // --color-bg
const ACCENT = [0xc2, 0x41, 0x0c]; // --color-accent
const TEXT = [0x29, 0x25, 0x24]; // --color-text
const BLUE = [0x4f, 0x6e, 0xa8]; // --color-figure-pants
const GREEN = [0x8a, 0xa6, 0x6d]; // --color-figure-onesie

const H = 0.17, GAP = 0.06, TOP = (1 - (4 * H + 3 * GAP)) / 2;
const BARS = [
  { x0: 0.1, x1: 0.62, c: ACCENT },
  { x0: 0.32, x1: 0.9, c: TEXT },
  { x0: 0.1, x1: 0.44, c: BLUE },
  { x0: 0.5, x1: 0.9, c: GREEN },
].map((b, i) => ({ ...b, y0: TOP + i * (H + GAP), y1: TOP + i * (H + GAP) + H }));

function ink(x, y) {
  for (const b of BARS) {
    const r = H / 2;
    if (y < b.y0 || y > b.y1 || x < b.x0 || x > b.x1) continue;
    const cx = Math.min(Math.max(x, b.x0 + r), b.x1 - r);
    if ((x - cx) ** 2 + (y - (b.y0 + r)) ** 2 <= r * r) return b.c;
  }
  return null;
}

const SS = 4;
function render(size, inset) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size, v = (y + (sy + 0.5) / SS) / size;
          const c = ink((u - inset) / (1 - 2 * inset), (v - inset) / (1 - 2 * inset)) ?? BG;
          for (let k = 0; k < 3; k++) acc[k] += c[k];
        }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(acc[k] / (SS * SS));
    }
  }
  return raw;
}
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, inset) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; // RGB, opaque
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(render(size, inset), { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}
mkdirSync(OUT, { recursive: true });
for (const [name, size, inset] of [
  ["apple-touch-icon.png", 180, 0.04],
  ["icon-192.png", 192, 0.04],
  ["icon-512.png", 512, 0.04],
  ["icon-maskable-512.png", 512, 0.1],
  ["favicon-32.png", 32, 0.02],
]) {
  writeFileSync(`${OUT}/${name}`, png(size, inset));
  console.log(`${OUT}/${name} ${size}x${size}`);
}
