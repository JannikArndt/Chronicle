// Horizontal time mapping for the canvas. One struct, pure functions —
// the engine owns the current value and derives everything from it.

export interface TimeScale {
  startMs: number; // time at x = 0
  msPerPx: number;
}

export const MIN_MS_PER_PX = 30_000; // ~30s per pixel — enough for exact-time entries
export const MAX_MS_PER_PX = 2e10; // ~630 years per 1000px viewport

export function msToX(scale: TimeScale, ms: number): number {
  return (ms - scale.startMs) / scale.msPerPx;
}

export function xToMs(scale: TimeScale, x: number): number {
  return scale.startMs + x * scale.msPerPx;
}

export function panBy(scale: TimeScale, deltaPx: number): TimeScale {
  return { ...scale, startMs: scale.startMs + deltaPx * scale.msPerPx };
}

// factor < 1 zooms in, > 1 zooms out; the instant under anchorX stays put.
export function zoomAt(scale: TimeScale, anchorX: number, factor: number): TimeScale {
  const anchorMs = xToMs(scale, anchorX);
  const msPerPx = Math.min(MAX_MS_PER_PX, Math.max(MIN_MS_PER_PX, scale.msPerPx * factor));
  return { startMs: anchorMs - anchorX * msPerPx, msPerPx };
}

export function clampScale(scale: TimeScale): TimeScale {
  return { ...scale, msPerPx: Math.min(MAX_MS_PER_PX, Math.max(MIN_MS_PER_PX, scale.msPerPx)) };
}

export function scaleForRange(startMs: number, endMs: number, width: number): TimeScale {
  return clampScale({ startMs, msPerPx: (endMs - startMs) / width });
}
