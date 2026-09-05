import { Fragment } from "react";
import type { ActivityEvent, IntegrationSummary } from "../api";
import { DataTable } from "./ui/DataTable";
import { dayLabel, timeLabel, durationLabel } from "../format";

// Shared by every page that feeds ActivityTable: map an integration's stable
// name to its display name, falling back to the name itself when the
// registry hasn't loaded or doesn't know it.
export function nameForIntegration(integrations: IntegrationSummary[]): (name: string) => string {
  const map = new Map<string, string>();
  integrations.forEach((i) => map.set(i.name, i.displayName || i.name));
  return (name: string) => map.get(name) ?? name;
}

// Rows arrive newest-first; walk them in order and emit a group header row
// whenever the day changes. No sorting here — the server already ordered them.
function groupByDay(events: ActivityEvent[]): { day: string; events: ActivityEvent[] }[] {
  const groups: { day: string; events: ActivityEvent[] }[] = [];
  for (const e of events) {
    const day = dayLabel(e.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.events.push(e);
    else groups.push({ day, events: [e] });
  }
  return groups;
}

export function ActivityTable({
  events,
  caption,
  nameFor,
}: {
  events: ActivityEvent[];
  caption: string;
  /** Map an integration name to its display name; identity if unknown. */
  nameFor?: (name: string) => string;
}) {
  const label = nameFor ?? ((n: string) => n);

  return (
    <DataTable
      caption={caption}
      head={
        <tr>
          <th scope="col">Time</th>
          <th scope="col">App</th>
          <th scope="col">Tool</th>
          <th scope="col" className="ui-num">Duration</th>
          <th scope="col">Status</th>
        </tr>
      }
    >
      {groupByDay(events).map((g) => (
        <Fragment key={g.day}>
          <tr className="wb-day-row">
            <th scope="colgroup" colSpan={5}>{g.day}</th>
          </tr>
          {g.events.map((e) => (
            <tr key={e.id}>
              <td className="wb-cell-time">{timeLabel(e.created_at)}</td>
              <td>{e.integration ? label(e.integration) : "—"}</td>
              <td>
                <code className="wb-mono">{e.tool ?? "—"}</code>
                {!e.success && e.error && (
                  <div className="wb-cell-error" title={e.error}>{e.error}</div>
                )}
              </td>
              <td className="ui-num">{durationLabel(e.duration_ms)}</td>
              <td>
                <span className={e.success ? "wb-status-ok" : "wb-status-bad"}>
                  <span aria-hidden>{e.success ? "✓" : "✕"}</span> {e.success ? "Succeeded" : "Failed"}
                </span>
              </td>
            </tr>
          ))}
        </Fragment>
      ))}
    </DataTable>
  );
}
