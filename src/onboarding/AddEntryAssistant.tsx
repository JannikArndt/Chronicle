// Adding an entry on mobile: six chips, then three questions, then it's on the
// timeline. Big targets, and a whole entry can be added without ever opening
// the keyboard — the suggestions and the two sliders cover every answer.
//
// It reuses the onboarding primitives (AssistantStepShell, useAssistantFlow)
// because this *is* the app's conversational-input idiom, and it commits only
// on the last step, so Back never crosses a commit boundary.

import { useState } from "react";
import { previewBar } from "./entryPreviewBar";
import { ENTRY_CATEGORIES, rowsForCategory } from "./addEntryCategories";
import type { EntryCategory } from "./addEntryCategories";
import { AssistantStepShell } from "./AssistantStepShell";
import { useAssistantFlow } from "./useAssistantFlow";
import type { FuzzyDate, Precision, TimelineEntry, TimelineRow } from "../model/types";
import { addEntry, addRow } from "../state/actions";
import { appStore, isPublicId } from "../state/store";

type Phase = "category" | "name" | "row" | "start" | "ongoing" | "done";

// How precisely the year on the slider is meant. The wording is the feedback:
// nobody has to learn what "circa" means, they just pick how sure they are.
interface Vagueness {
  label: string;
  icon: string;
  precision: Precision;
  fuzzDays?: number;
}

const VAGUENESS_OPTIONS: Vagueness[] = [
  { label: "Exactly", icon: "📍", precision: "year" },
  { label: "Around then", icon: "〰️", precision: "circa" },
  { label: "Sometime around", icon: "🌫️", precision: "circa", fuzzDays: 730 },
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
  // Called by "Done" with the id of the entry just created, so the shell can
  // move the canvas to it. Without this you add something and never see it.
  onShowEntry?: (entryId: string) => void;
}

export function AddEntryAssistant({
  onFinished,
  startOnRowId,
  startMs,
  onShowEntry,
}: AddEntryAssistantProps) {
  const firstPhase: Phase = startOnRowId === undefined ? "category" : "name";
  const flow = useAssistantFlow<Phase>(firstPhase);
  const nowMs = Date.now();
  const currentYear = new Date(nowMs).getUTCFullYear();
  const firstYear = firstYearOnTheAxis(currentYear);

  const [category, setCategory] = useState<EntryCategory | null>(null);
  const [title, setTitle] = useState("");
  const [createdEntryId, setCreatedEntryId] = useState<string | null>(null);
  const [rowChoice, setRowChoice] = useState<RowChoice | null>(
    startOnRowId === undefined ? null : { kind: "existing", rowId: startOnRowId },
  );
  const [startYear, setStartYear] = useState(
    startMs === undefined
      ? Math.round((firstYear + currentYear) / 2)
      : new Date(startMs).getUTCFullYear(),
  );
  const [vagueness, setVagueness] = useState(VAGUENESS_OPTIONS[0]);
  const [ongoing, setOngoing] = useState(true);
  const [endYear, setEndYear] = useState(currentYear);

  const pendingEntry = buildEntry({ title, startYear, vagueness, ongoing, endYear });

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
    setCreatedEntryId(addEntry({ ...pendingEntry, rowId }));
    flow.advance("done");
  };

  // Ending the flow on the thing you made rather than on an empty canvas. Falls
  // back to plain dismissal when the host has nothing to show it with.
  const finishAndShow = () => {
    if (createdEntryId && onShowEntry) onShowEntry(createdEntryId);
    else onFinished();
  };

  const startOver = () => {
    setCategory(null);
    setTitle("");
    setCreatedEntryId(null);
    // A flow started from a timeline stays on that timeline — "add another"
    // there means another one of these, not another one of anything.
    setRowChoice(startOnRowId === undefined ? null : { kind: "existing", rowId: startOnRowId });
    setVagueness(VAGUENESS_OPTIONS[0]);
    setOngoing(true);
    flow.advance(firstPhase);
  };

  const preview = (
    <PreviewStrip entry={pendingEntry} firstYear={firstYear} lastYear={currentYear + 1} nowMs={nowMs} />
  );

  switch (flow.phase) {
    case "category":
      return (
        <AssistantStepShell
          prompt="What do you want to remember?"
          hint="It lands on your timeline as a bar — you can refine it any time."
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
          prompt="When did it start?"
          hint="Roughly is fine — fuzzy edges are part of the picture."
          stepIndex={flow.stepIndex}
          onBack={flow.back}
          onSkip={onFinished}
          skipLabel="Cancel"
        >
          <YearSlider
            year={startYear}
            firstYear={firstYear}
            lastYear={currentYear}
            caption={ageCaption(startYear)}
            onChange={(year) => {
              setStartYear(year);
              if (!ongoing && endYear < year) setEndYear(year);
            }}
          />
          <div className="vagueness-row">
            {VAGUENESS_OPTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                className={`vagueness ${option === vagueness ? "vagueness-on" : ""}`}
                onClick={() => setVagueness(option)}
              >
                <span>{option.icon}</span>
                {option.label}
              </button>
            ))}
          </div>
          {preview}
          <button type="button" className="small-button" onClick={() => flow.advance("ongoing")}>
            Next →
          </button>
        </AssistantStepShell>
      );

    case "ongoing":
      return (
        <AssistantStepShell
          prompt="Is it still part of your life?"
          hint="Ongoing things grow with you — the bar keeps moving."
          stepIndex={flow.stepIndex}
          onBack={flow.back}
          onSkip={onFinished}
          skipLabel="Cancel"
        >
          <div className="vagueness-row">
            <button
              type="button"
              className={`vagueness ${ongoing ? "vagueness-on" : ""}`}
              onClick={() => setOngoing(true)}
            >
              <span>→</span> Still ongoing
            </button>
            <button
              type="button"
              className={`vagueness ${ongoing ? "" : "vagueness-on"}`}
              onClick={() => {
                setOngoing(false);
                setEndYear(Math.max(startYear, endYear));
              }}
            >
              <span>⏹</span> It ended
            </button>
          </div>
          {!ongoing && (
            <YearSlider
              year={endYear}
              firstYear={startYear}
              lastYear={currentYear}
              caption="when it ended"
              onChange={setEndYear}
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
          hint="Saved on this device only — nothing leaves your phone unless you export it."
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
  startYear,
  vagueness,
  ongoing,
  endYear,
}: {
  title: string;
  startYear: number;
  vagueness: Vagueness;
  ongoing: boolean;
  endYear: number;
}): Omit<TimelineEntry, "id" | "rowId"> {
  const asDate = (year: number): FuzzyDate => ({
    ms: Date.UTC(year, 6, 1),
    precision: vagueness.precision,
    ...(vagueness.fuzzDays === undefined ? {} : { fuzzDays: vagueness.fuzzDays }),
  });
  return {
    title: title.trim() || "Untitled",
    start: asDate(startYear),
    ...(ongoing ? {} : { end: asDate(Math.max(endYear, startYear)) }),
  };
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

function YearSlider({
  year,
  firstYear,
  lastYear,
  caption,
  onChange,
}: {
  year: number;
  firstYear: number;
  lastYear: number;
  caption: string;
  onChange: (year: number) => void;
}) {
  return (
    <div className="year-slider">
      <div className="year-readout">{year}</div>
      {caption && <div className="year-caption">{caption}</div>}
      <input
        type="range"
        min={firstYear}
        max={lastYear}
        step={1}
        value={Math.min(Math.max(year, firstYear), lastYear)}
        aria-label="Year"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

// The same bar the canvas will paint, before it exists: the edges visibly blur
// as the answer gets vaguer, which is the whole point of asking that way.
function PreviewStrip({
  entry,
  firstYear,
  lastYear,
  nowMs,
}: {
  entry: Omit<TimelineEntry, "id" | "rowId">;
  firstYear: number;
  lastYear: number;
  nowMs: number;
}) {
  const range = { startMs: Date.UTC(firstYear, 0, 1), endMs: Date.UTC(lastYear, 0, 1) };
  const bar = previewBar({ ...entry, id: "preview", rowId: "preview" }, range, nowMs);
  const color = "var(--color-accent)";
  return (
    <div className="preview-strip">
      <div className="preview-caption">Your timeline</div>
      <div className="preview-lane">
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
      </div>
      <div className="preview-axis">
        <span>{firstYear}</span>
        <span>now</span>
      </div>
    </div>
  );
}
