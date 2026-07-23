// Places-lived table: unlike the rest of this assistant (one prompt, one
// field, commit-and-advance), this step shows every place as an editable
// row, live, with the timeline updating behind it as you go. Rationale
// (from the user): thinking about a later place often jogs a memory that
// changes an earlier one, and a rigid step-per-place wizard punishes that.
//
// This means rows mutate already-saved entries, not just append new ones —
// the one place in onboarding where that's true. Consistency is kept by a
// single rule, applied on every edit: recompute row N's start from row N-1's
// saved end, and reflow every row after the edited one. No other validation;
// the structural rule that a row only appears once the previous row has a
// saved year keeps the chain well-formed by construction.
//
// State lives in a ref (rowsRef), not directly in useState, and every
// mutation — including the dataset writes in commitRow — happens as a plain
// function, never inside a setState(prev => ...) updater. Two reasons:
// (1) React may invoke updater functions more than once (StrictMode does
// this deliberately in dev to catch impure ones), which would risk writing
// an entry twice; (2) selecting a suggestion defers its "row done" commit by
// ~450ms (see PlaceAutocompleteInput's confirm-then-advance), and reading
// state from a React closure captured at click time would see whatever
// `rows` looked like BEFORE that selection applied. rowsRef.current is
// always the latest value regardless of which render's closure calls it.

import { useReducer, useRef } from "react";
import { PlaceAutocompleteInput } from "./PlaceAutocompleteInput";
import type { PlaceSuggestion } from "./nominatim";
import {
  addOnboardingPlaceEntry,
  deleteEntryWithCascade,
  updateEntry,
  updateOnboardingPlaceEntry,
} from "../state/actions";
import type { OnboardingPlaceAnswer } from "../state/actions";
import { parseDateInput } from "../model/fuzzyDate";
import { appStore } from "../state/store";

export interface PlaceAnswer {
  title: string;
  subtitle?: string;
  fullName: string;
  coordinates?: { lat: number; lon: number };
  street?: string;
  city?: string;
  country?: string;
}

export function formatPlaceAnswerText(place: PlaceAnswer): string {
  return place.subtitle ? `${place.title}, ${place.subtitle}` : place.title;
}

function suggestionToPlaceAnswer(suggestion: PlaceSuggestion): PlaceAnswer {
  return {
    title: suggestion.title,
    subtitle: suggestion.subtitle,
    fullName: suggestion.fullName,
    coordinates: { lat: Number(suggestion.lat), lon: Number(suggestion.lon) },
    street: suggestion.street,
    city: suggestion.city,
    country: suggestion.country,
  };
}

interface PlaceRow {
  key: string;
  placeText: string;
  placeAnswer: PlaceAnswer | null;
  yearText: string;
  entryId?: string;
}

interface PlacesTableProps {
  placesRowId: string;
  birthDateMs: number;
  firstRow: { entryId: string; place: PlaceAnswer; yearText: string };
  onFinished: () => void;
}

export function PlacesTable({ placesRowId, birthDateMs, firstRow, onFinished }: PlacesTableProps) {
  const rowKeyCounter = useRef(2);
  const yearInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const rowsRef = useRef<PlaceRow[]>([
    {
      key: "row-0",
      placeText: formatPlaceAnswerText(firstRow.place),
      placeAnswer: firstRow.place,
      yearText: firstRow.yearText,
      entryId: firstRow.entryId,
    },
    { key: "row-1", placeText: "", placeAnswer: null, yearText: "" },
  ]);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  // The only place rowsRef is written — every mutation funnels through here
  // so the ref and the rendered UI never drift apart.
  const applyRows = (next: PlaceRow[]): PlaceRow[] => {
    rowsRef.current = next;
    forceRender();
    return next;
  };

  const updateRow = (index: number, updater: (row: PlaceRow) => PlaceRow): void => {
    applyRows(rowsRef.current.map((row, i) => (i === index ? updater(row) : row)));
  };

  const startMsForRow = (currentRows: PlaceRow[], index: number): number | undefined => {
    if (index === 0) return birthDateMs;
    const previousEntryId = currentRows[index - 1]?.entryId;
    if (!previousEntryId) return undefined;
    return appStore.getState().dataset.entries.find((e) => e.id === previousEntryId)?.end?.ms;
  };

  const reflowFrom = (currentRows: PlaceRow[], index: number): void => {
    for (let i = index; i < currentRows.length; i++) {
      const row = currentRows[i];
      if (!row.entryId) break;
      const startMs = startMsForRow(currentRows, i);
      if (startMs === undefined) break;
      updateEntry(row.entryId, { start: { ms: startMs, precision: "year" } });
    }
  };

  const ensureTrailingBlankRow = (currentRows: PlaceRow[]): PlaceRow[] => {
    const last = currentRows[currentRows.length - 1];
    if (last?.entryId) {
      rowKeyCounter.current += 1;
      return [...currentRows, { key: `row-${rowKeyCounter.current}`, placeText: "", placeAnswer: null, yearText: "" }];
    }
    return currentRows;
  };

  // Plain function, not a setState updater — see the file header. Always
  // reads/writes rowsRef.current so it's safe to call from a stale closure
  // (e.g. PlaceAutocompleteInput's deferred onAfterSelect).
  const commitRow = (index: number): PlaceRow[] => {
    const currentRows = rowsRef.current;
    const row = currentRows[index];
    if (!row) return currentRows;
    const trimmedPlace = row.placeText.trim();

    if (trimmedPlace === "") {
      if (!row.entryId) return currentRows;
      deleteEntryWithCascade(row.entryId);
      const next = currentRows.filter((_, i) => i !== index);
      reflowFrom(next, index);
      return applyRows(ensureTrailingBlankRow(next));
    }

    const startMs = startMsForRow(currentRows, index);
    if (startMs === undefined) return currentRows;

    const yearText = row.yearText.trim();
    const endParsed = yearText === "" ? null : parseDateInput(yearText);
    const place = row.placeAnswer && formatPlaceAnswerText(row.placeAnswer) === trimmedPlace ? row.placeAnswer : null;
    const answer: OnboardingPlaceAnswer = {
      label: place?.title ?? trimmedPlace,
      startMs,
      endMs: endParsed?.ms,
      subtitle: place?.subtitle,
      fullName: place?.fullName ?? trimmedPlace,
      coordinates: place?.coordinates,
      street: place?.street,
      city: place?.city,
      country: place?.country,
    };

    let entryId = row.entryId;
    if (entryId) {
      updateOnboardingPlaceEntry(entryId, answer);
    } else {
      entryId = addOnboardingPlaceEntry(placesRowId, answer);
    }
    if (!entryId) return currentRows;

    const next = currentRows.map((r, i) => (i === index ? { ...r, entryId } : r));
    reflowFrom(next, index + 1);
    return applyRows(ensureTrailingBlankRow(next));
  };

  const finish = (): void => {
    // Flush whichever field the user was last in — blur already commits on
    // the way out for every other case, but a bare Enter/Finish click from
    // mid-edit shouldn't lose that row's text. Uses rowsRef.current.length
    // freshly each iteration since commitRow can append a trailing row.
    for (let i = 0; i < rowsRef.current.length; i++) commitRow(i);
    onFinished();
  };

  const removeRow = (index: number): void => {
    updateRow(index, (row) => ({ ...row, placeText: "", yearText: "" }));
    commitRow(index);
  };

  const rows = rowsRef.current;

  return (
    <div className="places-table">
      {rows.map((row, index) => {
        const showRemove = row.placeText.trim() !== "" || row.entryId !== undefined;
        return (
          <div className="places-table-row" key={row.key}>
            <PlaceAutocompleteInput
              autoFocus={index === rows.length - 1}
              value={row.placeText}
              onChange={(text) => {
                updateRow(index, (r) => ({
                  ...r,
                  placeText: text,
                  placeAnswer: r.placeAnswer && text !== formatPlaceAnswerText(r.placeAnswer) ? null : r.placeAnswer,
                }));
              }}
              onSelect={(suggestion) => updateRow(index, (r) => ({ ...r, placeAnswer: suggestionToPlaceAnswer(suggestion) }))}
              onAfterSelect={() => {
                commitRow(index);
                yearInputRefs.current[row.key]?.focus();
              }}
              onSubmit={finish}
              onBlur={() => commitRow(index)}
            />
            <input
              ref={(element) => {
                yearInputRefs.current[row.key] = element;
              }}
              className="places-table-year"
              value={row.yearText}
              onChange={(event) => updateRow(index, (r) => ({ ...r, yearText: event.target.value }))}
              onBlur={() => commitRow(index)}
              onKeyDown={(event) => event.key === "Enter" && finish()}
              placeholder="Year"
              inputMode="numeric"
            />
            {showRemove && (
              <button type="button" className="icon-button" title="Remove this place" onClick={() => removeRow(index)}>
                ✕
              </button>
            )}
          </div>
        );
      })}
      <button type="button" className="small-button" onClick={finish}>
        Finish →
      </button>
    </div>
  );
}
