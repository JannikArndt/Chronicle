// Low-friction DD/MM/YYYY birthdate entry for onboarding: three separate
// segment inputs (locale-ordered, so en-US shows MM before DD) that
// auto-advance focus once a segment is full. Segment strings live in local
// component state; `onChange` only fires a UTC ms instant (or undefined)
// once all three segments combine into a real calendar date.

import { useRef, useState } from "react";

export type DateSegmentKind = "day" | "month" | "year";

interface BirthDateInputProps {
  value: number | undefined; // UTC ms, or undefined if incomplete/invalid
  onChange: (value: number | undefined) => void;
  onSubmit?: () => void; // called when the user presses Enter in any segment
}

const SEGMENT_LABEL: Record<DateSegmentKind, string> = {
  day: "DD",
  month: "MM",
  year: "YYYY",
};

const SEGMENT_MAX_LENGTH: Record<DateSegmentKind, number> = {
  day: 2,
  month: 2,
  year: 4,
};

// Derives day/month/year field order. `Intl.DateTimeFormat(undefined, ...)`
// resolves against the browser's runtime default locale, which is an
// unreliable signal for actual date-format preference — a browser installed
// in English (or an OS regional format left at a US default) resolves to
// en-US even for users who want DD/MM/YYYY. So we default to DD/MM/YYYY (the
// globally dominant order) and only switch to MM/DD/YYYY on a clear,
// deliberate signal: `navigator.language` itself (not full Intl resolution)
// being exactly "en-US" or a region variant of it.
export function localeDateOrder(): DateSegmentKind[] {
  const language = typeof navigator !== "undefined" ? navigator.language : "en-US";
  if (language === "en-US" || language.startsWith("en-US-")) {
    return ["month", "day", "year"];
  }
  return ["day", "month", "year"];
}

// A day/month/year triple is a real calendar date only if constructing it
// with Date.UTC and reading it back gives the same year/month/day — this
// catches overflow like Feb 30 silently rolling into March.
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const ms = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(ms);
  return (
    roundTrip.getUTCFullYear() === year && roundTrip.getUTCMonth() === month - 1 && roundTrip.getUTCDate() === day
  );
}

function decomposeUtcMs(ms: number | undefined): Record<DateSegmentKind, string> {
  if (ms === undefined) return { day: "", month: "", year: "" };
  const date = new Date(ms);
  return {
    day: String(date.getUTCDate()).padStart(2, "0"),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
    year: String(date.getUTCFullYear()),
  };
}

export function BirthDateInput({ value, onChange, onSubmit }: BirthDateInputProps) {
  const order = useRef(localeDateOrder()).current;
  const [segments, setSegments] = useState<Record<DateSegmentKind, string>>(() => decomposeUtcMs(value));
  const inputRefs = useRef<Record<DateSegmentKind, HTMLInputElement | null>>({ day: null, month: null, year: null });

  const focusSegment = (kind: DateSegmentKind) => inputRefs.current[kind]?.focus();

  const tryEmitChange = (next: Record<DateSegmentKind, string>) => {
    const year = Number(next.year);
    const month = Number(next.month);
    const day = Number(next.day);
    const currentYear = new Date().getUTCFullYear();
    const complete = next.year.length === 4 && next.month.length > 0 && next.day.length > 0;
    if (complete && year >= 1900 && year <= currentYear && isValidCalendarDate(year, month, day)) {
      onChange(Date.UTC(year, month - 1, day));
    } else {
      onChange(undefined);
    }
  };

  const handleSegmentChange = (kind: DateSegmentKind, rawText: string) => {
    const digitsOnly = rawText.replace(/\D/g, "").slice(0, SEGMENT_MAX_LENGTH[kind]);
    const next = { ...segments, [kind]: digitsOnly };
    setSegments(next);
    tryEmitChange(next);

    if (digitsOnly.length === SEGMENT_MAX_LENGTH[kind]) {
      const indexInOrder = order.indexOf(kind);
      const nextKind = order[indexInOrder + 1];
      if (nextKind) focusSegment(nextKind);
    }
  };

  const handleSegmentKeyDown = (kind: DateSegmentKind, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && segments[kind] === "") {
      const indexInOrder = order.indexOf(kind);
      const previousKind = order[indexInOrder - 1];
      if (previousKind) focusSegment(previousKind);
    }
    if (event.key === "Enter") {
      onSubmit?.();
    }
  };

  return (
    <div className="birth-date-input">
      {order.map((kind, index) => (
        <label key={kind} className={`birth-date-segment birth-date-segment-${kind}`}>
          <span className="birth-date-segment-label">{SEGMENT_LABEL[kind]}</span>
          <input
            ref={(element) => {
              inputRefs.current[kind] = element;
            }}
            type="text"
            inputMode="numeric"
            maxLength={SEGMENT_MAX_LENGTH[kind]}
            value={segments[kind]}
            autoFocus={index === 0}
            onChange={(event) => handleSegmentChange(kind, event.target.value)}
            onKeyDown={(event) => handleSegmentKeyDown(kind, event)}
            placeholder={SEGMENT_LABEL[kind]}
          />
        </label>
      ))}
    </div>
  );
}
