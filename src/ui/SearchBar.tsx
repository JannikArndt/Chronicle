// Search + filters (§6): matches emphasize, everything else dims — nothing
// disappears. Outright hiding stays with the rail's checkboxes.

import { useState } from "react";
import { parseDateInput } from "../model/fuzzyDate";
import { setFilters, setSearch } from "../state/actions";
import { useAppState } from "../state/store";

export function SearchBar() {
  const search = useAppState((s) => s.search);
  const filters = useAppState((s) => s.filters);
  const dataset = useAppState((s) => s.dataset);
  const publicDatasets = useAppState((s) => s.publicDatasets);
  const [expanded, setExpanded] = useState(false);

  const categories = [...dataset.categories, ...publicDatasets.flatMap((d) => d.categories)];
  const people = [...dataset.people, ...publicDatasets.flatMap((d) => d.people)];

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="search-bar">
      <div className="search-line">
        <input
          type="search"
          placeholder="Search titles, descriptions, people, places…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" className="small-button" onClick={() => setExpanded(!expanded)}>
          Filter {expanded ? "▴" : "▾"}
        </button>
      </div>
      {expanded && (
        <div className="filter-panel">
          {categories.length > 0 && (
            <div className="filter-group">
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`pill ${filters.categoryIds.includes(category.id) ? "pill-active" : ""}`}
                  onClick={() =>
                    setFilters({ ...filters, categoryIds: toggle(filters.categoryIds, category.id) })
                  }
                >
                  <span className="pill-icon">{category.icon}</span>
                  <span className="pill-label">{category.label}</span>
                </button>
              ))}
            </div>
          )}
          {people.length > 0 && (
            <div className="filter-group">
              {people.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  className={`pill ${filters.personIds.includes(person.id) ? "pill-active" : ""}`}
                  onClick={() => setFilters({ ...filters, personIds: toggle(filters.personIds, person.id) })}
                >
                  <span className="pill-icon">🧑</span>
                  <span className="pill-label">{person.label}</span>
                </button>
              ))}
            </div>
          )}
          <div className="filter-group">
            <TimeRangeFilterInputs />
          </div>
        </div>
      )}
    </div>
  );
}

function TimeRangeFilterInputs() {
  const filters = useAppState((s) => s.filters);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const apply = (fromText: string, toText: string) => {
    const start = parseDateInput(fromText);
    const end = parseDateInput(toText);
    setFilters({
      ...filters,
      timeRange: start && end ? { startMs: start.ms, endMs: end.ms } : undefined,
    });
  };

  return (
    <span className="time-range-filter">
      <input
        type="text"
        placeholder="from (e.g. 2010)"
        value={from}
        onChange={(e) => {
          setFrom(e.target.value);
          apply(e.target.value, to);
        }}
      />
      –
      <input
        type="text"
        placeholder="to"
        value={to}
        onChange={(e) => {
          setTo(e.target.value);
          apply(from, e.target.value);
        }}
      />
    </span>
  );
}
