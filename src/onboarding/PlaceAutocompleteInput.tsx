// Free-text input backed by Nominatim suggestions. Never blocks the
// onboarding flow: typing and pressing Enter without picking a suggestion
// (or with the network unavailable) is always a valid answer.

import { useEffect, useRef, useState } from "react";
import { searchPlaces, formatSuggestionText } from "./nominatim";
import type { PlaceSuggestion } from "./nominatim";

interface PlaceAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onSelect: (suggestion: PlaceSuggestion) => void;
}

const DEBOUNCE_MS = 500;
// Long enough to register as "the app understood me," short enough not to
// feel laggy before the flow auto-advances past the confirmed pick.
const CONFIRM_AUTO_ADVANCE_MS = 450;

export function PlaceAutocompleteInput({ value, onChange, onSubmit, onSelect }: PlaceAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [confirmedSuggestion, setConfirmedSuggestion] = useState<PlaceSuggestion | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Set the moment a suggestion is selected so the debounce effect below
  // skips the resulting programmatic onChange(formatSuggestionText(...))
  // instead of re-searching the just-picked text.
  const justSelectedRef = useRef(false);

  useEffect(() => {
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }
    clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      searchPlaces(value)
        .then((results) => {
          setSuggestions(results);
          setHighlightedIndex(-1);
        })
        .catch(() => setSuggestions([]));
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [value]);

  // Guards against calling onSubmit after unmount — e.g. the user manually
  // clicks "Skip" during the brief post-selection confirmation window.
  useEffect(() => {
    return () => clearTimeout(autoAdvanceRef.current);
  }, []);

  const selectSuggestion = (suggestion: PlaceSuggestion) => {
    onSelect(suggestion);
    justSelectedRef.current = true;
    onChange(formatSuggestionText(suggestion));
    setSuggestions([]);
    setHighlightedIndex(-1);
    setConfirmedSuggestion(suggestion);
    autoAdvanceRef.current = setTimeout(() => {
      setConfirmedSuggestion(null);
      onSubmit();
    }, CONFIRM_AUTO_ADVANCE_MS);
  };

  const handleTextChange = (text: string) => {
    onChange(text);
    setHighlightedIndex(-1);
    setConfirmedSuggestion(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(index + 1, suggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        selectSuggestion(suggestions[highlightedIndex]);
      } else {
        onSubmit();
      }
    }
  };

  return (
    <div className="place-autocomplete">
      <input
        autoFocus
        value={value}
        onChange={(event) => handleTextChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="City, region, or country"
      />
      {confirmedSuggestion && (
        <div className="place-suggestion-confirmed">📍 {formatSuggestionText(confirmedSuggestion)} ✓</div>
      )}
      {!confirmedSuggestion && suggestions.length > 0 && (
        <ul className="place-suggestions">
          {suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.lat},${suggestion.lon}`}
              className={index === highlightedIndex ? "place-suggestion-highlighted" : undefined}
            >
              <button type="button" className="menu-item" onClick={() => selectSuggestion(suggestion)}>
                <span className="place-suggestion-title">📍 {suggestion.title}</span>
                {suggestion.subtitle && <span className="place-suggestion-subtitle">{suggestion.subtitle}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
