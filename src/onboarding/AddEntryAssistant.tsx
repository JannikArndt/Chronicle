// Adding something on mobile: six chips, then three questions, and it's on the
// timeline — as a bar if it lasted, as a pin if it was a moment. Big targets,
// and the whole thing can be added without ever opening the keyboard: the
// suggestions, the sliders and the chips cover every answer.
//
// It reuses the onboarding primitives (AssistantStepShell, useAssistantFlow)
// because this *is* the app's conversational-input idiom, and it commits only
// on the last step, so Back never crosses a commit boundary.

import { useState } from "react";
import { previewBar, previewPin } from "./entryPreviewBar";
import { ENTRY_CATEGORIES, rowsForCategory } from "./addEntryCategories";
import type { EntryCategory } from "./addEntryCategories";
import { AssistantStepShell } from "./AssistantStepShell";
import { useAssistantFlow } from "./useAssistantFlow";
import {
  MONTH_LABELS,
  answerFromMs,
  answerMs,
  clampDay,
  daysInMonth,
  formatAnswer,
  toFuzzyDate,
} from "./dateAnswer";
import type { DateAnswer, DateCertainty, DateGranularity } from "./dateAnswer";
import type { FuzzyDate, TimelineEntry, TimelineEvent, TimelineRow } from "../model/types";
import { addEntry, addEvent, addRow } from "../state/actions";
import { appStore, isPublicId } from "../state/store";

type Phase = "category" | "name" | "row" | "start" | "shape" | "done";

// What is being added, decided on the shape step. A moment is an event — a pin
// rather than a bar — and it is offered here rather than as a separate flow
// because "was this a stretch of time or a single day?" is the same question
// "does it still go on?" was already asking, with one more answer.
type Shape = "ongoing" | "ended" | "moment";

// How sure the answer is. The wording is the feedback: nobody has to learn what
// "circa" means, they just pick how sure they are. What each one does to the
// stored date depends on the granularity too — see dateAnswer.ts.
const CERTAINTY_OPTIONS: { key: DateCertainty; label: string; icon: string }[] = [
  { key: "exact", label: "Exactly", icon: "📍" },
  { key: "around", label: "Around then", icon: "〰️" },
  { key: "vague", label: "Sometime around", icon: "🌫️" },
];

const GRANULARITY_OPTIONS: { key: DateGranularity; label: string }[] = [
  { key: "year", label: "Year" },
  { key: "month", label: "Month" },
  { key: "day", label: "Day" },
];

// The lane the preview bar is drawn in, when the user's birth year is unknown.
const FALLBACK_LIFETIME_YEARS = 60;

type RowChoice = { kind: "existing"; rowId: string } | { kind: "new" };

interface AddEntryAssistantProps {
  onFinished: () => void;
  // Set when the flow was started from a timeline that already exists: the
  // "what kind of thing" and "which timeline" questions are already answered,
  // so they are not asked.
  startOnRowId?: string;
  // Where that timeline currently reaches to, as the year to open the slider on.
  startMs?: number;
  // Which answer the shape step opens on. "＋ Add an event" on a timeline is
  // this flow with the moment already picked — still shown, and still
  // changeable, because it is one step either way.
  startShape?: Shape;
  // Called by "Done" with what was just created, so the shell can move the
  // canvas to it. Without these you add something and never see it.
  onShowEntry?: (entryId: string) => void;
  onShowEvent?: (eventId: string) => void;
}

export function AddEntryAssistant({
  onFinished,
  startOnRowId,
  startMs,
  startShape = "ongoing",
  onShowEntry,
  onShowEvent,
}: AddEntryAssistantProps) {
  const firstPhase: Phase = startOnRowId === undefined ? "category" : "name";
  const flow = useAssistantFlow<Phase>(firstPhase);
  const nowMs = Date.now();
  const currentYear = new Date(nowMs).getUTCFullYear();
  const firstYear = firstYearOnTheAxis(currentYear);

  const [category, setCategory] = useState<EntryCategory | null>(null);
  const [title, setTitle] = useState("");
  // What the flow made, once it has. The kind decides which "show me" the shell
  // is handed — a pin and a bar are found in different arrays.
  const [created, setCreated] = useState<{ kind: "entry" | "event"; id: string } | null>(null);
  const [rowChoice, setRowChoice] = useState<RowChoice | null>(
    startOnRowId === undefined ? null : { kind: "existing", rowId: startOnRowId },
  );
  const [start, setStart] = useState<DateAnswer>(() =>
    answerFromMs(startMs ?? Date.UTC(Math.round((firstYear + currentYear) / 2), 6, 1)),
  );
  // One certainty for the whole thing, as before: "how sure are you" is asked
  // once and applies to both ends. Granularity is per date, because knowing the
  // day you started somewhere and only the year you left is ordinary.
  const [certainty, setCertainty] = useState<DateCertainty>("exact");
  const [shape, setShape] = useState<Shape>(startShape);
  const [end, setEnd] = useState<DateAnswer>(() => answerFromMs(nowMs));

  const startDate = toFuzzyDate(start, certainty);
  const endDate = toFuzzyDate(notBefore(end, start), certainty);
  const pendingEntry = buildEntry({ title, startDate, endDate, shape });
  const pendingEvent: Omit<TimelineEvent, "id" | "rowId"> = {
    title: title.trim() || "Untitled",
    date: startDate,
  };

  // The chosen category decides where this goes — but only when it decides it
  // unambiguously. One matching timeline is used silently; none or several is a
  // question, never a guess.
  const goToTargetOrAsk = (chosen: EntryCategory) => {
    const candidates = rowsForCategory(ownRows(), chosen);
    if (candidates.length === 1) {
      setRowChoice({ kind: "existing", rowId: candidates[0].id });
      flow.advance("start");
      return;
    }
    if (candidates.length === 0 && ownRows().length === 0) {
      setRowChoice({ kind: "new" });
      flow.advance("start");
      return;
    }
    flow.advance("row");
  };

  // A flow that already knows its timeline has nothing left to ask about where
  // this goes, so it skips straight to when it happened.
  const canLeaveNameStep = (): boolean =>
    title.trim() !== "" && (startOnRowId !== undefined || category !== null);

  const leaveNameStep = () => {
    if (!canLeaveNameStep()) return;
    if (startOnRowId !== undefined) flow.advance("start");
    else if (category) goToTargetOrAsk(category);
  };

  const commitAndFinish = () => {
    const rowId = resolveRowId(rowChoice, category);
    if (!rowId) return; // Nowhere to put it — the picker below always offers a row.
    setCreated(
      shape === "moment"
        ? { kind: "event", id: addEvent(rowId, pendingEvent.title, pendingEvent.date) }
        : { kind: "entry", id: addEntry({ ...pendingEntry, rowId }) },
    );
    flow.advance("done");
  };

  // Ending the flow on the thing you made rather than on an empty canvas. Falls
  // back to plain dismissal when the host has nothing to show it with.
  const finishAndShow = () => {
    if (created?.kind === "entry" && onShowEntry) onShowEntry(created.id);
    else if (created?.kind === "event" && onShowEvent) onShowEvent(created.id);
    else onFinished();
  };

  const startOver = () => {
    setCategory(null);
    setTitle("");
    setCreated(null);
    // A flow started from a timeline stays on that timeline — "add another"
    // there means another one of these, not another one of anything.
    setRowChoice(startOnRowId === undefined ? null : { kind: "existing", rowId: startOnRowId });
    setCertainty("exact");
    setShape(startShape);
    flow.advance(firstPhase);
  };

  const preview = (
    <PreviewStrip
      entry={shape === "moment" ? undefined : pendingEntry}
      date={shape === "moment" ? startDate : undefined}
      firstYear={firstYear}
      lastYear={currentYear + 1}
      nowMs={nowMs}
    />
  );

  switch (flow.phase) {
    case "category":
      return (
        <AssistantStepShell
          prompt="What do you want to remember?"
          hint="It lands on your timeline as a bar, or as a pin if it was a moment."
          stepIndex={flow.stepIndex}
          onSkip={onFinished}
          skipLabel="Cancel"
        >
          <div className="category-grid">
            {ENTRY_CATEGORIES.map((option) => (
              <button
                key={option.key}
                type="button"
                className="category-chip"
                onClick={() => {
                  setCategory(option);
                  flow.advance("name");
                }}
              >
                <span className="category-chip-icon">{option.icon}</span>
                <span className="category-chip-label">{option.label}</span>
                <span className="category-chip-description">{option.description}</span>
              </button>
            ))}
          </div>
        </AssistantStepShell>
      );

    case "name":
      return (
        <AssistantStepShell
          prompt={category?.nameQuestion ?? "What do you want to add here?"}
          hint={category ? "Tap a suggestion or type your own." : undefined}
          stepIndex={flow.stepIndex}
          onBack={flow.stepIndex === 0 ? undefined : flow.back}
          onSkip={onFinished}
          skipLabel="Cancel"
        >
          {/* No category means the timeline was chosen first, and the canned
              suggestions of some other category would only mislead. */}
          {category && (
            <div className="suggestion-row">
              {category.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className={`suggestion ${title === suggestion ? "suggestion-on" : ""}`}
                  onClick={() => setTitle(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <input
            type="text"
            value={title}
            placeholder={category ? "Or type it…" : "Name it…"}
            autoFocus={category === null}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") leaveNameStep();
            }}
          />
          <button
            type="button"
            className="small-button"
            disabled={!canLeaveNameStep()}
            onClick={leaveNameStep}
          >
            Next →
          </button>
        </AssistantStepShell>
      );

    case "row":
      return (
        <AssistantStepShell
          prompt="Which timeline should it go on?"
          stepIndex={flow.stepIndex}
          onBack={flow.back}
          onSkip={onFinished}
          skipLabel="Cancel"
        >
          <div className="row-choice-list">
            {ownRows().map((row) => (
              <button
                key={row.id}
                type="button"
                className="row-choice"
                onClick={() => {
                  setRowChoice({ kind: "existing", rowId: row.id });
                  flow.advance("start");
                }}
              >
                <span>{row.icon ?? "🏷️"}</span> {row.label}
              </button>
            ))}
            <button
              type="button"
              className="row-choice row-choice-new"
              onClick={() => {
                setRowChoice({ kind: "new" });
                flow.advance("start");
              }}
            >
              ＋ New timeline “{category?.newRowLabel}”
            </button>
          </div>
        </AssistantStepShell>
      );

    case "start":
      return (
        <AssistantStepShell
          // A moment has no start, it just happened — and the flow can already
          // know that, when it was opened by "add an event".
          prompt={shape === "moment" ? "When was it?" : "When did it start?"}
          hint="Roughly is fine — fuzzy edges are part of the picture."
          stepIndex={flow.stepIndex}
          onBack={flow.back}
          onSkip={onFinished}
          skipLabel="Cancel"
        >
          <DateAnswerField
            answer={start}
            firstYear={firstYear}
            lastYear={currentYear}
            caption={ageCaption(start.year)}
            onChange={setStart}
          />
          {/* Two different questions, and the flow used to fold them into one:
              how much of the date is known, and how sure you are of it. */}
          <div className="answer-caption">How sure are you?</div>
          <div className="vagueness-row">
            {CERTAINTY_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`vagueness ${option.key === certainty ? "vagueness-on" : ""}`}
                onClick={() => setCertainty(option.key)}
              >
                <span>{option.icon}</span>
                {option.label}
              </button>
            ))}
          </div>
          {preview}
          <button type="button" className="small-button" onClick={() => flow.advance("shape")}>
            Next →
          </button>
        </AssistantStepShell>
      );

    case "shape":
      return (
        <AssistantStepShell
          prompt="How long did it last?"
          hint={
            shape === "moment"
              ? "A moment is pinned to its date — it appears as you zoom in."
              : shape === "ended"
                ? "The bar runs from when it started to when it stopped."
                : "Ongoing things grow with you — the bar keeps moving."
          }
          stepIndex={flow.stepIndex}
          onBack={flow.back}
          onSkip={onFinished}
          skipLabel="Cancel"
        >
          <div className="vagueness-row">
            <button
              type="button"
              className={`vagueness ${shape === "ongoing" ? "vagueness-on" : ""}`}
              onClick={() => setShape("ongoing")}
            >
              <span>→</span> Still ongoing
            </button>
            <button
              type="button"
              className={`vagueness ${shape === "ended" ? "vagueness-on" : ""}`}
              onClick={() => {
                setShape("ended");
                setEnd(notBefore(end, start));
              }}
            >
              <span>⏹</span> It ended
            </button>
            {/* The third answer, and the one that changes what is created: a
                moment is an event, drawn as a pin rather than a bar. */}
            <button
              type="button"
              className={`vagueness ${shape === "moment" ? "vagueness-on" : ""}`}
              onClick={() => setShape("moment")}
            >
              <span>◆</span> It was a moment
            </button>
          </div>
          {shape === "ended" && (
            <DateAnswerField
              answer={end}
              firstYear={start.year}
              lastYear={currentYear}
              caption="when it ended"
              onChange={(next) => setEnd(notBefore(next, start))}
            />
          )}
          {preview}
          <button type="button" className="small-button" onClick={commitAndFinish}>
            Add it →
          </button>
        </AssistantStepShell>
      );

    case "done":
      return (
        <AssistantStepShell
          prompt={`“${title}” is on your timeline`}
          hint={
            created?.kind === "event"
              ? "Pinned to its date — zoom in and it appears. Saved on this device only."
              : "Saved on this device only — nothing leaves your phone unless you export it."
          }
          stepIndex={flow.stepIndex}
          onSkip={onFinished}
          skipLabel="Close"
        >
          {preview}
          <div className="assistant-actions">
            <button type="button" className="small-button small-button-primary" onClick={finishAndShow}>
              Done
            </button>
            <button type="button" className="small-button" onClick={startOver}>
              Add another
            </button>
          </div>
        </AssistantStepShell>
      );
  }

  // The list of the user's own timelines. Public rows are read-only, so they
  // are never a place to put something.
  function ownRows(): TimelineRow[] {
    return appStore.getState().dataset.rows.filter((row) => !isPublicId(row.id));
  }

  function ageCaption(year: number): string {
    const birthMs = selfGroup()?.birthDate;
    if (birthMs === undefined) return "";
    const age = year - new Date(birthMs).getUTCFullYear();
    if (age < 0) return "before you were born";
    return age === 0 ? "the year you were born" : `you were ${age}`;
  }

  function firstYearOnTheAxis(lastYear: number): number {
    const birthMs = selfGroup()?.birthDate;
    if (birthMs === undefined) return lastYear - FALLBACK_LIFETIME_YEARS;
    return new Date(birthMs).getUTCFullYear();
  }
}

function selfGroup() {
  const { dataset } = appStore.getState();
  return dataset.groups.find((group) => group.id === dataset.selfGroupId);
}

// Turns the answers into the entry that will be written. Kept separate from the
// steps so the preview and the commit can never show different things.
function buildEntry({
  title,
  startDate,
  endDate,
  shape,
}: {
  title: string;
  startDate: FuzzyDate;
  endDate: FuzzyDate;
  shape: Shape;
}): Omit<TimelineEntry, "id" | "rowId"> {
  return {
    title: title.trim() || "Untitled",
    start: startDate,
    // A moment never reaches this function's output — it becomes an event —
    // but the preview asks for an entry until the moment is chosen, and an
    // ongoing shape is simply one with no end.
    ...(shape === "ended" ? { end: endDate } : {}),
  };
}

// An end can never sit before its start — compared on the anchored instants,
// because a "2014" answer stands in July and would otherwise pass a raw
// year-month-day comparison against a start in November of the same year.
//
// When it does sit before, the end becomes the start outright, granularity and
// all: keeping a coarser granularity would just re-anchor it back into the past.
// Same instant, and the slider is right there to drag it forward.
function notBefore(end: DateAnswer, start: DateAnswer): DateAnswer {
  return answerMs(end) >= answerMs(start) ? end : { ...start };
}

// Creating the row is deferred to here, the moment of commit, for the same
// reason the entry is: backing out of the flow must leave nothing behind.
function resolveRowId(choice: RowChoice | null, category: EntryCategory | null): string | undefined {
  if (choice?.kind === "existing") return choice.rowId;
  if (choice?.kind !== "new" || !category) return undefined;
  const { dataset } = appStore.getState();
  const own = dataset.groups.find((group) => group.id === dataset.selfGroupId);
  const group = own ?? dataset.groups.find((candidate) => !isPublicId(candidate.id));
  if (!group) return undefined;
  return addRow(group.id, category.newRowLabel, category.icon);
}

// One date, answered without a keyboard: a year slider, then — if the answer is
// finer than a year — twelve month chips and a day slider. The granularity row
// is what the flow was missing: it used to ask only for a year, so "exactly"
// could only ever mean "exactly this year".
function DateAnswerField({
  answer,
  firstYear,
  lastYear,
  caption,
  onChange,
}: {
  answer: DateAnswer;
  firstYear: number;
  lastYear: number;
  caption: string;
  onChange: (answer: DateAnswer) => void;
}) {
  // Changing year or month can strand the day past the end of the new month —
  // a 31st dragged into February — so every change re-clamps it.
  const withDay = (next: DateAnswer): DateAnswer => ({
    ...next,
    day: clampDay(next.year, next.monthIndex, next.day),
  });

  return (
    <div className="date-answer">
      <div className="year-readout">{formatAnswer(answer)}</div>
      {caption && <div className="year-caption">{caption}</div>}

      <div className="granularity-row">
        {GRANULARITY_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`granularity ${option.key === answer.granularity ? "granularity-on" : ""}`}
            onClick={() => onChange({ ...answer, granularity: option.key })}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Named, because two bare sliders one above the other say nothing about
          which is which. */}
      <label className="answer-slider-row">
        <span className="answer-slider-label">Year</span>
        <input
          type="range"
          min={firstYear}
          max={lastYear}
          step={1}
          value={Math.min(Math.max(answer.year, firstYear), lastYear)}
          onChange={(event) => onChange(withDay({ ...answer, year: Number(event.target.value) }))}
        />
      </label>

      {answer.granularity !== "year" && (
        <div className="month-row">
          {MONTH_LABELS.map((month, index) => (
            <button
              key={month}
              type="button"
              className={`month-pick ${index === answer.monthIndex ? "month-pick-on" : ""}`}
              onClick={() => onChange(withDay({ ...answer, monthIndex: index }))}
            >
              {month}
            </button>
          ))}
        </div>
      )}

      {answer.granularity === "day" && (
        <label className="answer-slider-row">
          <span className="answer-slider-label">Day</span>
          <input
            type="range"
            min={1}
            max={daysInMonth(answer.year, answer.monthIndex)}
            step={1}
            value={clampDay(answer.year, answer.monthIndex, answer.day)}
            onChange={(event) => onChange({ ...answer, day: Number(event.target.value) })}
          />
        </label>
      )}
    </div>
  );
}

// The same mark the canvas will paint, before it exists: a bar whose edges
// visibly blur as the answer gets vaguer, or — for a moment — the pin and its
// precision band. Showing the actual shape is the whole point of asking that way.
function PreviewStrip({
  entry,
  date,
  firstYear,
  lastYear,
  nowMs,
}: {
  entry: Omit<TimelineEntry, "id" | "rowId"> | undefined;
  date: FuzzyDate | undefined;
  firstYear: number;
  lastYear: number;
  nowMs: number;
}) {
  const range = { startMs: Date.UTC(firstYear, 0, 1), endMs: Date.UTC(lastYear, 0, 1) };
  const color = "var(--color-accent)";
  const pin = date ? previewPin(date, range) : undefined;
  const bar = entry ? previewBar({ ...entry, id: "preview", rowId: "preview" }, range, nowMs) : undefined;
  return (
    <div className="preview-strip">
      <div className="preview-caption">Your timeline</div>
      <div className="preview-lane">
        {bar && (
          <span
            className="preview-bar"
            style={{
              left: `${bar.leftPercent}%`,
              width: `${bar.widthPercent}%`,
              // One gradient for the whole bar, never a solid rect butted against
              // a gradient one — the same rule the canvas renderer follows.
              background: `linear-gradient(to right, transparent 0%, ${color} ${bar.solidStartPercent}%, ${color} ${bar.solidEndPercent}%, ${bar.ongoing ? color : "transparent"} 100%)`,
            }}
          />
        )}
        {pin && (
          <>
            <span
              className="preview-band"
              style={{ left: `${pin.bandLeftPercent}%`, width: `${pin.bandWidthPercent}%` }}
            />
            <span className="preview-pin" style={{ left: `${pin.leftPercent}%` }} />
          </>
        )}
      </div>
      <div className="preview-axis">
        <span>{firstYear}</span>
        <span>now</span>
      </div>
    </div>
  );
}
