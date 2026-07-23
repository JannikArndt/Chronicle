// Free-text input backed by Nominatim suggestions. Never blocks the
// onboarding flow: typing and pressing Enter without picking a suggestion
// (or with the network unavailable) is always a valid answer.

import { useEffect, useRef, useState } from "react";
import { searchPlaces } from "./nominatim";
import type { PlaceSuggestion } from "./nominatim";

interface PlaceAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onSelect: (suggestion: PlaceSuggestion) => void;
}

const DEBOUNCE_MS = 500;

export function PlaceAutocompleteInput({ value, onChange, onSubmit, onSelect }: PlaceAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      searchPlaces(value)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [value]);

  return (
    <div className="place-autocomplete">
      <input
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && onSubmit()}
        placeholder="City, region, or country"
      />
      {suggestions.length > 0 && (
        <ul className="place-suggestions">
          {suggestions.map((suggestion) => (
            <li key={`${suggestion.lat},${suggestion.lon}`}>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  onSelect(suggestion);
                  onChange(suggestion.title);
                  setSuggestions([]);
                }}
              >
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
