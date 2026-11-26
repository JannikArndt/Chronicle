// The birth screen's figure, as numbers: what a person drawn at a given age
// looks like. `AgeFigure` paints it; everything that changes with age is
// decided here so it can be tested without a canvas.
//
// A baby sits (under 2). A child has a bigger head and shorter legs, growing
// to adult proportions at 18. Hair greys from 40 and is white by about 80,
// thinning from 55; glasses from 44; a stoop from 66; a cane from 78.

export type FigurePose =
  | { kind: "baby" }
  | {
      kind: "person";
      grow: number; // height as a share of a full-grown adult
      heads: number; // body height in head heights
      legShare: number; // legs as a share of body height
      shoulder: number; // half the shoulder width, in head radii
      stoop: number; // forward lean, radians
      glasses: boolean;
      cane: boolean;
      hairThin: number; // 0 = full, up to 0.4
      sideHair: boolean;
    };

export function figurePose(age: number): FigurePose {
  if (age < 2) return { kind: "baby" };
  const child = Math.min(age, 18) / 18;
  return {
    kind: "person",
    grow: age < 18 ? 0.36 + 0.64 * Math.pow(child, 0.8) : 1 - Math.max(0, Math.min(0.07, (age - 68) * 0.004)),
    heads: age < 18 ? 4.2 + 3.2 * child : 7.4,
    legShare: 0.4 + 0.07 * child,
    shoulder: age < 18 ? 1 + 0.25 * child : 1.25,
    stoop: age > 66 ? Math.min(0.26, (age - 66) * 0.012) : 0,
    glasses: age >= 44,
    cane: age >= 78,
    hairThin: age > 55 ? Math.min(0.4, (age - 55) * 0.016) : 0,
    sideHair: age >= 4 && age < 60,
  };
}

export type HairTone = "young" | "mid" | "old";

// Which two hair colours to blend, and how far: dark until 40, greying to 62,
// white by 80.
export function hairBlend(age: number): { from: HairTone; to: HairTone; t: number } {
  if (age < 40) return { from: "young", to: "young", t: 0 };
  if (age < 62) return { from: "young", to: "mid", t: (age - 40) / 22 };
  return { from: "mid", to: "old", t: Math.min(1, (age - 62) / 18) };
}

function parseHex(hex: string): [number, number, number] | undefined {
  let digits = hex.trim().replace("#", "");
  if (digits.length === 3) digits = [...digits].map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(digits)) return undefined;
  const n = parseInt(digits, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Blends two `#rrggbb` colours (the figure's CSS tokens). Anything that isn't
// hex comes back as the first colour unblended.
export function mixHex(a: string, b: string, t: number): string {
  const from = parseHex(a);
  const to = parseHex(b);
  if (!from || !to) return a;
  const k = Math.min(1, Math.max(0, t));
  return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * k)).join(", ")})`;
}
