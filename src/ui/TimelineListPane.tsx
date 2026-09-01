// The first pane of the timeline sheet: every timeline, grouped.
//
// Rendered from the same computeLayout() result the canvas paints from, so the
// list can never drift from what is on screen. Groups are section headers — an
// early flat list read as "where did my grouping go".

import type { Layout } from "../render/layout";
import { mergedDataset, useAppState } from "../state/store";

export function TimelineListPane({
  layout,
  onOpenRow,
  onAddTimeline,
}: {
  layout: Layout;
  onOpenRow: (rowId: string) => void;
  onAddTimeline: () => void;
}) {
  const state = useAppState((s) => s);
  const merged = mergedDataset(state);
  const hidden = new Set(state.hiddenRowIds);

  return (
    <>
      {layout.items.map((item) => {
        if (item.kind === "group") {
          return (
            <div key={item.id} className="sheet-section">
              {item.group?.label}
            </div>
          );
        }
        if (item.kind === "subgroup") {
          return (
            <div key={item.id} className="sheet-subsection">
              {item.group?.label}
            </div>
          );
        }
        const row = item.row!;
        // Everything on this timeline, spans and moments alike: a row holding
        // five events and no entries is not an empty timeline, and a bare "0"
        // beside it said it was.
        const count =
          merged.entries.filter((entry) => entry.rowId === row.id).length +
          merged.events.filter((event) => event.rowId === row.id).length;
        return (
          <button
            key={row.id}
            type="button"
            className={`sheet-row ${hidden.has(row.id) ? "sheet-row-hidden" : ""}`}
            style={{ paddingLeft: 8 + item.depth * 14 }}
            onClick={() => onOpenRow(row.id)}
          >
            <span className="sheet-row-emoji">{row.icon ?? "🏷️"}</span>
            <span className="sheet-row-label">{row.label}</span>
            <span className="sheet-row-count">{count}</span>
            <span className="sheet-chevron">›</span>
          </button>
        );
      })}
      {/* At the foot of the list, where "and one more" belongs. A whole
          timeline is a bigger thing than one entry, which is why it is here
          rather than behind the ＋ that adds entries. */}
      <button type="button" className="sheet-add-row" onClick={onAddTimeline}>
        ＋ New timeline
      </button>
    </>
  );
}
