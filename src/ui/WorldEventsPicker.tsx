// Toggle any of the bundled world-events datasets on/off. Nothing shows until
// picked here, so the catalog can grow without cluttering a fresh timeline.
//
// Lives in its own file because both shells offer it — the rail's ＋ menu on
// desktop and the ⋯ menu on mobile — and it was a private component inside
// RowRail.tsx, which is what kept it off phones.

import { loadPublicCatalog } from "../publicData/loader";
import { toggleWorldEvents } from "../state/actions";
import { useAppState } from "../state/store";

export function WorldEventsPicker({ back }: { back?: () => void }) {
  const catalog = loadPublicCatalog();
  const activeKeys = useAppState((s) => s.activeWorldKeys);

  return (
    <div className="popover-form">
      {back && (
        <button type="button" className="menu-item" onClick={back}>
          ◂ Back
        </button>
      )}
      <div className="popover-title">World events</div>
      {catalog.map((item) => (
        <label key={item.key} className="menu-item picker-row">
          <input
            type="checkbox"
            checked={activeKeys.includes(item.key)}
            onChange={() => toggleWorldEvents(item.key)}
          />
          <span>{item.label}</span>
        </label>
      ))}
    </div>
  );
}
