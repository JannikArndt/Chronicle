// The birth screen's figure: a person drawn at the chosen age, ageing as the
// slider moves. What changes with age is decided by `figurePose` (pure,
// tested); this only paints it, in the `--color-figure-*` tokens of the
// current theme.

import { useEffect, useRef } from "react";
import { cssToken, prepareCanvas, roundRect, useThemeVersion } from "./canvasTheme";
import { figurePose, hairBlend, mixHex } from "./figurePose";

const FULL = Math.PI * 2;

function hairColor(age: number): string {
  const blend = hairBlend(age);
  const tone = (name: string) => cssToken(`--color-figure-hair-${name}`);
  return mixHex(tone(blend.from), tone(blend.to), blend.t);
}

function drawFace(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, glasses: boolean): void {
  const line = cssToken("--color-figure-line");
  ctx.fillStyle = line;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(x + side * r * 0.36, y + r * 0.08, r * 0.09, 0, FULL);
    ctx.fill();
  }
  ctx.strokeStyle = line;
  ctx.lineWidth = Math.max(1.2, r * 0.08);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, y + r * 0.3, r * 0.3, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();
  if (!glasses) return;
  ctx.lineWidth = Math.max(1.2, r * 0.07);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(x + side * r * 0.36, y + r * 0.08, r * 0.24, 0, FULL);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x - r * 0.12, y + r * 0.06);
  ctx.lineTo(x + r * 0.12, y + r * 0.06);
  ctx.stroke();
}

function drawHair(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, age: number, thin: number, side: boolean): void {
  ctx.fillStyle = hairColor(age);
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.18, r * 1.06, r * (0.92 - thin), 0, Math.PI, FULL);
  ctx.fill();
  if (!side) return;
  for (const s of [-1, 1]) {
    roundRect(ctx, x + s * r * 0.98 - r * 0.14, y - r * 0.25, r * 0.28, r * 0.55, r * 0.14);
    ctx.fill();
  }
}

function drawFigure(canvas: HTMLCanvasElement, age: number): void {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  const ground = height - 12;
  const cx = width / 2;
  const skin = cssToken("--color-figure-skin");
  const shirt = cssToken("--color-figure-shirt");
  const pants = cssToken("--color-figure-pants");
  const line = cssToken("--color-figure-line");

  ctx.fillStyle = cssToken("--color-group-band");
  ctx.beginPath();
  ctx.ellipse(cx, ground + 2, 56, 7, 0, 0, FULL);
  ctx.fill();

  const pose = figurePose(age);
  if (pose.kind === "baby") {
    const r = 18;
    const bodyY = ground - 22;
    ctx.fillStyle = cssToken("--color-figure-onesie");
    roundRect(ctx, cx - 6, ground - 15, 38, 14, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - 6, bodyY, 21, 22, 0, 0, FULL);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(cx + 34, ground - 8, 6, 7, 0, 0, FULL);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 12, bodyY - 2, 6, 0, FULL);
    ctx.fill();
    const headY = bodyY - 22 - r + 6;
    ctx.beginPath();
    ctx.arc(cx - 6, headY, r, 0, FULL);
    ctx.fill();
    ctx.strokeStyle = hairColor(0);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx - 2, headY - r - 2, 5, Math.PI * 0.9, Math.PI * 2.1);
    ctx.stroke();
    drawFace(ctx, cx - 6, headY, r, false);
    return;
  }

  const bodyHeight = (height - 26) * pose.grow;
  const r = bodyHeight / pose.heads / 2;
  const legLength = bodyHeight * pose.legShare;
  const neck = r * 0.25;
  const torso = bodyHeight - legLength - 2 * r - neck;
  const shoulder = r * pose.shoulder;
  const hipX = cx - pose.stoop * 24;
  const hipY = ground - legLength;

  ctx.lineCap = "round";
  ctx.strokeStyle = pants;
  ctx.lineWidth = r * 0.62;
  const stance = r * 0.42;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(hipX + side * stance * 0.6, hipY);
    ctx.lineTo(hipX + side * stance, ground - r * 0.2);
    ctx.stroke();
  }
  ctx.fillStyle = line;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(hipX + side * stance + side * r * 0.12, ground - r * 0.12, r * 0.38, r * 0.18, 0, 0, FULL);
    ctx.fill();
  }

  const cos = Math.cos(pose.stoop);
  const sin = Math.sin(pose.stoop);
  const toWorld = (x: number, y: number): [number, number] => [hipX + x * cos - y * sin, hipY + x * sin + y * cos];

  ctx.save();
  ctx.translate(hipX, hipY);
  ctx.rotate(pose.stoop);
  ctx.strokeStyle = shirt;
  ctx.lineWidth = r * 0.5;
  const leftHand: [number, number] = [-shoulder - r * 0.2, -torso * 0.12];
  ctx.beginPath();
  ctx.moveTo(-shoulder + r * 0.25, -torso + r * 0.3);
  ctx.lineTo(leftHand[0], leftHand[1]);
  ctx.stroke();
  ctx.fillStyle = shirt;
  roundRect(ctx, -shoulder, -torso, shoulder * 2, torso + r * 0.35, r * 0.55);
  ctx.fill();
  const rightHand: [number, number] = pose.cane ? [shoulder + r, -torso * 0.3] : [shoulder + r * 0.2, -torso * 0.12];
  ctx.beginPath();
  ctx.moveTo(shoulder - r * 0.25, -torso + r * 0.3);
  ctx.lineTo(rightHand[0], rightHand[1]);
  ctx.stroke();
  ctx.fillStyle = skin;
  for (const hand of [leftHand, rightHand]) {
    ctx.beginPath();
    ctx.arc(hand[0], hand[1], r * 0.24, 0, FULL);
    ctx.fill();
  }
  roundRect(ctx, -r * 0.22, -torso - neck - r * 0.2, r * 0.44, neck + r * 0.4, 2);
  ctx.fill();
  const headY = -torso - neck - r;
  ctx.beginPath();
  ctx.arc(0, headY, r, 0, FULL);
  ctx.fill();
  drawHair(ctx, 0, headY, r, age, pose.hairThin, pose.sideHair);
  drawFace(ctx, 0, headY, r, pose.glasses);
  ctx.restore();

  if (pose.cane) {
    const [handX, handY] = toWorld(rightHand[0], rightHand[1]);
    ctx.strokeStyle = cssToken("--color-figure-cane");
    ctx.lineWidth = Math.max(2.5, r * 0.18);
    ctx.beginPath();
    ctx.moveTo(handX, handY - r * 0.1);
    ctx.lineTo(handX + r * 0.25, ground);
    ctx.stroke();
  }
}

export function AgeFigure({ age }: { age: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useThemeVersion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawFigure(canvas, age);
    const observer = new ResizeObserver(() => drawFigure(canvas, age));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [age, theme]);

  return <canvas ref={canvasRef} className="age-figure" aria-label={`A person drawn at ${age}`} />;
}
