import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchActivity, fetchIntegrations, type ActivityEvent, type IntegrationSummary } from "../api";
import { PageHeader } from "../components/ui/PageHeader";
import { Box } from "../components/ui/Box";
import { EmptyState } from "../components/ui/EmptyState";
import { Tabs } from "../components/ui/Tabs";
import { Select } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { ActivityTable } from "../components/ActivityTable";

const PAGE_SIZE = 50;

export const UNSTORED_MESSAGE =
  "This deployment sends audit events somewhere other than its database, so there is nothing to show here. Set AUDIT_LOG_DEST=sqlite to record them.";

export default function Activity() {
  const [status, setStatus] = useState<"all" | "error">("all");
  const [integration, setIntegration] = useState("all");
  // Pages already fetched, kept so "Load more" appends rather than replaces.
  const [older, setOlder] = useState<ActivityEvent[]>([]);
  // Three states, and the distinction matters: `undefined` means we have not
  // paged yet, so the cursor to use is whatever the first page returned; a
  // string means we paged and more remains; `null` means we paged and reached
  // the end. Collapsing "not yet paged" into "no rows paged in" would break the
  // ordinary end-of-list case, where the final page comes back empty.
  const [pagedCursor, setPagedCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const filters = useMemo(
    () => ({
      limit: PAGE_SIZE,
      ...(status === "error" ? { status: "error" as const } : {}),
      ...(integration !== "all" ? { integration } : {}),
    }),
    [status, integration]
  );

  // Changing a filter starts a fresh list. Reset the paged-in tail here, in the
  // event handler — not inside queryFn, which must stay a pure fetch: React
  // Query may call it on refetch, retry or remount, and a setState in there
  // fires on every one of those.
  function changeFilter(apply: () => void) {
    apply();
    setOlder([]);
    setPagedCursor(undefined);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["activity", filters],
    queryFn: () => fetchActivity(filters),
  });

  // Until "Load more" is pressed, the cursor to offer is the first page's.
  const nextCursor = pagedCursor === undefined ? (data?.next_cursor ?? null) : pagedCursor;

  const { data: registry } = useQuery({ queryKey: ["integrations"], queryFn: fetchIntegrations });

  const nameFor = useMemo(() => {
    const map = new Map<string, string>();
    ((registry?.integrations ?? []) as IntegrationSummary[]).forEach((i) =>
      map.set(i.name, i.displayName || i.name)
    );
    return (name: string) => map.get(name) ?? name;
  }, [registry]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchActivity({ ...filters, cursor: nextCursor });
      setOlder((prev) => [...prev, ...page.events]);
      setPagedCursor(page.next_cursor);
    } finally {
      setLoadingMore(false);
    }
  }

  const events = [...(data?.events ?? []), ...older];
  const integrations = (registry?.integrations ?? []) as IntegrationSummary[];

  return (
    <>
      <PageHeader
        title="Activity"
        toolbar={
          <>
            <Tabs
              label="Filter activity"
              value={status}
              onChange={(id) => changeFilter(() => setStatus(id as "all" | "error"))}
              items={[{ id: "all", label: "All" }, { id: "error", label: "Errors" }]}
            />
            <div className="wb-toolbar-controls">
              <label className="ui-sr-only" htmlFor="activity-integration">Integration</label>
              <Select
                id="activity-integration"
                value={integration}
                onChange={(e) => changeFilter(() => setIntegration(e.target.value))}
              >
                <option value="all">All apps</option>
                {integrations.map((i) => (
                  <option key={i.name} value={i.name}>{i.displayName || i.name}</option>
                ))}
              </Select>
            </div>
          </>
        }
      />

      <Box>
        {isLoading ? (
          <div className="ui-loading">Loading activity…</div>
        ) : data && !data.stored ? (
          <EmptyState message={UNSTORED_MESSAGE} />
        ) : events.length === 0 ? (
          <EmptyState message="No tool calls recorded yet." />
        ) : (
          <ActivityTable events={events} caption="Tool call history" nameFor={nameFor} />
        )}
      </Box>

      {nextCursor && (
        <div className="wb-load-more">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </>
  );
}
