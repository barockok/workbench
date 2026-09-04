import type { ReactNode } from "react";

export interface Stat {
  label: string;
  value: ReactNode;
}

export function StatStrip({ stats, note }: { stats: Stat[]; note?: ReactNode }) {
  return (
    <section className="ui-box ui-stat-strip">
      <div className="ui-stat-cells">
        {stats.map((s) => (
          <div key={s.label} className="ui-stat">
            <div className="ui-stat-label">{s.label}</div>
            <div className="ui-stat-value">{s.value}</div>
          </div>
        ))}
      </div>
      {note && <div className="ui-stat-note">{note}</div>}
    </section>
  );
}
