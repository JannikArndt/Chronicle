// One date field = text input + 5-option precision pills + "pick on timeline"
// crosshair (§6). Manual text entry defaults to day precision; the pill widens
// it. Picking commits date AND precision together from the snapped unit.

import { useEffect, useState } from "react";
import { formatFuzzyDate, parseDateInput } from "../model/fuzzyDate";
import type { FuzzyDate, Precision } from "../model/types";
import { armDatePicking, cancelDatePicking } from "../state/actions";
import { useAppState } from "../state/store";
import { PillSelector } from "./PillSelector";
import type { PillOption } from "./PillSelector";

const PRECISION_OPTIONS: PillOption<Precision>[] = [
  { value: "exact", icon: "🎯", label: "exact" },
  { value: "day", icon: "📅", label: "day" },
  { value: "month", icon: "🗓️", label: "month" },
  { value: "year", icon: "🎆", label: "year" },
  { value: "circa", icon: "🌫️", label: "circa" },
];

interface DateFieldProps {
  label: string;
  field: "start" | "end";
  value: FuzzyDate | undefined;
  onChange: (value: FuzzyDate | undefined) => void;
  allowOngoing?: boolean;
  disabled?: boolean;
}

export function DateField({ label, field, value, onChange, allowOngoing, disabled }: DateFieldProps) {
  const picking = useAppState((s) => s.pickingField);
  const [text, setText] = useState(value ? formatFuzzyDate(value) : "");

  useEffect(() => {
    setText(value ? formatFuzzyDate(value) : "");
  }, [value]);

  const commitText = () => {
    if (text.trim() === "") {
      if (allowOngoing) onChange(undefined);
      else setText(value ? formatFuzzyDate(value) : "");
      return;
    }
    const parsed = parseDateInput(text);
    if (parsed) {
      onChange({ ms: parsed.ms, precision: parsed.precision, fuzzDays: value?.fuzzDays });
    } else {
      setText(value ? formatFuzzyDate(value) : "");
    }
  };

  const isPickingThis = picking === field;

  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="date-input-row">
        <input
          type="text"
          value={text}
          placeholder={allowOngoing ? "ongoing" : "YYYY-MM-DD"}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
        />
        <button
          type="button"
          className={`icon-button ${isPickingThis ? "icon-button-active" : ""}`}
          title="Pick on timeline"
          disabled={disabled}
          onClick={() => (isPickingThis ? cancelDatePicking() : armDatePicking(field))}
        >
          ⌖
        </button>
        {allowOngoing && value && (
          <button
            type="button"
            className="icon-button"
            title="Make ongoing (no end date)"
            disabled={disabled}
            onClick={() => onChange(undefined)}
          >
            →
          </button>
        )}
      </div>
      {isPickingThis && <div className="hint">Click the timeline to pick — Esc cancels.</div>}
      {value && (
        <PillSelector
          options={PRECISION_OPTIONS}
          value={value.precision}
          disabled={disabled}
          onChange={(precision) => onChange({ ...value, precision })}
        />
      )}
    </div>
  );
}
