// Adding a whole timeline, not one entry at a time: name it, give it a look,
// then fill it in as a live table.
//
// This is the plural case the app is really about — "Bands I played in",
// "Places I lived", "Schools I went to" — where a step-per-entry wizard would
// be exhausting and where remembering the fourth band routinely corrects the
// second. So the last step follows PlacesTable, not the entry assistant: every
// row is editable at once, writes happen as you type, and there is no Back
// past that point because editing a row *is* the correction.
//
// It also follows PlacesTable's two hard-won rules — the row array lives in a
// ref and is mutated by plain functions, never inside a setState updater
// (React may run those twice and write an entry twice), and every commit reads
// rowsRef.current rather than a captured closure.

import { useReducer, useRef, useState } from "react";
import { AssistantStepShell } from "./AssistantStepShell";
import { useAssistantFlow } from "./useAssistantFlow";
import { entryDatesFromYearText } from "./timelineEntryRows";
import { DEFAULT_ITEM_NOUN, TIMELINE_SUGGESTIONS, suggestionFor } from "./timelineSuggestions";
import { addEntry, addRow, deleteEntryWithCascade, updateEntry, updateRow } from "../state/actions";
import { appStore, isPublicId } from "../state/store";

type Phase = "name" | "look" | "entries";

// The same quick picks the timeline settings pane offers, so a timeline made
// here and one edited there can't end up from different palettes.
const ROW_COLOR_PICKS = ["#b45309", "#4f6fa8", "#7c6aa6", "#3f7d54", "#a8433b", "#8a7a2f"];
const ROW_ICON_PICKS = ["💼", "🏠", "❤️", "🎓", "✈️", "🎨", "⚽", "🐕", "🎸", "🚗", "📚", "📺"];

interface AddTimelineAssistantProps {
  onFinished: () => void;
  // Called with the new timeline's id once it exists, so the shell can open it.
  onShowTimeline?: (rowId: string) => void;
}

export function AddTimelineAssistant({ onFinished, onShowTimeline }: AddTimelineAssistantProps) {
  const flow = useAssistantFlow<Phase>("name");
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState(ROW_ICON_PICKS[0]);
  const [color, setColor] = useState(ROW_COLOR_PICKS[0]);
  // Set the moment the table opens: the table writes entries, and entries need
  // a row to sit on. This is the flow's one mid-flight commit, which is exactly
  // why the table step has no Back button.
  const [rowId, setRowId] = useState<string | null>(null);

  const itemNoun = suggestionFor(label)?.itemNoun ?? DEFAULT_ITEM_NOUN;

  const chooseSuggestion = (suggestionLabel: string) => {
    setLabel(suggestionLabel);
    const suggestion = suggestionFor(suggestionLabel);
    if (suggestion) setIcon(suggestion.icon);
  };

  const openTable = () => {
    const group = ownGroup();
    if (!group) return;
    const created = addRow(group.id, label.trim(), group.personId, icon);
    updateRow(created, { color });
    setRowId(created);
    flow.advance("entries");
  };

  const finish = () => {
    if (rowId && onShowTimeline) onShowTimeline(rowId);
    else onFinished();
  };

  switch (flow.phase) {
    case "name":
      return (
        <AssistantStepShell
          prompt="What do you want to keep track of?"
          hint="A whole strand of your life — you'll fill it in next."
          stepIndex={flow.stepIndex}
          onSkip={onFinished}
          skipLabel="Cancel"
        >
          <div className="suggestion-row">
            {TIMELINE_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                className={`suggestion ${label === suggestion.label ? "suggestion-on" : ""}`}
                onClick={() => chooseSuggestion(suggestion.label)}
              >
                {suggestion.icon} {suggestion.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={label}
            placeholder="Or name your own…"
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && label.trim() !== "") flow.advance("look");
            }}
          />
          <button
            type="button"
            className="small-button small-button-primary"
            disabled={label.trim() === ""}
            onClick={() => flow.advance("look")}
          >
            Next →
          </button>
        </AssistantStepShell>
      );

    case "look":
      return (
        <AssistantStepShell
          prompt="How should it look?"
          hint="This is how you'll recognise it on the timeline."
          stepIndex={flow.stepIndex}
          onBack={flow.back}
          onSkip={onFinished}
          skipLabel="Cancel"
        >
          <div className="timeline-preview-chip" style={{ borderColor: color }}>
            <span className="timeline-preview-icon">{icon}</span>
            <span className="timeline-preview-label">{label.trim()}</span>
            <span className="timeline-preview-bar" style={{ background: color }} />
          </div>
          <div className="pick-row">
            {ROW_ICON_PICKS.map((option) => (
              <button
                key={option}
                type="button"
                className={`icon-pick ${icon === option ? "icon-pick-selected" : ""}`}
                onClick={() => setIcon(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="pick-row">
            {ROW_COLOR_PICKS.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={`Colour ${option}`}
                className={`color-dot ${color === option ? "color-dot-selected" : ""}`}
                style={{ background: option }}
                onClick={() => setColor(option)}
              />
            ))}
          </div>
          <button type="button" className="small-button small-button-primary" onClick={openTable}>
            Next →
          </button>
        </AssistantStepShell>
      );

    case "entries":
      return (
        <AssistantStepShell
          prompt={`What goes on “${label.trim()}”?`}
          hint="Leave the end year empty if it's still going. Add as few or as many as you like."
          stepIndex={flow.stepIndex}
          onSkip={finish}
          skipLabel="Done"
        >
          {rowId && <EntryTable rowId={rowId} itemNoun={itemNoun} onFinished={finish} />}
        </AssistantStepShell>
      );
  }
}

// The user's own group to hang the new timeline off. Public groups are
// read-only, so they are never a destination.
function ownGroup() {
  const { dataset } = appStore.getState();
  const selfGroup = dataset.groups.find((group) => group.personId === dataset.selfPersonId);
  return selfGroup ?? dataset.groups.find((candidate) => !isPublicId(candidate.id));
}

interface EntryRow {
  key: string;
  title: string;
  fromText: string;
  toText: string;
  entryId?: string;
}

// Every row live at once, saving as you type. See the file header for why the
// rows live in a ref rather than in state.
function EntryTable({
  rowId,
  itemNoun,
  onFinished,
}: {
  rowId: string;
  itemNoun: string;
  onFinished: () => void;
}) {
  const rowKeyCounter = useRef(0);
  const rowsRef = useRef<EntryRow[]>([{ key: "entry-0", title: "", fromText: "", toText: "" }]);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  // The only place rowsRef is written, so the ref and the rendered UI never
  // drift apart.
  const applyRows = (next: EntryRow[]): void => {
    rowsRef.current = next;
    forceRender();
  };

  const editRow = (index: number, patch: Partial<EntryRow>): void => {
    applyRows(rowsRef.current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const withTrailingBlankRow = (rows: EntryRow[]): EntryRow[] => {
    const last = rows[rows.length - 1];
    if (last && last.title.trim() === "") return rows;
    rowKeyCounter.current += 1;
    return [...rows, { key: `entry-${rowKeyCounter.current}`, title: "", fromText: "", toText: "" }];
  };

  // A plain function reading rowsRef.current, never a setState updater — React
  // may run those more than once, which here would mean writing an entry twice.
  const commitRow = (index: number): void => {
    const rows = rowsRef.current;
    const row = rows[index];
    if (!row) return;
    const title = row.title.trim();

    // Clearing the title is how a row is deleted — the same gesture PlacesTable
    // uses, so there is one way to undo an entry across the whole app.
    if (title === "") {
      if (!row.entryId) return;
      deleteEntryWithCascade(row.entryId);
      applyRows(withTrailingBlankRow(rows.filter((_, i) => i !== index)));
      return;
    }

    const dates = entryDatesFromYearText(row.fromText, row.toText);
    if (!dates) {
      // A title with no usable year yet: nothing to save, but the row stays so
      // the year can still be typed.
      if (row.entryId) updateEntry(row.entryId, { title });
      applyRows(withTrailingBlankRow(rows));
      return;
    }

    if (row.entryId) {
      updateEntry(row.entryId, { title, start: dates.start, end: dates.end });
      applyRows(withTrailingBlankRow(rows));
      return;
    }
    const entryId = addEntry({ rowId, title, start: dates.start, end: dates.end });
    applyRows(withTrailingBlankRow(rows.map((r, i) => (i === index ? { ...r, entryId } : r))));
  };

  const finish = (): void => {
    // Flush whichever field was last edited: blur commits on the way out in
    // every other case, but Enter or a tap on Done from mid-edit must not lose
    // that row. Re-reads the length each time, since commitRow can append.
    for (let i = 0; i < rowsRef.current.length; i++) commitRow(i);
    onFinished();
  };

  const rows = rowsRef.current;

  return (
    <div className="entry-table">
      <div className="entry-table-header" aria-hidden="true">
        <span>{itemNoun}</span>
        <span>From</span>
        <span>To</span>
      </div>
      {rows.map((row, index) => (
        <div className="entry-table-row" key={row.key}>
          <input
            className="entry-table-title"
            value={row.title}
            placeholder={itemNoun}
            onChange={(event) => editRow(index, { title: event.target.value })}
            onBlur={() => commitRow(index)}
            // Return commits by blurring rather than by ending the whole flow —
            // you are part-way through one row, not finished with the timeline.
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
          <input
            className="entry-table-year"
            value={row.fromText}
            placeholder="Year"
            inputMode="numeric"
            onChange={(event) => editRow(index, { fromText: event.target.value })}
            onBlur={() => commitRow(index)}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
          <input
            className="entry-table-year"
            value={row.toText}
            placeholder="Still"
            inputMode="numeric"
            onChange={(event) => editRow(index, { toText: event.target.value })}
            onBlur={() => commitRow(index)}
            onKeyDown={(event) => event.key === "Enter" && finish()}
          />
        </div>
      ))}
      <button type="button" className="small-button small-button-primary" onClick={finish}>
        Done
      </button>
    </div>
  );
}
