// The one detail panel (§1): viewing and editing are the same surface, no
// modal create screen, no Save/Cancel — every field change autosaves (§6).

import { useEffect, useRef, useState } from "react";
import { collectEntryCascade, describeCascade } from "../model/cascade";
import { faviconUrl } from "../model/favicon";
import { formatFuzzyDate } from "../model/fuzzyDate";
import type { Place, TimelineEntry, TimelineEvent } from "../model/types";
import {
  clearSelection,
  deleteEntryWithCascade,
  deleteEvent,
  updateEntry,
  updateEvent,
} from "../state/actions";
import { appStore, isForeignId, mergedDataset, useAppState } from "../state/store";
import { DateField } from "./DateField";
import { PlaceAutocompleteInput } from "../onboarding/PlaceAutocompleteInput";
import { formatSuggestionText } from "../onboarding/nominatim";
import type { PlaceSuggestion } from "../onboarding/nominatim";

// One panel, two kinds of thing on it: the selected entry, or the selected
// event. They are separate components rather than one with branches — an event
// has a single date, no fades, no short title and no ongoing state, and every
// one of those would have been an "unless this is an event" in the middle of a
// field list.
export function DetailPanel() {
  const selectedEventId = useAppState((s) => s.selectedEventId);
  if (selectedEventId !== undefined) return <EventDetail eventId={selectedEventId} />;
  return <EntryDetail />;
}

function EntryDetail() {
  const state = useAppState((s) => s);
  const merged = mergedDataset(state);
  const entry: TimelineEntry | undefined =
    state.draft ?? merged.entries.find((e) => e.id === state.selectedEntryId);

  // A committed pick-on-timeline result lands here and is written into the
  // armed field together with its precision (§6).
  useEffect(() => {
    const { pickedDate } = appStore.getState();
    if (!pickedDate || !entry || pickedDate.field === "date") return;
    updateEntry(entry.id, {
      [pickedDate.field]: { ms: pickedDate.ms, precision: pickedDate.precision },
    });
    appStore.setState({ pickedDate: undefined });
  }, [state.pickedDate, entry]);

  const titleInputRef = useRef<HTMLInputElement>(null);

  // Belt to the engine's `preventDefault` brace: in browsers where a canvas
  // pointerdown still blurs the focused input, the chained start→end pick
  // would otherwise leave the Title field un-focused while the user is
  // mid-type. Scoped to an untitled draft — once the entry has a name the
  // flow is over, and arming the ⌖ crosshair by hand on a saved entry must
  // never yank focus out of whatever field the user was in.
  useEffect(() => {
    if (!state.draft || state.pickingField === undefined) return;
    if (document.activeElement === titleInputRef.current) return;
    titleInputRef.current?.focus();
  }, [state.draft, state.pickingField]);

  if (!entry) return null;

  const isDraft = state.draft?.id === entry.id;
  const readOnly = isForeignId(entry.id);
  const row = merged.rows.find((r) => r.id === entry.rowId);
  const change = (patch: Partial<TimelineEntry>) => updateEntry(entry.id, patch);

  return (
    <aside className="detail-panel">
      <div className="detail-header">
        <span className="detail-category">
          {row?.icon} {row?.label}
        </span>
        <button type="button" className="icon-button" title="Close" onClick={clearSelection}>
          ✕
        </button>
      </div>

      <div className="field">
        <label className="field-label">Title</label>
        <input
          ref={titleInputRef}
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
        <PlaceField
          place={entry.place}
          readOnly={readOnly}
          onChange={(place) => change({ place })}
        />
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

// One moment: a title, an emoji, one date, and a note. Deliberately shorter
// than the entry panel — half of what an entry carries only makes sense for a
// span, and offering an empty "fade out" on a point in time would be a promise
// the renderer cannot keep.
function EventDetail({ eventId }: { eventId: string }) {
  const state = useAppState((s) => s);
  const merged = mergedDataset(state);
  const event: TimelineEvent | undefined = merged.events.find((candidate) => candidate.id === eventId);

  useEffect(() => {
    const { pickedDate } = appStore.getState();
    if (!pickedDate || !event || pickedDate.field !== "date") return;
    updateEvent(event.id, { date: { ms: pickedDate.ms, precision: pickedDate.precision } });
    appStore.setState({ pickedDate: undefined });
  }, [state.pickedDate, event]);

  if (!event) return null;

  const readOnly = isForeignId(event.id);
  const row = merged.rows.find((candidate) => candidate.id === event.rowId);
  const change = (patch: Partial<TimelineEvent>) => updateEvent(event.id, patch);

  return (
    <aside className="detail-panel">
      <div className="detail-header">
        <span className="detail-category">
          {row?.icon} {row?.label}
        </span>
        <button type="button" className="icon-button" title="Close" onClick={clearSelection}>
          ✕
        </button>
      </div>

      <div className="field">
        <label className="field-label">Event</label>
        <div className="field-with-icon">
          <input
            className="emoji-input"
            type="text"
            value={event.icon ?? ""}
            placeholder="🔖"
            aria-label="Event icon"
            disabled={readOnly}
            onChange={(input) => change({ icon: input.target.value || undefined })}
          />
          <input
            type="text"
            value={event.title}
            placeholder="What happened"
            disabled={readOnly}
            onChange={(input) => change({ title: input.target.value })}
          />
        </div>
      </div>

      <DateField
        label="When"
        field="date"
        value={event.date}
        disabled={readOnly}
        onChange={(value) => value && change({ date: value })}
      />

      <div className="field">
        <label className="field-label">Place</label>
        <PlaceField place={event.place} readOnly={readOnly} onChange={(place) => change({ place })} />
      </div>

      <div className="field">
        <label className="field-label">Description</label>
        <textarea
          rows={3}
          value={event.description ?? ""}
          disabled={readOnly}
          onChange={(input) => change({ description: input.target.value || undefined })}
        />
      </div>

      <div className="hint">Events appear on the timeline once you zoom in.</div>

      {!readOnly && (
        <button
          type="button"
          className="danger-button"
          onClick={() => {
            const detail = `Delete “${event.title}” (${formatFuzzyDate(event.date)})?`;
            if (window.confirm(detail)) deleteEvent(event.id);
          }}
        >
          Delete event…
        </button>
      )}
    </aside>
  );
}

// Only one place per record, so this toggles between a static chip (with a
// clear button) and the search input — unlike the old multi-entity adder,
// there's never both a chip and an input showing at once. Takes the place
// itself rather than the entry, because an event has one too.
function PlaceField({
  place: current,
  readOnly,
  onChange,
}: {
  place: Place | undefined;
  readOnly: boolean;
  onChange: (place: Place | undefined) => void;
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
    onChange(place);
    setText("");
    setPendingSuggestion(null);
  };

  if (current) {
    return (
      <div
        className="entity-chip"
        title={[current.street, current.city, current.country].filter(Boolean).join(", ") || undefined}
      >
        <span className="entity-chip-text">📍 {current.fullName}</span>
        {!readOnly && (
          <button type="button" className="icon-button" title="Clear place" onClick={() => onChange(undefined)}>
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
