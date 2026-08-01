// The "⋯" overflow menu in a sheet's top-right corner, mirroring the one in the
// app's own top bar. Destructive and rare actions live here rather than at the
// bottom of a scrolling pane, where a thumb reaching for the last list item
// lands on "Remove".
//
// Deliberately flat: a caller that needs a second level (picking a group, say)
// opens its own popover instead, because a nested menu on a phone is a
// mis-tappable target inside a mis-tappable target.

import { useState } from "react";

export interface SheetMenuItem {
  label: string;
  onSelect: () => void;
  // Renders in the danger colour.
  danger?: boolean;
  // Present makes the item a toggle: ticked when true, blank when false. Absent
  // means it is a plain action, which is not the same as `false`.
  checked?: boolean;
}

export function SheetMenu({ items }: { items: SheetMenuItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="sheet-menu-button"
        aria-label="More actions"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="popover-backdrop" onClick={() => setOpen(false)} />
          <div className="sheet-menu">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                className={`menu-item ${item.danger ? "menu-item-danger" : ""}`}
                role={item.checked === undefined ? undefined : "menuitemcheckbox"}
                aria-checked={item.checked}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
                {item.checked && <span className="menu-item-check">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// A one-off list popover anchored the same way the menu is — used where an
// action needs a target chosen before it can run.
export function SheetMenuPicker({
  title,
  options,
  onPick,
  onDismiss,
}: {
  title: string;
  options: { id: string; label: string; current: boolean }[];
  onPick: (id: string) => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <div className="popover-backdrop" onClick={onDismiss} />
      <div className="sheet-menu">
        <div className="sheet-menu-title">{title}</div>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`menu-item ${option.current ? "menu-item-current" : ""}`}
            onClick={() => {
              onPick(option.id);
              onDismiss();
            }}
          >
            {option.label}
            {option.current && <span className="menu-item-check">✓</span>}
          </button>
        ))}
      </div>
    </>
  );
}
