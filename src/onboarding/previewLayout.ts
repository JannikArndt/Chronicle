// The live preview under every first-run screen: a compact drawing of
// everything answered so far, against the person's own age. This file decides
// what is drawn where; `OnboardingPreview` only paints it.
//
// One lane per timeline that will exist, in the topic colours, with a
// "Family" band holding the kids and, under each kid, their kids. Gaps are not
// drawn — they create nothing. When there are many lanes they get thinner
// before the preview has to scroll, so it keeps to about a third of the screen.

import { ageTicks, spansOf } from "./sequence";
import type { Sequence } from "./sequence";
import { grandkidLabel, kidLabel } from "./familyRecords";
import type { FamilyDraft } from "./familyRecords";

export interface PreviewBar {
  from: number; // years after birth
  to: number | null; // null = until now
  label: string;
}

export type PreviewLane =
  | { kind: "row"; icon: string; color: string; indent: number; bars: PreviewBar[] }
  | { kind: "header"; icon: string; label: string };

export interface PreviewTopic {
  icon: string;
  color: string;
  sequence: Sequence;
  always?: boolean; // drawn even while empty (places: the row exists from the name step on)
}

export function previewLanes(
  topics: PreviewTopic[],
  family: FamilyDraft,
  birthYear: number,
  kidColor: string,
): PreviewLane[] {
  const lanes: PreviewLane[] = [];
  topics.forEach((topic) => {
    const bars = spansOf(topic.sequence)
      .filter((span) => !span.gap)
      .map((span) => ({ from: span.from, to: span.to, label: span.name }));
    if (bars.length > 0 || topic.always) lanes.push({ kind: "row", icon: topic.icon, color: topic.color, indent: 0, bars });
  });
  if (family.kids.length > 0) {
    lanes.push({ kind: "header", icon: "👨‍👩‍👧", label: "Family" });
    family.kids.forEach((kid, index) => {
      lanes.push({
        kind: "row",
        icon: "👶",
        color: kidColor,
        indent: 10,
        bars: [{ from: kid.year - birthYear, to: null, label: `${kidLabel(kid, index)} · ${kid.year}` }],
      });
      family.grandkids
        .filter((grandkid) => grandkid.parentKey === kid.key)
        .forEach((grandkid) => {
          lanes.push({
            kind: "row",
            icon: "🧒",
            color: kidColor,
            indent: 16,
            bars: [{ from: grandkid.year - birthYear, to: null, label: `${grandkidLabel(grandkid)} · ${grandkid.year}` }],
          });
        });
    });
  }
  return lanes;
}

// ---------- geometry ----------

export const PREVIEW_TOP = 30; // two tick-label lines above the first lane
const LANE_HEIGHT = 15;
const LANE_GAP = 4;
const MIN_LANE_HEIGHT = 8;
const LEFT = 26; // the icon column
const RIGHT_PAD = 6;
const MIN_LABEL_DISTANCE = 40;

export interface LaidOutBar {
  x: number;
  width: number;
  label: string | null; // null when it would not fit
  alt: boolean; // every other bar in a lane is a shade lighter, so neighbours read as two
}

export interface LaidOutLane {
  y: number;
  height: number;
  lane: PreviewLane;
  iconX: number;
  bars: LaidOutBar[];
}

export interface PreviewTick {
  x: number;
  age: number;
  year: number;
  labelX: number | null; // null: drawn as a gridline only
}

export interface PreviewLayout {
  height: number;
  x0: number;
  x1: number;
  ticks: PreviewTick[];
  lanes: LaidOutLane[];
}

export function layoutPreview(input: {
  width: number;
  maxHeight: number;
  span: number; // fractional years from the start of the birth year to now
  birthYear: number;
  lanes: PreviewLane[];
}): PreviewLayout {
  const { width, maxHeight, span, birthYear, lanes } = input;
  const x0 = LEFT;
  const x1 = Math.max(x0 + 1, width - RIGHT_PAD);
  const x = (age: number) => x0 + (Math.min(Math.max(age, 0), span) / span) * (x1 - x0);

  const perLane = lanes.length > 0 ? (maxHeight - PREVIEW_TOP - 2) / lanes.length : LANE_HEIGHT + LANE_GAP;
  const roomy = perLane >= LANE_HEIGHT + LANE_GAP;
  const laneHeight = roomy ? LANE_HEIGHT : Math.max(MIN_LANE_HEIGHT, Math.floor(perLane - 2));
  const gap = roomy ? LANE_GAP : 2;
  const labelsFit = laneHeight >= 11;

  let lastLabel = -Infinity;
  const ticks: PreviewTick[] = ageTicks(span).map((age) => {
    const tickX = x(age);
    let labelX: number | null = age === 0 ? tickX + 14 : tickX;
    if (labelX - lastLabel < MIN_LABEL_DISTANCE || x1 - tickX < 14) labelX = null;
    else lastLabel = labelX;
    return { x: tickX, age, year: birthYear + age, labelX };
  });

  const laidOut: LaidOutLane[] = lanes.map((lane, index) => {
    const y = PREVIEW_TOP + index * (laneHeight + gap);
    const iconX = lane.kind === "row" && lane.indent > 0 ? Math.min(lane.indent, 14) : 2;
    const bars =
      lane.kind === "row"
        ? lane.bars.map((bar, barIndex) => {
            const left = x(bar.from);
            const right = Math.max(left + 3, x(bar.to ?? span) - 1.5);
            const barWidth = right - left;
            return {
              x: left,
              width: barWidth,
              label: labelsFit && barWidth > 30 ? bar.label : null,
              alt: barIndex % 2 === 1,
            };
          })
        : [];
    return { y, height: laneHeight, lane, iconX, bars };
  });

  return {
    height: PREVIEW_TOP + lanes.length * (laneHeight + gap) + 2,
    x0,
    x1,
    ticks,
    lanes: laidOut,
  };
}
