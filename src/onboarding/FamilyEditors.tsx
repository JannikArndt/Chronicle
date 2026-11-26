// The kids and grandkids screens' editors. No count is asked up front: each
// child is added with "＋ Add a child", named, and given a birth year on a
// slider. Like every first-run screen, they edit a draft and write nothing —
// the assistant reconciles it on Next (`familyRecords.ts`).

import { useState } from "react";
import {
  grandkidLabel,
  grandkidYearRange,
  kidLabel,
  kidYearRange,
  newFamilyKey,
  newGrandkidYear,
  newKidYear,
  removeKid,
} from "./familyRecords";
import type { FamilyDraft, GrandkidDraft, KidDraft } from "./familyRecords";
import { PillSelector } from "../ui/PillSelector";

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

function YearSlider({
  value,
  range,
  label,
  onChange,
}: {
  value: number;
  range: [number, number];
  label: string;
  onChange: (year: number) => void;
}) {
  return (
    <input
      type="range"
      min={range[0]}
      max={range[1]}
      value={clamp(value, range[0], range[1])}
      disabled={range[0] === range[1]}
      aria-label={label}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

interface KidsEditorProps {
  draft: FamilyDraft;
  onChange: (next: FamilyDraft) => void;
  birthYear: number;
  nowYear: number;
  noKids: boolean;
  onNoKids: () => void;
}

export function KidsEditor({ draft, onChange, birthYear, nowYear, noKids, onNoKids }: KidsEditorProps) {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const range = kidYearRange(birthYear, nowYear);
  const updateKid = (key: string, patch: Partial<KidDraft>) =>
    onChange({ ...draft, kids: draft.kids.map((kid) => (kid.key === key ? { ...kid, ...patch } : kid)) });

  const addKid = () => {
    const kid: KidDraft = { key: newFamilyKey(), name: "", year: newKidYear(draft, birthYear, nowYear) };
    setFocusKey(kid.key);
    onChange({ ...draft, kids: [...draft.kids, kid] });
  };

  // "No kids" clears a fresh answer. Kids that are already saved are removed
  // one by one with their ✕, never by a single tap on a pill.
  const anySaved = draft.kids.some((kid) => kid.groupId !== undefined);
  const summary =
    draft.kids.length > 0
      ? `👨‍👩‍👧 Family group · ${draft.kids.map(kidLabel).join(", ")}, each a group with a birth year`
      : noKids
        ? "Nothing to create. On to your timeline."
        : "Add each child, or tap No kids.";

  return (
    <div className="family-editor">
      <div className="family-rows">
        {draft.kids.map((kid, index) => (
          <div className="family-row" key={kid.key}>
            <input
              type="text"
              autoFocus={kid.key === focusKey}
              value={kid.name}
              placeholder={`Child ${index + 1}`}
              aria-label={`Name of child ${index + 1}`}
              onChange={(event) => updateKid(kid.key, { name: event.target.value })}
            />
            <YearSlider
              value={kid.year}
              range={range}
              label={`When child ${index + 1} was born`}
              onChange={(year) => updateKid(kid.key, { year })}
            />
            <button
              type="button"
              className="seq-remove"
              aria-label={`Remove ${kidLabel(kid, index)}`}
              onClick={() => onChange(removeKid(draft, kid.key))}
            >
              ✕
            </button>
            <small>
              👶 born {kid.year} · you were {kid.year - birthYear}
            </small>
          </div>
        ))}
      </div>
      <div className="seq-chips">
        <button type="button" className="seq-chip" onClick={addKid}>
          ＋ Add a child
        </button>
        {!anySaved && (
          <button type="button" className="seq-chip" aria-pressed={noKids && draft.kids.length === 0} onClick={onNoKids}>
            No kids
          </button>
        )}
      </div>
      <div className="family-summary">{summary}</div>
    </div>
  );
}

interface GrandkidsEditorProps {
  draft: FamilyDraft;
  onChange: (next: FamilyDraft) => void;
  nowYear: number;
  none: boolean;
  onNone: () => void;
}

export function GrandkidsEditor({ draft, onChange, nowYear, none, onNone }: GrandkidsEditorProps) {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const kidIndex = new Map(draft.kids.map((kid, index) => [kid.key, index]));
  const parentOf = (grandkid: GrandkidDraft) => draft.kids.find((kid) => kid.key === grandkid.parentKey);
  const update = (key: string, patch: Partial<GrandkidDraft>) =>
    onChange({
      ...draft,
      grandkids: draft.grandkids.map((grandkid) => (grandkid.key === key ? { ...grandkid, ...patch } : grandkid)),
    });

  const add = () => {
    const parent = draft.kids[draft.kids.length - 1];
    if (!parent) return;
    const grandkid: GrandkidDraft = {
      key: newFamilyKey(),
      parentKey: parent.key,
      name: "",
      year: newGrandkidYear(parent.year, nowYear),
    };
    setFocusKey(grandkid.key);
    onChange({ ...draft, grandkids: [...draft.grandkids, grandkid] });
  };

  const options = draft.kids.map((kid, index) => ({ value: kid.key, icon: "👶", label: kidLabel(kid, index) }));
  const anySaved = draft.grandkids.some((grandkid) => grandkid.groupId !== undefined);
  const summary =
    draft.grandkids.length > 0
      ? `🧒 ${draft.grandkids
          .map((grandkid) => {
            const parent = parentOf(grandkid);
            return `${grandkidLabel(grandkid)} in ${parent ? kidLabel(parent, kidIndex.get(parent.key) ?? 0) : "?"}`;
          })
          .join(", ")}`
      : none
        ? "Nothing to create."
        : "Add a grandchild, or tap None.";

  return (
    <div className="family-editor">
      <div className="family-rows">
        {draft.grandkids.map((grandkid, index) => {
          const parent = parentOf(grandkid);
          const parentYear = parent?.year ?? nowYear;
          const parentName = parent ? kidLabel(parent, kidIndex.get(parent.key) ?? 0) : "";
          return (
            <div className="family-row family-row-grandkid" key={grandkid.key}>
              <div className="family-parent" aria-label="Whose child">
                <PillSelector
                  options={options}
                  value={grandkid.parentKey}
                  onChange={(parentKey) => {
                    const newParent = draft.kids.find((kid) => kid.key === parentKey);
                    const [low, high] = grandkidYearRange(newParent?.year ?? nowYear, nowYear);
                    update(grandkid.key, { parentKey, year: clamp(grandkid.year, low, high) });
                  }}
                />
              </div>
              <input
                type="text"
                autoFocus={grandkid.key === focusKey}
                value={grandkid.name}
                placeholder="Name"
                aria-label={`Name of grandchild ${index + 1}`}
                onChange={(event) => update(grandkid.key, { name: event.target.value })}
              />
              <YearSlider
                value={grandkid.year}
                range={grandkidYearRange(parentYear, nowYear)}
                label={`When grandchild ${index + 1} was born`}
                onChange={(year) => update(grandkid.key, { year })}
              />
              <button
                type="button"
                className="seq-remove"
                aria-label={`Remove ${grandkidLabel(grandkid)}`}
                onClick={() =>
                  onChange({ ...draft, grandkids: draft.grandkids.filter((other) => other.key !== grandkid.key) })
                }
              >
                ✕
              </button>
              <small>
                🧒 born {grandkid.year} · {parentName} was {grandkid.year - parentYear}
              </small>
            </div>
          );
        })}
      </div>
      <div className="seq-chips">
        <button type="button" className="seq-chip" onClick={add}>
          ＋ Add a grandchild
        </button>
        {!anySaved && (
          <button type="button" className="seq-chip" aria-pressed={none && draft.grandkids.length === 0} onClick={onNone}>
            None
          </button>
        )}
      </div>
      <div className="family-summary">{summary}</div>
    </div>
  );
}
