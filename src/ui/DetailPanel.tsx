// The one detail panel (§1): viewing and editing are the same surface, no
// modal create screen, no Save/Cancel — every field change autosaves (§6).

import { useEffect, useState } from "react";
import { planEntryInsert } from "../model/autoClose";
import { collectEntryCascade, describeCascade } from "../model/cascade";
import { formatFuzzyDate } from "../model/fuzzyDate";
import type { Entity, TimelineEntry } from "../model/types";
import {
  clearSelection,
  deleteEntryWithCascade,
  ensureEntity,
  updateEntry,
  updateRow,
} from "../state/actions";
import { appStore, isPublicId, mergedDataset, useAppState } from "../state/store";
import { DateField } from "./DateField";
import { PillSelector } from "./PillSelector";
import type { PillOption } from "./PillSelector";

const VISIBILITY_OPTIONS: PillOption<"private" | "shareable">[] = [
  { value: "private", icon: "🔒", label: "private" },
  { value: "shareable", icon: "🔗", label: "shareable" },
];

const CONCURRENCY_OPTIONS: PillOption<"default" | "exclusive" | "concurrent">[] = [
  { value: "default", icon: "↩️", label: "category default" },
  { value: "exclusive", icon: "1️⃣", label: "exclusive" },
  { value: "concurrent", icon: "🔀", label: "concurrent" },
];

const ENTITY_KIND_OPTIONS: PillOption<Entity["kind"]>[] = [
  { value: "person", icon: "🧑", label: "person" },
  { value: "place", icon: "📍", label: "place" },
  { value: "organization", icon: "🏢", label: "org" },
  { value: "object", icon: "📦", label: "object" },
  { value: "other", icon: "✨", label: "other" },
];

export function DetailPanel() {
  const state = useAppState((s) => s);
  const merged = mergedDataset(state);
  const entry: TimelineEntry | undefined =
    state.draft ?? merged.entries.find((e) => e.id === state.selectedEntryId);

  // A committed pick-on-timeline result lands here and is written into the
  // armed field together with its precision (§6).
  useEffect(() => {
    const { pickedDate } = appStore.getState();
    if (!pickedDate || !entry) return;
    updateEntry(entry.id, {
      [pickedDate.field]: { ms: pickedDate.ms, precision: pickedDate.precision },
    });
    appStore.setState({ pickedDate: undefined });
  }, [state.pickedDate, entry]);

  if (!entry) return null;

  const isDraft = state.draft?.id === entry.id;
  const readOnly = isPublicId(entry.id);
  const row = merged.rows.find((r) => r.id === entry.rowId);
  const category = merged.categories.find((c) => c.id === row?.categoryId);
  const privateCategories = state.dataset.categories;
  const change = (patch: Partial<TimelineEntry>) => updateEntry(entry.id, patch);

  // Inline note before an exclusive-row auto-close actually happens (§6).
  const plan = isDraft ? planEntryInsert(state.dataset, entry) : null;

  const linkedEntities = entry.linkedEntityIds
    .map((id) => merged.entities.find((e) => e.id === id))
    .filter((e): e is Entity => !!e);

  return (
    <aside className="detail-panel">
      <div className="detail-header">
        <span className="detail-category">
          {category?.icon} {row?.label}
        </span>
        <button type="button" className="icon-button" title="Close" onClick={clearSelection}>
          ✕
        </button>
      </div>

      <div className="field">
        <label className="field-label">Title</label>
        <input
          type="text"
          value={entry.title}
          placeholder={isDraft ? "Name it to create it…" : "Title"}
          autoFocus={isDraft}
          disabled={readOnly}
          onChange={(event) => change({ title: event.target.value })}
        />
        {isDraft && <div className="hint">Drafts are saved once they have a title.</div>}
      </div>

      {plan?.kind === "autoClose" && <div className="note">{plan.note}</div>}
      {state.conflictMessage && <div className="note note-error">{state.conflictMessage}</div>}

      <DateField
        label="Start"
        field="start"
        value={entry.start}
        disabled={readOnly}
        onChange={(value) => value && change({ start: value })}
      />
      <DateField
        label={entry.end ? "End" : "End — ongoing"}
        field="end"
        value={entry.end}
        allowOngoing
        disabled={readOnly}
        onChange={(value) => change({ end: value })}
      />

      <div className="field">
        <label className="field-label">Description</label>
        <textarea
          rows={3}
          value={entry.description ?? ""}
          disabled={readOnly}
          onChange={(event) => change({ description: event.target.value || undefined })}
        />
      </div>

      <div className="field-pair">
        <div className="field">
          <label className="field-label">Fade in (days)</label>
          <input
            type="number"
            min={0}
            value={entry.fadeInDays ?? 0}
            disabled={readOnly}
            onChange={(event) => change({ fadeInDays: Number(event.target.value) || undefined })}
          />
        </div>
        <div className="field">
          <label className="field-label">Fade out (days)</label>
          <input
            type="number"
            min={0}
            value={entry.fadeOutDays ?? 0}
            disabled={readOnly}
            onChange={(event) => change({ fadeOutDays: Number(event.target.value) || undefined })}
          />
        </div>
      </div>

      {!readOnly && row && privateCategories.length > 0 && (
        <div className="field">
          <label className="field-label">Category (of this row)</label>
          <PillSelector
            options={privateCategories.map((c) => ({ value: c.id, icon: c.icon, label: c.label }))}
            value={row.categoryId}
            onChange={(categoryId) => updateRow(row.id, { categoryId })}
          />
        </div>
      )}

      <div className="field">
        <label className="field-label">Concurrency</label>
        <PillSelector
          options={CONCURRENCY_OPTIONS}
          value={entry.concurrencyOverride ?? "default"}
          disabled={readOnly}
          onChange={(value) =>
            change({ concurrencyOverride: value === "default" ? undefined : value })
          }
        />
      </div>

      <div className="field">
        <label className="field-label">Visibility</label>
        <PillSelector
          options={VISIBILITY_OPTIONS}
          value={entry.visibility}
          disabled={readOnly}
          onChange={(visibility) => change({ visibility })}
        />
      </div>

      <div className="field">
        <label className="field-label">Linked entities</label>
        {linkedEntities.map((entity) => (
          <div key={entity.id} className="entity-chip">
            <span>
              {ENTITY_KIND_OPTIONS.find((o) => o.value === entity.kind)?.icon} {entity.label}
            </span>
            {!readOnly && (
              <button
                type="button"
                className="icon-button"
                title="Unlink"
                onClick={() =>
                  change({ linkedEntityIds: entry.linkedEntityIds.filter((id) => id !== entity.id) })
                }
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {!readOnly && <EntityAdder entry={entry} />}
      </div>

      {!readOnly && !isDraft && (
        <button
          type="button"
          className="danger-button"
          onClick={() => {
            const cascade = collectEntryCascade(state.dataset, entry.id);
            const detail =
              `Delete “${entry.title}” (${formatFuzzyDate(entry.start)})? ` + describeCascade(cascade);
            if (window.confirm(detail)) deleteEntryWithCascade(entry.id);
          }}
        >
          Delete entry…
        </button>
      )}
    </aside>
  );
}

function EntityAdder({ entry }: { entry: TimelineEntry }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<Entity["kind"]>("person");

  const add = () => {
    const trimmed = label.trim();
    if (trimmed === "") return;
    const entity = ensureEntity(trimmed, kind);
    if (!entry.linkedEntityIds.includes(entity.id)) {
      updateEntry(entry.id, { linkedEntityIds: [...entry.linkedEntityIds, entity.id] });
    }
    setLabel("");
  };

  return (
    <div className="entity-adder">
      <input
        type="text"
        value={label}
        placeholder="Link a person, place…"
        onChange={(event) => setLabel(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") add();
        }}
      />
      <PillSelector options={ENTITY_KIND_OPTIONS} value={kind} onChange={setKind} />
      <button type="button" className="small-button" onClick={add} disabled={label.trim() === ""}>
        Link
      </button>
    </div>
  );
}
