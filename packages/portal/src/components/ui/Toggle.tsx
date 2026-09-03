import type { ReactNode } from "react";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  size?: "sm" | "md";
}

export function Toggle({ checked, onChange, label, disabled, size = "md" }: ToggleProps) {
  return (
    <label className={`ui-toggle ui-toggle-${size} ${disabled ? "ui-toggle-disabled" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={typeof label === "string" ? label : undefined}
        onChange={(e) => !disabled && onChange(e.target.checked)}
      />
      <span className="ui-toggle-track" aria-hidden>
        <span className="ui-toggle-thumb" />
      </span>
      {label && <span className="ui-toggle-label">{label}</span>}
    </label>
  );
}
