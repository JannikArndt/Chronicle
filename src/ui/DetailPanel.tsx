// The one detail panel (§1): viewing and editing are the same surface, no
// modal create screen, no Save/Cancel — every field change autosaves (§6).

import { useEffect, useState } from "react";
import { collectEntryCascade, describeCascade } from "../model/cascade";
import { faviconUrl } from "../model/favicon";
import { formatFuzzyDate } from "../model/fuzzyDate";
import type { Place, TimelineEntry } from "../model/types";
import { clearSelection, deleteEntryWithCascade, updateEntry, updateRow } from "../state/actions";
import { appStore, isPublicId, mergedDataset, useAppState } from "../state/store";
import { DateField } from "./DateField";
import { PillSelector } from "./PillSelector";
import type { PillOption } from "./PillSelector";
import { PlaceAutocompleteInput } from "../onboarding/PlaceAutocompleteInput";
import { formatSuggestionText } from "../onboarding/nominatim";
import type { PlaceSuggestion } from "../onboarding/nominatim";

const VISIBILITY_OPTIONS: PillOption<"private" | "shareable">[] = [
  { value: "private", icon: "🔒", label: "private" },
  { value: "shareable", icon: "🔗", label: "shareable" },
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
        <label className="field-label">Subtitle</label>
        <input
          type="text"
          value={entry.subtitle ?? ""}
          disabled={readOnly}
          onChange={(event) => change({ subtitle: event.target.value || undefined })}
        />
      </div>

      <div className="field">
        <label className="field-label">Short title</label>
        <input
          type="text"
          value={entry.shortTitle ?? ""}
          disabled={readOnly}
          placeholder="Shown on the bar when the full title doesn't fit"
          onChange={(event) => change({ shortTitle: event.target.value || undefined })}
        />
      </div>

      <div className="field">
        <label className="field-label">Website</label>
        <div className="field-with-icon">
          {entry.website && faviconUrl(entry.website, 16) && (
            <img className="favicon-preview" src={faviconUrl(entry.website, 16)} alt="" width={16} height={16} />
          )}
          <input
            type="text"
            value={entry.website ?? ""}
            placeholder="example.com"
            disabled={readOnly}
            onChange={(event) => change({ website: event.target.value || undefined })}
          />
        </div>
      </div>

      <div className="field">
        <label className="field-label">Place</label>
        <PlaceField entry={entry} readOnly={readOnly} change={change} />
      </div>

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
        <label className="field-label">Visibility</label>
        <PillSelector
          options={VISIBILITY_OPTIONS}
          value={entry.visibility}
          disabled={readOnly}
          onChange={(visibility) => change({ visibility })}
        />
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

// Only one place per entry, so this toggles between a static chip (with a
// clear button) and the search input — unlike the old multi-entity adder,
// there's never both a chip and an input showing at once.
function PlaceField({
  entry,
  readOnly,
  change,
}: {
  entry: TimelineEntry;
  readOnly: boolean;
  change: (patch: Partial<TimelineEntry>) => void;
}) {
  const [text, setText] = useState("");
  const [pendingSuggestion, setPendingSuggestion] = useState<PlaceSuggestion | null>(null);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    const place: Place =
      pendingSuggestion && formatSuggestionText(pendingSuggestion) === trimmed
        ? {
            fullName: pendingSuggestion.fullName,
            coordinates: { lat: Number(pendingSuggestion.lat), lon: Number(pendingSuggestion.lon) },
            street: pendingSuggestion.street,
            city: pendingSuggestion.city,
            country: pendingSuggestion.country,
          }
        : { fullName: trimmed };
    change({ place });
    setText("");
    setPendingSuggestion(null);
  };

  if (entry.place) {
    return (
      <div
        className="entity-chip"
        title={[entry.place.street, entry.place.city, entry.place.country].filter(Boolean).join(", ") || undefined}
      >
        <span className="entity-chip-text">📍 {entry.place.fullName}</span>
        {!readOnly && (
          <button
            type="button"
            className="icon-button"
            title="Clear place"
            onClick={() => change({ place: undefined })}
          >
            ✕
          </button>
        )}
      </div>
    );
  }

  if (readOnly) return null;

  return (
    <div className="entity-adder">
      <PlaceAutocompleteInput
        autoFocus={false}
        value={text}
        onChange={(value) => {
          setText(value);
          setPendingSuggestion((prev) => (prev && value !== formatSuggestionText(prev) ? null : prev));
        }}
        onSelect={setPendingSuggestion}
        onSubmit={commit}
        onBlur={commit}
      />
    </div>
  );
}
