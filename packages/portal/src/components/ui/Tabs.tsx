export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name for the tablist — say what is being filtered. */
  label: string;
}

export function Tabs({ items, value, onChange, label }: TabsProps) {
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = items.findIndex((t) => t.id === value);
    if (i === -1) return;
    const step = e.key === "ArrowRight" ? 1 : -1;
    const next = items[(i + step + items.length) % items.length];
    onChange(next.id);
  }

  return (
    <div className="ui-tabs" role="tablist" aria-label={label} onKeyDown={handleKeyDown}>
      {items.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`ui-tab${selected ? " ui-tab-active" : ""}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
            {t.count !== undefined && <span className="ui-tab-count">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
