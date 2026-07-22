// Icon-pill row selector — this project's replacement for dropdowns anywhere
// there are fewer than ~7 options (§6).

export interface PillOption<T extends string> {
  value: T;
  icon: string;
  label: string;
}

interface PillSelectorProps<T extends string> {
  options: PillOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function PillSelector<T extends string>({ options, value, onChange, disabled }: PillSelectorProps<T>) {
  return (
    <div className="pill-row" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          className={`pill ${option.value === value ? "pill-active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          <span className="pill-icon">{option.icon}</span>
          <span className="pill-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
