// The four "one thing after another" screens of the first-run assistant, as
// data: which timeline each fills, its colour, its rules and its copy. The
// colours are data (stored on the row, drawn as-is in both themes), like the
// "Places lived" colour `completeIdentityStep` has always used.

import { educationChips } from "./schoolSystems";
import type { SequenceRules } from "./sequence";

export type TopicId = "lived" | "learned" | "worked" | "partner";

export interface AddChip {
  icon: string;
  text: string; // on the chip
  label: string; // the new item's name ("" for a job: shown and saved as "Job" until named)
  length: number; // typical length in years
  start?: number; // typical start, when it is the first item
  gap?: boolean;
}

export interface LifeTopic {
  id: TopicId;
  rowLabel: string;
  icon: string;
  color: string;
  rules: SequenceRules;
  withPlace: boolean; // places keep the details picked in the search
  prompt: string;
  hint: string;
  noun: string; // placeholder and fallback for a blank name
  still: string; // the label for "no end"
  chips?: AddChip[];
  // A free-text adder instead of chips; `gapLength` adds a ⏸ Gap button.
  textAdder?: { placeholder: string; gapLength?: number };
  // The strip starts at this age unless asked (work, partners): years of
  // childhood would squeeze a short job into a sliver.
  lateStart?: number;
}

export const KIDS_COLOR = "#3d8798";

export const TOPICS: Record<TopicId, LifeTopic> = {
  lived: {
    id: "lived",
    rowLabel: "Places lived",
    icon: "🏠",
    color: "#8ba66f",
    rules: { freeStart: false, endable: false },
    withPlace: true,
    prompt: "Where have you lived?",
    hint: "Drag the dots to when you moved. Roughly is fine.",
    noun: "Place",
    still: "Still going",
    textAdder: { placeholder: "City, region, or country" },
  },
  learned: {
    id: "learned",
    rowLabel: "Education",
    icon: "🎓",
    color: "#7f68a8",
    rules: { freeStart: true, endable: true },
    withPlace: false,
    prompt: "School and after",
    hint: "Add in order. Gaps hold time and create nothing.",
    noun: "School",
    still: "Still going",
    // The neutral set; the assistant swaps in the one for where you went to
    // school (schoolSystems.ts).
    chips: educationChips("generic"),
  },
  worked: {
    id: "worked",
    rowLabel: "Work",
    icon: "💼",
    color: "#4f6ea8",
    rules: { freeStart: true, endable: true },
    withPlace: false,
    prompt: "Where have you worked?",
    hint: "One job after another. Name them now or later.",
    lateStart: 16,
    noun: "Job",
    still: "Still going",
    chips: [
      { icon: "💼", text: "Job", label: "", length: 3, start: 20 },
      { icon: "👶", text: "Parental leave", label: "Parental leave", length: 1 },
      { icon: "🌴", text: "Sabbatical", label: "Sabbatical", length: 1 },
      { icon: "⏸", text: "Gap", label: "", length: 1, gap: true },
    ],
  },
  partner: {
    id: "partner",
    rowLabel: "Relationships",
    icon: "❤️",
    color: "#a8443f",
    rules: { freeStart: true, endable: true },
    withPlace: false,
    prompt: "Who have you been with?",
    hint: "Add the ones that matter to you. Skipping is fine.",
    lateStart: 16,
    noun: "Partner",
    still: "Still together",
    textAdder: { placeholder: "Add a partner", gapLength: 2 },
  },
};

export const TOPIC_ORDER: TopicId[] = ["lived", "learned", "worked", "partner"];

// The line under the strip while a dot is dragged.
export function describeStart(topic: LifeTopic, name: string, at: number, index: number, birthYear: number): string {
  if (topic.id === "lived") return index === 0 ? `${name} from birth` : `Moved to ${name} at ${at} · ${birthYear + at}`;
  return `${name} from ${at} · ${birthYear + at}`;
}

export function describeEnd(end: number, birthYear: number): string {
  return `Ended at ${end} · ${birthYear + end}`;
}
