// Shared by the first-run assistant's two small canvases (the ageing figure
// and the live preview): a canvas is painted by JS, so it reads the same
// `--color-*` custom properties the DOM uses, and repaints when the OS theme
// flips — the same reason the timeline engine reads them (src/render/engine.ts).

import { useEffect, useState } from "react";

export function cssToken(name: string, fallback = "#888888"): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

export function cssFontFamily(): string {
  if (typeof document === "undefined") return "sans-serif";
  return getComputedStyle(document.body).fontFamily || "sans-serif";
}

// Bumps whenever the colour scheme changes, so a canvas effect that lists it
// as a dependency repaints with the other theme's tokens.
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const bump = () => setVersion((v) => v + 1);
    query.addEventListener("change", bump);
    return () => query.removeEventListener("change", bump);
  }, []);
  return version;
}

// Sizes the backing store to the element's CSS size at the device pixel ratio
// and returns a context drawing in CSS pixels.
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  cssHeight?: number,
): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (cssHeight !== undefined) canvas.style.height = `${cssHeight}px`;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = cssHeight ?? canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  else ctx.rect(x, y, w, h);
}
