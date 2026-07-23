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

// Derives day/month/year field order from the runtime locale instead of a
// hardcoded list, so en-US naturally gets MM/DD/YYYY and most other locales
// get DD/MM/YYYY.
export function localeDateOrder(): DateSegmentKind[] {
  const parts = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return parts
    .map((part) => part.type)
    .filter((type): type is DateSegmentKind => type === "day" || type === "month" || type === "year");
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

export function BirthDateInput({ value, onChange }: BirthDateInputProps) {
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
  };

  return (
    <div className="birth-date-input">
      {order.map((kind) => (
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
            onChange={(event) => handleSegmentChange(kind, event.target.value)}
            onKeyDown={(event) => handleSegmentKeyDown(kind, event)}
            placeholder={SEGMENT_LABEL[kind]}
          />
        </label>
      ))}
    </div>
  );
}
