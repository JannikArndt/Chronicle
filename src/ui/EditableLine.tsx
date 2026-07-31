// Tap the text and it becomes an input; blur or Enter leaves edit mode. There
// is no Save button anywhere in this app — every keystroke is already written
// through, which is also why the canvas repaints while you type.
//
// The pencil is deliberately large enough to notice: a smaller, fainter one
// tested as invisible.

import { useEffect, useState } from "react";

interface EditableLineProps {
  className: string;
  value: string;
  placeholder: string;
  readOnly: boolean;
  autoFocus?: boolean;
  onCommit: (value: string) => void;
}

export function EditableLine({
  className,
  value,
  placeholder,
  readOnly,
  autoFocus,
  onCommit,
}: EditableLineProps) {
  const [editing, setEditing] = useState(autoFocus === true);
  const [text, setText] = useState(value);

  // A different entry or row can be selected while this line is mounted; its
  // own in-flight edit must not leak onto the new one.
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);

  if (readOnly) return <span className={className}>{value || placeholder}</span>;

  if (editing) {
    return (
      <input
        className={`editable-input ${className}`}
        type="text"
        value={text}
        placeholder={placeholder}
        autoFocus
        onChange={(event) => {
          setText(event.target.value);
          onCommit(event.target.value);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
      />
    );
  }

  return (
    <button type="button" className={`editable-line ${className}`} onClick={() => setEditing(true)}>
      <span className={value ? "" : "editable-placeholder"}>{value || placeholder}</span>
      <span className="editable-pencil" aria-hidden="true">
        ✎
      </span>
    </button>
  );
}
