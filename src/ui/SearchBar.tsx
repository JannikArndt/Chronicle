// Search + filters (§6): matches emphasize, everything else dims — nothing
// disappears. Outright hiding stays with the rail's checkboxes.

import { useState } from "react";
import { parseDateInput } from "../model/parseDateInput";
import { setFilters, setSearch } from "../state/actions";
import { useAppState } from "../state/store";

export function SearchBar() {
  const search = useAppState((s) => s.search);
  const filters = useAppState((s) => s.filters);
  const dataset = useAppState((s) => s.dataset);
  const publicDatasets = useAppState((s) => s.publicDatasets);
  const [expanded, setExpanded] = useState(false);

  const groups = [...dataset.groups, ...publicDatasets.flatMap((d) => d.groups)];

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="search-bar">
      <div className="search-line">
        <input
          type="search"
          placeholder="Search titles, descriptions, groups, places…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" className="small-button" onClick={() => setExpanded(!expanded)}>
          Filter {expanded ? "▴" : "▾"}
        </button>
      </div>
      {expanded && (
        <div className="filter-panel">
          {groups.length > 0 && (
            <div className="filter-group">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={`pill ${filters.groupIds.includes(group.id) ? "pill-active" : ""}`}
                  onClick={() => setFilters({ ...filters, groupIds: toggle(filters.groupIds, group.id) })}
                >
                  <span className="pill-icon">{group.birthDate === undefined ? "📁" : "🧑"}</span>
                  <span className="pill-label">{group.label}</span>
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
      timeRange:
        start.kind === "date" && end.kind === "date"
          ? { startMs: start.ms, endMs: end.ms }
          : undefined,
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
