// "Your timeline so far": the live preview at the foot of every first-run
// screen after the birth one. It redraws on every drag and keystroke, so the
// reveal happens continuously instead of on a screen of its own. Geometry
// comes from `layoutPreview` (pure, tested); this paints it.

import { useEffect, useRef, useState } from "react";
import { cssFontFamily, cssToken, prepareCanvas, roundRect, useThemeVersion } from "./canvasTheme";
import { layoutPreview } from "./previewLayout";
import type { PreviewLane } from "./previewLayout";

interface OnboardingPreviewProps {
  lanes: PreviewLane[];
  birthYear: number;
  span: number;
}

// About a third of the screen, less the title line above the canvas.
function maxCanvasHeight(): number {
  return Math.max(90, Math.round(window.innerHeight / 3) - 34);
}

export function OnboardingPreview({ lanes, birthYear, span }: OnboardingPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const theme = useThemeVersion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setWidth(canvas.clientWidth));
    observer.observe(canvas);
    setWidth(canvas.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const layout = layoutPreview({ width, maxHeight: maxCanvasHeight(), span, birthYear, lanes });
    const prepared = prepareCanvas(canvas, layout.height);
    if (!prepared) return;
    const { ctx } = prepared;
    const font = cssFontFamily();
    const text = cssToken("--color-text");

    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.font = `10px ${font}`;
    layout.ticks.forEach((tick) => {
      ctx.strokeStyle = cssToken("--color-canvas-gridline");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(tick.x) + 0.5, 22);
      ctx.lineTo(Math.round(tick.x) + 0.5, layout.height);
      ctx.stroke();
      if (tick.labelX === null) return;
      ctx.fillStyle = cssToken("--color-text-secondary");
      ctx.fillText(String(tick.year), tick.labelX, 6);
      ctx.fillStyle = cssToken("--color-text-faint");
      ctx.fillText(`age ${tick.age}`, tick.labelX, 17);
    });

    ctx.textAlign = "left";
    layout.lanes.forEach(({ lane, y, height, iconX, bars }) => {
      const middle = y + height / 2;
      ctx.font = `${Math.min(11, height - 2)}px ${font}`;
      ctx.fillStyle = text;
      if (lane.kind === "header") {
        ctx.fillStyle = cssToken("--color-group-band");
        roundRect(ctx, layout.x0, y, layout.x1 - layout.x0, height, 4);
        ctx.fill();
        ctx.fillStyle = text;
        ctx.fillText(lane.icon, iconX, middle + 1);
        if (height >= 11) {
          ctx.font = `600 10px ${font}`;
          ctx.fillStyle = cssToken("--color-text-muted");
          ctx.fillText(lane.label, layout.x0 + 5, middle + 0.5);
        }
        return;
      }
      ctx.fillText(lane.icon, iconX, middle + 1);
      ctx.font = `600 10px ${font}`;
      bars.forEach((bar) => {
        ctx.globalAlpha = bar.alt ? 0.82 : 1;
        ctx.fillStyle = lane.color;
        roundRect(ctx, bar.x, y, bar.width, height, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (bar.label === null) return;
        ctx.save();
        roundRect(ctx, bar.x, y, bar.width, height, 4);
        ctx.clip();
        ctx.fillStyle = cssToken("--color-on-accent");
        ctx.fillText(bar.label, bar.x + 5, middle + 0.5);
        ctx.restore();
      });
    });
  }, [lanes, birthYear, span, width, theme]);

  return (
    <div className="onboarding-preview">
      <div className="onboarding-preview-title">Your timeline so far</div>
      <div className="onboarding-preview-scroll">
        <canvas ref={canvasRef} aria-label="A preview of your timeline" />
      </div>
    </div>
  );
}
