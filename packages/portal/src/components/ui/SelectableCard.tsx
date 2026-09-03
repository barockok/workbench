import type { ReactNode } from "react";

export interface SelectableCardProps {
  title: ReactNode;
  description?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function SelectableCard({ title, description, active, disabled, onSelect }: SelectableCardProps) {
  const classes = [
    "ui-selectable-card",
    active && "ui-selectable-card-active",
    disabled && "ui-selectable-card-disabled",
  ]
    .filter(Boolean)
    .join(" ");

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  }

  return (
    <div
      className={classes}
      role="radio"
      aria-checked={!!active}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onSelect}
      onKeyDown={handleKeyDown}
    >
      <div className="ui-selectable-card-title">{title}</div>
      {description && <div className="ui-selectable-card-desc">{description}</div>}
    </div>
  );
}
