// The first pane of the timeline sheet: every timeline, grouped.
//
// Rendered from the same computeLayout() result the canvas paints from, so the
// list can never drift from what is on screen. Groups are section headers — an
// early flat list read as "where did my grouping go".

import type { Layout } from "../render/layout";
import { mergedDataset, useAppState } from "../state/store";
import { nameIcon } from "../model/favicon";
import { hiddenChildrenEverywhere, hiddenIdsOf } from "../model/hidden";
import { unhideChild } from "../state/actions";
import { NameIcon } from "./NameIcon";

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
  // Hidden timelines and groups are not in the layout at all, so the list
  // cannot show them greyed out — it offers them back at the foot instead,
  // which is the mobile counterpart of the rail's per-container unhide lists.
  const hiddenChildren = hiddenChildrenEverywhere(
    merged,
    hiddenIdsOf(state.hiddenRowIds, state.hiddenGroupIds),
  );

  return (
    <>
      {layout.items.map((item) => {
        if (item.kind === "group") {
          return (
            <div
              key={item.id}
              className={item.depth === 0 ? "sheet-section" : "sheet-subsection"}
              style={{ paddingLeft: item.depth * 14 }}
            >
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
            className="sheet-row"
            style={{ paddingLeft: 8 + item.depth * 14 }}
            onClick={() => onOpenRow(row.id)}
          >
            <span className="sheet-row-emoji">
              {nameIcon(row, 18) === undefined ? "🏷️" : <NameIcon subject={row} size={18} />}
            </span>
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
      {hiddenChildren.map((child) => (
        <button
          key={`${child.kind}:${child.id}`}
          type="button"
          className="sheet-add-row sheet-hidden-row"
          onClick={() => unhideChild({ kind: child.kind, id: child.id })}
        >
          👁 Show {child.kind === "row" ? child.row.label : `${child.group.label} (group)`}
        </button>
      ))}
    </>
  );
}
