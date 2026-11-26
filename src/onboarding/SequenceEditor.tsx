// The first-run editor for "one thing after another": places, education,
// work, partners. Two views of one draft — the Strip (a bar from birth to now
// with a draggable dot at every boundary) for a few items, the List (one row
// per item, drag ≡ to reorder) for many. The model is `sequence.ts`; this
// component edits a draft and writes nothing — the assistant commits on Next.
//
// Reordering moves names, never dates, in both views; a gap holds time and is
// never saved.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { PlaceAutocompleteInput } from "./PlaceAutocompleteInput";
import { formatSuggestionText } from "./nominatim";
import type { PlaceSuggestion } from "./nominatim";
import {
  addItem,
  ageTicks,
  describeLength,
  itemLength,
  itemName,
  knobsOf,
  knobValue,
  moveItem,
  removeItem,
  renameItem,
  setItemStart,
  setKnob,
  spansOf,
  staggerKnobs,
  toggleEnd,
} from "./sequence";
import type { AddOptions, Knob, Sequence, SequencePlace } from "./sequence";
import { describeEnd, describeStart } from "./lifeTopics";
import type { AddChip, LifeTopic } from "./lifeTopics";
import { PillSelector } from "../ui/PillSelector";

interface SequenceEditorProps {
  topic: LifeTopic;
  sequence: Sequence;
  onChange: (next: Sequence) => void;
  birthYear: number;
  age: number; // year age: this year − birth year
  span: number; // years from the start of the birth year to now, with the fraction
  chips?: AddChip[]; // in place of the topic's own (education: by school system)
  chipsNote?: string | null; // why these chips, under them
  firstStart?: number; // where the first item starts, over its chip's typical start
}

type View = "strip" | "list";

const VIEW_OPTIONS = [
  { value: "strip" as const, icon: "▭", label: "Strip" },
  { value: "list" as const, icon: "☰", label: "List" },
];

const LIST_HINT = "≡ drag to reorder · ‹ › move a date";
const REORDERED = "Reordered. The dates stayed put.";
const NO_ROOM = "No room left. Move a date first.";

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

function suggestionToPlace(suggestion: PlaceSuggestion): SequencePlace {
  return {
    title: suggestion.title,
    subtitle: suggestion.subtitle,
    details: {
      fullName: suggestion.fullName,
      coordinates: { lat: Number(suggestion.lat), lon: Number(suggestion.lon) },
      street: suggestion.street,
      city: suggestion.city,
      country: suggestion.country,
    },
  };
}

export function SequenceEditor({
  topic,
  sequence,
  onChange,
  birthYear,
  age,
  span,
  chips,
  chipsNote,
  firstStart,
}: SequenceEditorProps) {
  const [view, setView] = useState<View>("strip");
  const [bubble, setBubble] = useState("");
  const [showEarly, setShowEarly] = useState(false);
  const { rules } = topic;

  // Work and partners rarely start before 16, and fifteen empty years squeeze
  // a three-year job into a sliver. The strip starts there unless asked —
  // or unless something already starts earlier.
  const firstAt = sequence.items[0]?.at;
  const canCrop = topic.lateStart !== undefined && age > topic.lateStart + 4;
  const from = canCrop && !showEarly ? Math.min(topic.lateStart!, firstAt ?? topic.lateStart!) : 0;
  const pct = (at: number) => `${((clamp(at, from, span) - from) / (span - from)) * 100}%`;

  const describeIndex = (next: Sequence, index: number): string => {
    const item = next.items[index];
    if (!item) return "";
    return `${describeStart(topic, itemName(item), item.at, index, birthYear)} · ${describeLength(itemLength(next, index, age))}`;
  };

  const describeKnob = (next: Sequence, knob: Knob): string => {
    if (knob.kind !== "end") return describeIndex(next, knob.index);
    if (next.end === null) return "";
    const last = next.items.length - 1;
    return `${describeEnd(next.end, birthYear)} · ${itemName(next.items[last])}, ${describeLength(itemLength(next, last, age))}`;
  };

  const add = (options: AddOptions) => {
    const start = sequence.items.length === 0 && firstStart !== undefined ? firstStart : options.start;
    const next = addItem(sequence, rules, age, { ...options, start });
    if (!next) {
      setBubble(NO_ROOM);
      return false;
    }
    onChange(next);
    setBubble(describeIndex(next, next.items.length - 1));
    return true;
  };

  const switchView = (next: View) => {
    setView(next);
    setBubble(next === "list" ? LIST_HINT : "");
  };

  const hasItems = sequence.items.length > 0;

  return (
    <div className="seq" style={{ "--seq": topic.color } as CSSProperties}>
      <div className="seq-head">
        <PillSelector options={VIEW_OPTIONS} value={view} onChange={switchView} />
        {rules.endable && hasItems && (
          <button
            type="button"
            className="seq-mini"
            aria-pressed={sequence.end === null}
            onClick={() => onChange(toggleEnd(sequence, rules, age))}
          >
            ▸ {topic.still}
          </button>
        )}
      </div>

      <div className="seq-bubble" aria-live="polite">
        {bubble || " "}
      </div>

      {view === "strip" ? (
        <Strip
          topic={topic}
          sequence={sequence}
          onChange={onChange}
          age={age}
          span={span}
          birthYear={birthYear}
          from={from}
          pct={pct}
          onDescribe={(next, knob) => setBubble(describeKnob(next, knob))}
        />
      ) : (
        <List
          topic={topic}
          sequence={sequence}
          onChange={onChange}
          age={age}
          birthYear={birthYear}
          onReordered={() => setBubble(REORDERED)}
        />
      )}

      {view === "strip" && canCrop && (
        <button type="button" className="onboarding-link seq-early" onClick={() => setShowEarly(!showEarly)}>
          {showEarly ? `Start the strip at ${topic.lateStart}` : `◂ Show from birth`}
        </button>
      )}
      {view === "strip" && sequence.items.length > 6 && (
        <div className="seq-crowd">
          That's a lot for one strip.{" "}
          <button type="button" onClick={() => switchView("list")}>
            Switch to the list
          </button>
        </div>
      )}

      <Adder topic={topic} chips={chips ?? topic.chips} onAdd={add} autoFocus={!hasItems} />
      {chipsNote && <div className="seq-note">{chipsNote}</div>}
    </div>
  );
}

// ---------- strip ----------

interface StripProps {
  topic: LifeTopic;
  sequence: Sequence;
  onChange: (next: Sequence) => void;
  age: number;
  span: number;
  birthYear: number;
  from: number; // the age at the strip's left edge (0, or 16 when cropped)
  pct: (at: number) => string;
  onDescribe: (next: Sequence, knob: Knob) => void;
}

function Strip({ topic, sequence, onChange, age, span, birthYear, from, pct, onDescribe }: StripProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const { rules } = topic;

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const observer = new ResizeObserver(() => setBarWidth(bar.clientWidth));
    observer.observe(bar);
    setBarWidth(bar.clientWidth);
    return () => observer.disconnect();
  }, []);

  const spans = spansOf(sequence);
  const knobs = knobsOf(sequence, rules);
  const toPixels = (at: number) => ((clamp(at, from, span) - from) / (span - from)) * barWidth;
  const low = staggerKnobs(knobs.map((knob) => toPixels(knobValue(sequence, knob))));
  const ticks = ageTicks(span, from);
  const dragged = dragging !== null ? knobs[dragging] : undefined;
  const draggedValue = dragged ? knobValue(sequence, dragged) : 0;
  let shade = 0;

  const moveKnob = (knob: Knob, value: number) => {
    const next = setKnob(sequence, rules, age, knob, value);
    onChange(next);
    onDescribe(next, knob);
  };

  return (
    <div className="seq-strip">
      {dragged && (
        // Where the finger can't hide it: over the age axis, above the dot.
        <div className="seq-tip" style={{ left: `clamp(28px, ${pct(draggedValue)}, calc(100% - 28px))` }}>
          {birthYear + draggedValue}
          <small>{draggedValue}</small>
        </div>
      )}
      <div className="seq-ticks" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ left: pct(t) }}>
            {t}
          </span>
        ))}
        <span style={{ left: "100%" }}>{age}</span>
      </div>
      <div className={`seq-bar ${from > 0 ? "seq-bar-cropped" : ""}`} ref={barRef}>
        {spans.map((segment, index) => {
          const last = index === spans.length - 1;
          const classes = ["seq-seg"];
          if (segment.gap) classes.push("seq-seg-gap");
          else if (shade++ % 2 === 1) classes.push("seq-seg-alt");
          if (index === 0) classes.push("seq-seg-first");
          if (last) classes.push("seq-seg-last");
          if (last && segment.to === null && !segment.gap) classes.push("seq-seg-ongoing");
          const to = segment.to ?? span;
          return (
            <div
              key={sequence.items[index].key}
              className={classes.join(" ")}
              style={{ left: pct(segment.from), width: `calc(${pct(to)} - ${pct(segment.from)})` }}
            >
              {segment.name}
            </div>
          );
        })}
        {knobs.map((knob, index) => {
          const key = knob.kind === "end" ? "end" : `${knob.kind}-${knob.index}`;
          const value = knobValue(sequence, knob);
          const label =
            knob.kind === "end" ? "End" : `Start of ${itemName(sequence.items[knob.index])}`;
          return (
            <div
              key={key}
              role="slider"
              tabIndex={0}
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={age}
              aria-valuenow={value}
              aria-valuetext={`${value} · ${birthYear + value}`}
              className={`seq-knob ${low[index] ? "seq-knob-low" : ""} ${dragging === index ? "seq-knob-active" : ""}`}
              style={{ left: pct(value) }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging(index);
                onDescribe(sequence, knob);
                event.preventDefault();
              }}
              onPointerMove={(event) => {
                if (dragging !== index || !barRef.current) return;
                const rect = barRef.current.getBoundingClientRect();
                const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
                const next = Math.round(from + fraction * (span - from));
                if (next !== value) moveKnob(knob, next);
              }}
              onPointerUp={() => setDragging(null)}
              onPointerCancel={() => setDragging(null)}
              onKeyDown={(event) => {
                const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (step === 0) return;
                event.preventDefault();
                moveKnob(knob, value + step);
              }}
            >
              {knob.kind === "start" ? "◂" : knob.kind === "end" ? "▸" : "↔"}
            </div>
          );
        })}
      </div>
      <div className="seq-ticks seq-ticks-years" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ left: pct(t) }}>
            {birthYear + t}
          </span>
        ))}
        <span style={{ left: "100%" }}>now</span>
      </div>
    </div>
  );
}

// ---------- list ----------

interface ListProps {
  topic: LifeTopic;
  sequence: Sequence;
  onChange: (next: Sequence) => void;
  age: number;
  birthYear: number;
  onReordered: () => void;
}

interface RowDrag {
  index: number;
  startY: number;
  dy: number;
  target: number;
  step: number;
}

function List({ topic, sequence, onChange, age, birthYear, onReordered }: ListProps) {
  const [drag, setDrag] = useState<RowDrag | null>(null);
  const { rules } = topic;
  const count = sequence.items.length;

  const reorder = (from: number, to: number) => {
    if (from !== to) {
      onChange(moveItem(sequence, from, to));
      onReordered();
    }
  };

  const shiftFor = (index: number): number => {
    if (!drag) return 0;
    if (index === drag.index) return drag.dy;
    if (drag.index < drag.target && index > drag.index && index <= drag.target) return -drag.step;
    if (drag.index > drag.target && index >= drag.target && index < drag.index) return drag.step;
    return 0;
  };

  const last = sequence.items[count - 1];

  return (
    <div className="seq-list">
      {sequence.items.map((item, index) => {
        const fixedStart = index === 0 && !rules.freeStart;
        return (
          <div
            key={item.key}
            className={`seq-row ${item.gap ? "seq-row-gap" : ""} ${drag?.index === index ? "seq-row-dragging" : ""}`}
            style={{ transform: drag ? `translateY(${shiftFor(index)}px)` : undefined }}
          >
            <span
              className="seq-handle"
              role="button"
              tabIndex={0}
              aria-label={`Move ${itemName(item)}`}
              onPointerDown={(event) => {
                const row = event.currentTarget.parentElement;
                event.currentTarget.setPointerCapture(event.pointerId);
                setDrag({ index, startY: event.clientY, dy: 0, target: index, step: (row?.offsetHeight ?? 40) + 6 });
                event.preventDefault();
              }}
              onPointerMove={(event) => {
                if (!drag || drag.index !== index) return;
                const dy = event.clientY - drag.startY;
                setDrag({ ...drag, dy, target: clamp(index + Math.round(dy / drag.step), 0, count - 1) });
              }}
              onPointerUp={() => {
                if (!drag || drag.index !== index) return;
                const target = drag.target;
                setDrag(null);
                reorder(index, target);
              }}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(event) => {
                const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
                if (step === 0) return;
                event.preventDefault();
                reorder(index, clamp(index + step, 0, count - 1));
              }}
            >
              ≡
            </span>
            <input
              className="seq-name"
              value={item.gap ? "" : item.label}
              readOnly={item.gap}
              placeholder={item.gap ? "Gap · creates nothing" : item.fallback || topic.noun}
              aria-label={`${topic.noun} ${index + 1}`}
              onChange={(event) => onChange(renameItem(sequence, index, event.target.value))}
            />
            <Stepper
              disabled={fixedStart}
              top={fixedStart ? "from birth" : `from ${item.at}`}
              bottom={String(birthYear + item.at)}
              onStep={(step) => onChange(setItemStart(sequence, rules, age, index, item.at + step))}
            />
            <button
              type="button"
              className="seq-remove"
              aria-label={`Remove ${itemName(item)}`}
              onClick={() => onChange(removeItem(sequence, rules, age, index))}
            >
              ✕
            </button>
          </div>
        );
      })}
      {rules.endable && last && (
        <div className="seq-end">
          {sequence.end === null ? (
            <>
              <span>▸ {topic.still}</span>
              <button type="button" className="seq-mini" onClick={() => onChange(toggleEnd(sequence, rules, age))}>
                Set an end
              </button>
            </>
          ) : (
            <>
              <span>🏁 Ended</span>
              <Stepper
                top={`at ${sequence.end}`}
                bottom={String(birthYear + sequence.end)}
                onStep={(step) => onChange(setKnob(sequence, rules, age, { kind: "end" }, (sequence.end ?? 0) + step))}
              />
              <button type="button" className="seq-mini" onClick={() => onChange(toggleEnd(sequence, rules, age))}>
                {topic.still}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stepper({
  top,
  bottom,
  onStep,
  disabled = false,
}: {
  top: string;
  bottom: string;
  onStep: (step: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seq-stepper">
      <button type="button" aria-label="Earlier" disabled={disabled} onClick={() => onStep(-1)}>
        ‹
      </button>
      <span>
        {top}
        <small>{bottom}</small>
      </span>
      <button type="button" aria-label="Later" disabled={disabled} onClick={() => onStep(1)}>
        ›
      </button>
    </div>
  );
}

// ---------- adding ----------

function Adder({
  topic,
  chips,
  onAdd,
  autoFocus,
}: {
  topic: LifeTopic;
  chips: AddChip[] | undefined;
  onAdd: (options: AddOptions) => boolean;
  autoFocus: boolean;
}) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<PlaceSuggestion | null>(null);
  // The place search confirms a pick ~450ms after the click; by then `text`
  // in this render's closure is stale, so the pick travels through a ref.
  const pickedRef = useRef<PlaceSuggestion | null>(null);

  if (chips) {
    return (
      <div className="seq-chips">
        {chips.map((chip) => (
          <button
            key={chip.text}
            type="button"
            className="seq-chip"
            onClick={() =>
              onAdd({
                label: chip.label,
                fallback: chip.label || topic.noun,
                length: chip.length,
                start: chip.start,
                gap: chip.gap,
              })
            }
          >
            ＋ {chip.icon} {chip.text}
          </button>
        ))}
      </div>
    );
  }

  const adder = topic.textAdder!;
  const submit = (suggestion: PlaceSuggestion | null = null) => {
    const label = (suggestion ? suggestion.title : text).trim();
    if (label === "") return;
    const place = suggestion ? suggestionToPlace(suggestion) : undefined;
    if (onAdd({ label, fallback: label, length: 2, place })) {
      setText("");
      setPicked(null);
      pickedRef.current = null;
    }
  };

  // Not a <form>: the place field already submits on Enter itself, and an
  // implicit form submit on top of that would add the place twice.
  const addTyped = () => submit(picked && formatSuggestionText(picked) === text ? picked : null);

  return (
    <div className="seq-add">
      {topic.withPlace ? (
        <PlaceAutocompleteInput
          autoFocus={autoFocus}
          value={text}
          onChange={(value) => {
            setText(value);
            if (pickedRef.current && value !== formatSuggestionText(pickedRef.current)) {
              pickedRef.current = null;
              setPicked(null);
            }
          }}
          onSelect={(suggestion) => {
            pickedRef.current = suggestion;
            setPicked(suggestion);
          }}
          onAfterSelect={() => submit(pickedRef.current)}
          onSubmit={addTyped}
        />
      ) : (
        <input
          autoFocus={autoFocus}
          value={text}
          placeholder={adder.placeholder}
          autoComplete="off"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && addTyped()}
        />
      )}
      <button type="button" onClick={addTyped}>
        Add
      </button>
      {adder.gapLength !== undefined && (
        <button
          type="button"
          onClick={() => onAdd({ label: "", fallback: "", length: adder.gapLength!, gap: true })}
        >
          ⏸ Gap
        </button>
      )}
    </div>
  );
}
