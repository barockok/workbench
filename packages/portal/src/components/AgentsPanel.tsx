import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAgents, revokeAgent, ConnectedAgent } from "../api";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

function rel(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  const d = Date.now() / 1000 - unixSeconds;
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export default function AgentsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const [error, setError] = useState<string | null>(null);

  const revoke = useMutation({
    mutationFn: revokeAgent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
    onError: (e) => setError(e instanceof Error ? e.message : "Revoke failed"),
  });

  const agents: ConnectedAgent[] = data?.agents ?? [];

  function handleRevoke(a: ConnectedAgent) {
    const label = a.client_name || a.client_id;
    if (!window.confirm(`Revoke ${label}? It will stop being able to renew access (an active session may persist up to the access-token lifetime).`)) return;
    setError(null);
    revoke.mutate(a.client_id);
  }

  return (
    <section className="agents-panel">
      <div className="eyebrow"><span className="dot" /> // connected agents ── oauth clients</div>
      {error && <div className="ui-form-error" style={{ margin: "8px 0" }}>ERR — {error}</div>}
      {isLoading ? (
        <p className="card-meta">Loading agents…</p>
      ) : agents.length === 0 ? (
        <p className="card-meta">No agents connected.</p>
      ) : (
        <ul className="agents-list">
          {agents.map((a) => (
            <li key={a.client_id} className="agent-row">
              <div className="agent-id">
                <strong>{a.client_name || a.client_id}</strong>
                <span className="card-meta"> · connected {rel(a.connected_since)}</span>
                {a.scopes.length > 0 && (
                  <div className="integ-tags">
                    {a.scopes.map((s) => <Badge key={s} variant="neutral">{s}</Badge>)}
                  </div>
                )}
              </div>
              <Button
                variant="danger"
                onClick={() => handleRevoke(a)}
                disabled={revoke.isPending}
                title="Revoke this agent"
              >
                {revoke.isPending ? "…" : "Revoke"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="card-meta" style={{ marginTop: 8 }}>
        Revoking stops the agent from renewing access; an in-flight session may keep working until its current token expires.
      </p>
    </section>
  );
}
