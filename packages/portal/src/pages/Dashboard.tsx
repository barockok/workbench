import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchIntegrations, fetchConnections, startCookieAuth } from "../api";
import { useAuth } from "../context/AuthContext";
import CookieAuthPopup from "../components/CookieAuthPopup";

interface CookieAuthState {
  integration: string;
  loginUrl: string;
  cdpUrl: string;
  sessionId: string;
}

type Integration = { name: string; version: string };
type Filter = "all" | "connected" | "available";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: fetchIntegrations,
  });
  const { data: connectionsData, refetch: refetchConnections } = useQuery({
    queryKey: ["connections"],
    queryFn: fetchConnections,
  });

  const [cookieAuth, setCookieAuth] = useState<CookieAuthState | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const connectionMap = useMemo(
    () =>
      new Map(
        connectionsData?.connections?.map(
          (c: { name: string; connected: boolean }) => [c.name, c.connected]
        ) ?? []
      ),
    [connectionsData]
  );

  const integrations: Integration[] = data?.integrations ?? [];
  const connectedCount = integrations.filter((i) => connectionMap.get(i.name)).length;
  const availableCount = integrations.length - connectedCount;

  const visible = integrations.filter((i) => {
    const c = connectionMap.get(i.name) ?? false;
    if (filter === "connected") return c;
    if (filter === "available") return !c;
    return true;
  });

  async function handleConnect(integration: string) {
    const integ = integrations.find((i) => i.name === integration);
    if (!integ) return;

    try {
      const result = await startCookieAuth(integration);
      if (result.type === "cookie") {
        setCookieAuth({
          integration,
          loginUrl: result.loginUrl,
          cdpUrl: result.cdpUrl,
          sessionId: result.sessionId,
        });
        return;
      }
    } catch {
      // fall through to OAuth
    }

    window.location.href = `/api/auth/${integration}`;
  }

  if (isLoading) {
    return (
      <div className="boot">
        <span>LOADING REGISTRY<span className="blinker" /></span>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">a-workbench</span>
          <span className="brand-slash">/</span>
          <span className="brand-tag">operator console</span>
        </div>

        <div className="status-strip">
          <span><b>{integrations.length}</b> integrations</span>
          <span className="sep">·</span>
          <span><b>{connectedCount}</b> live</span>
          <span className="sep">·</span>
          <span>node <b>online</b></span>
        </div>

        <div className="user-block">
          {user?.email && <span className="user-email">{user.email}</span>}
          <button onClick={logout} className="btn-ghost">Sign out</button>
        </div>
      </header>

      <main className="main">
        <div className="section-head">
          <div>
            <div className="eyebrow"><span className="dot" /> // registry ── integrations</div>
            <h2 className="headline">
              Integration registry <em>/</em> wire your workbench<em>.</em>
            </h2>
          </div>
          <div className="headline-meta">
            <div><em>{pad(connectedCount)}</em> connected</div>
            <div><b>{pad(availableCount)}</b> awaiting</div>
            <div><b>{pad(integrations.length)}</b> total</div>
          </div>
        </div>

        <div className="filter-row" role="tablist">
          <button
            className="filter-chip"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All <span className="count">{integrations.length}</span>
          </button>
          <button
            className="filter-chip"
            aria-pressed={filter === "connected"}
            onClick={() => setFilter("connected")}
          >
            Connected <span className="count">{connectedCount}</span>
          </button>
          <button
            className="filter-chip"
            aria-pressed={filter === "available"}
            onClick={() => setFilter("available")}
          >
            Available <span className="count">{availableCount}</span>
          </button>
        </div>

        <div className="grid">
          {visible.map((i, idx) => {
            const connected = connectionMap.get(i.name) ?? false;
            return (
              <article
                key={i.name}
                className="card"
                style={{ animationDelay: `${Math.min(idx * 35, 600)}ms` }}
              >
                <div className="card-top">
                  <span className="card-index">№ {pad(idx + 1)}</span>
                  <span className={`card-status ${connected ? "live" : ""}`}>
                    <span className="led" />
                    {connected ? "Live" : "Standby"}
                  </span>
                </div>

                <div>
                  <h3 className="card-name">{i.name}</h3>
                  <div className="card-ver">v{i.version}</div>
                </div>

                <div className="card-bottom">
                  {connected ? (
                    <>
                      <span className="card-meta">Session active</span>
                      <button
                        className="btn-disconnect"
                        onClick={() => handleConnect(i.name)}
                        title="Re-authorize"
                      >
                        Refresh
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="card-meta">Not paired</span>
                      <button className="btn-connect" onClick={() => handleConnect(i.name)}>
                        Connect →
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}

          {visible.length === 0 && (
            <div
              className="card"
              style={{ gridColumn: "1 / -1", textAlign: "center", justifyContent: "center", alignItems: "center" }}
            >
              <span className="card-meta">No integrations in this filter.</span>
            </div>
          )}
        </div>
      </main>

      <footer className="ticker">
        <span><span className="ok">●</span> system nominal</span>
        <span>registry sync · {new Date().toISOString().slice(11, 19)} UTC</span>
        <span>build · <span className="ok">stable</span></span>
      </footer>

      {cookieAuth && (
        <CookieAuthPopup
          integration={cookieAuth.integration}
          loginUrl={cookieAuth.loginUrl}
          cdpUrl={cookieAuth.cdpUrl}
          sessionId={cookieAuth.sessionId}
          onClose={() => setCookieAuth(null)}
          onSuccess={() => refetchConnections()}
        />
      )}
    </div>
  );
}
