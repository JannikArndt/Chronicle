// The mobile date editor. Three designs were built and compared during the
// prototype — handles, sliders, and dragging the bar's edges — and handles won,
// so this builds only handles.
//
// Layout, top to bottom: a Start block above the handle it controls and an End
// block above its own, then one lane carrying the entry's bar, a `now` marker
// and the two handles. No start/end summary above them: the blocks already say
// it, and saying it twice tested as noise.

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { formatByPrecision, snapMsToPrecision } from "../model/fuzzyDate";
import { ACCEPTED_DATE_FORMATS_HINT, parseDateInput } from "../model/parseDateInput";
import type { FuzzyDate, Precision } from "../model/types";
import { dateLaneRange, laneFraction, laneFractionToMs } from "./dateLaneRange";
import type { LaneRange } from "./dateLaneRange";

// The model keeps five precisions; the mobile UI offers the three that are
// worth a thumb. `exact` and `circa` entries from imports or the desktop UI
// round-trip untouched — they simply show no selected pill.
const GRANULARITY_OPTIONS: { value: Precision; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

type Handle = "start" | "end";

// The model stores "ongoing" as *no end date at all*, but a missing value is
// not something a user can read, tap or type. So the end field presents it as
// the value it holds — one word for one state, everywhere it appears.
const ONGOING_TEXT = "still ongoing";

interface DateRangeEditorProps {
  start: FuzzyDate;
  end: FuzzyDate | undefined;
  disabled?: boolean;
  onChange: (patch: { start?: FuzzyDate; end?: FuzzyDate | undefined }) => void;
}

export function DateRangeEditor({ start, end, disabled, onChange }: DateRangeEditorProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<Handle | null>(null);
  const nowMs = Date.now();
  const effectiveEndMs = end?.ms ?? nowMs;

  // Held in state, not derived on render: re-deriving it from the dates would
  // move the lane under the finger on every frame of a drag. It is recomputed
  // only on discrete changes — a typed date, or the ongoing toggle.
  const [range, setRange] = useState<LaneRange>(() => dateLaneRange(start.ms, effectiveEndMs));
  const recomputeRange = (startMs: number, endMs: number) => setRange(dateLaneRange(startMs, endMs));

  // Switching to ongoing throws the end forward to today, which is exactly the
  // case that used to park the end handle outside the lane.
  useEffect(() => {
    if (draggingRef.current === null) recomputeRange(start.ms, effectiveEndMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end === undefined]);

  const setStart = (ms: number) => onChange({ start: { ...start, ms } });
  const setEnd = (ms: number) => onChange({ end: { ...(end ?? { precision: "month" as Precision }), ms } });

  const msAtClientX = (clientX: number, handle: Handle): number => {
    const lane = laneRef.current;
    if (!lane) return handle === "start" ? start.ms : effectiveEndMs;
    const bounds = lane.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    const precision = handle === "start" ? start.precision : (end?.precision ?? "month");
    return snapMsToPrecision(laneFractionToMs(fraction, range), precision);
  };

  const startFraction = laneFraction(start.ms, range);
  const endFraction = laneFraction(effectiveEndMs, range);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - bounds.left) / bounds.width;
    // Whichever handle the finger came down nearer to. Two handles can sit very
    // close on a same-day entry, so this decides by side, never by hit box.
    const handle: Handle =
      Math.abs(fraction - startFraction) <= Math.abs(fraction - endFraction) ? "start" : "end";
    draggingRef.current = handle;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragTo(event, handle);
  };

  const dragTo = (event: ReactPointerEvent<HTMLDivElement>, handle: Handle) => {
    const ms = msAtClientX(event.clientX, handle);
    // Handles never cross: dragging the start past the end drags the end along
    // would be surprising, so it simply stops.
    if (handle === "start") setStart(Math.min(ms, effectiveEndMs));
    else if (end) setEnd(Math.max(ms, start.ms));
  };

  return (
    <div className="date-editor">
      <div className="date-editor-blocks">
        <DateBlock
          caption="Started"
          value={start}
          disabled={disabled}
          onCommitMs={(ms, precision) => {
            onChange({ start: { ...start, ms, precision } });
            recomputeRange(ms, effectiveEndMs);
          }}
          onCommitPrecision={(precision) =>
            onChange({ start: { ...start, ms: snapMsToPrecision(start.ms, precision), precision } })
          }
          refuseOngoing={`“${ONGOING_TEXT}” can only be an end date.`}
        />
        <DateBlock
          caption="Ended"
          value={end}
          disabled={disabled}
          emptyLabel={ONGOING_TEXT}
          onChooseOngoing={() => {
            onChange({ end: undefined });
            recomputeRange(start.ms, nowMs);
          }}
          onCommitMs={(ms, precision) => {
            onChange({ end: { ...(end ?? {}), ms, precision } });
            recomputeRange(start.ms, ms);
          }}
          onCommitPrecision={(precision) =>
            end && onChange({ end: { ...end, ms: snapMsToPrecision(end.ms, precision), precision } })
          }
        />
      </div>

      <div
        ref={laneRef}
        className="date-lane"
        onPointerDown={beginDrag}
        onPointerMove={(event) => {
          const handle = draggingRef.current;
          if (handle) dragTo(event, handle);
        }}
        onPointerUp={() => {
          draggingRef.current = null;
        }}
        onPointerCancel={() => {
          draggingRef.current = null;
        }}
      >
        <div
          className="date-lane-bar"
          style={{
            left: `${startFraction * 100}%`,
            width: `${Math.max(endFraction - startFraction, 0) * 100}%`,
          }}
        />
        <div className="date-lane-now" style={{ left: `${laneFraction(nowMs, range) * 100}%` }} />
        <div className="date-handle" style={{ left: `${startFraction * 100}%` }} aria-label="Start" />
        <div
          className={`date-handle ${end ? "" : "date-handle-ongoing"}`}
          style={{ left: `${endFraction * 100}%` }}
          aria-label="End"
        />
      </div>

      <div className="hint">Drag a handle, or tap a date to type it.</div>
    </div>
  );
}

// One side of the editor: caption, the date (tap to type), and the granularity
// control. There is no ongoing *toggle* — an earlier build had one sitting
// beside a field that also accepted "now", so two controls claimed the same
// meaning and could visibly disagree. Ongoing is a value of the End field now,
// and the only way to reach it is to edit that field.
function DateBlock({
  caption,
  value,
  disabled,
  emptyLabel,
  onChooseOngoing,
  onCommitMs,
  onCommitPrecision,
  refuseOngoing,
}: {
  caption: string;
  value: FuzzyDate | undefined;
  disabled?: boolean;
  // What an absent date reads as. Only the End block can be absent.
  emptyLabel?: string;
  // Present makes this block able to hold "ongoing": the shortcut button appears
  // while editing, and a typed "still ongoing" is accepted.
  onChooseOngoing?: () => void;
  onCommitMs: (ms: number, precision: Precision) => void;
  onCommitPrecision: (precision: Precision) => void;
  refuseOngoing?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Set when the field is closed by something other than blur. Removing a
  // focused input can still fire a blur, and that late commit would parse the
  // half-typed text and overwrite the value the user just chose.
  const closedRef = useRef(false);

  const openEditor = () => {
    closedRef.current = false;
    // An ongoing end starts empty rather than pre-filled: the shortcut button is
    // right there to put it back, and typing a real date is the far likelier
    // reason to have opened the field.
    setText(value ? formatByPrecision(value) : "");
    setError(null);
    setEditing(true);
  };

  const closeEditor = () => {
    closedRef.current = true;
    setEditing(false);
    setError(null);
  };

  const commit = () => {
    if (closedRef.current) return;
    const parsed = parseDateInput(text);
    if (parsed.kind === "date") {
      onCommitMs(parsed.ms, parsed.precision);
      closeEditor();
      return;
    }
    if (parsed.kind === "ongoing") {
      if (refuseOngoing || !onChooseOngoing) {
        setError(refuseOngoing ?? ACCEPTED_DATE_FORMATS_HINT);
        return;
      }
      onChooseOngoing();
      closeEditor();
      return;
    }
    // The value is left untouched and the field stays open with a hint — never
    // a silent no-op.
    setError(ACCEPTED_DATE_FORMATS_HINT);
  };

  return (
    <div className="date-block">
      <div className="date-block-caption">{caption}</div>
      {editing ? (
        <input
          className="date-block-input"
          type="text"
          value={text}
          autoFocus
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
        />
      ) : (
        <button
          type="button"
          className={`date-block-value ${value ? "" : "date-block-value-ongoing"}`}
          disabled={disabled}
          onClick={openEditor}
        >
          {value ? formatByPrecision(value) : (emptyLabel ?? "—")}
        </button>
      )}
      {error && <div className="date-block-error">{error}</div>}

      {editing && onChooseOngoing && (
        <button
          type="button"
          className="date-ongoing-fill"
          // Blur fires before click and would commit — and unmount this button
          // before its own click ever ran. Keeping focus in the field is what
          // makes the shortcut reachable at all.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            onChooseOngoing();
            closeEditor();
          }}
        >
          {ONGOING_TEXT}
        </button>
      )}

      <div className="date-granularity">
        {GRANULARITY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`date-granularity-pick ${value?.precision === option.value ? "date-granularity-pick-on" : ""}`}
            disabled={disabled || value === undefined}
            onClick={() => onCommitPrecision(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
