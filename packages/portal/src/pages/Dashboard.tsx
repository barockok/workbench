import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchIntegrations, fetchConnections, startIntegrationAuth, IntegrationSummary } from "../api";
import { useAuth } from "../context/AuthContext";
import CookieAuthPopup from "../components/CookieAuthPopup";
import ApiKeyPanel from "../components/ApiKeyPanel";
import IntegrationLogo from "../components/IntegrationLogo";
import IntegrationDetail from "../components/IntegrationDetail";

interface CookieAuthState {
  integration: string;
  loginUrl: string;
  cdpProxyUrl: string;
  cdpToken: string;
  sessionId: string;
}

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
  const [category, setCategory] = useState<string>("all");
  const [detail, setDetail] = useState<string | null>(null);

  const connectionMap = useMemo<Map<string, boolean>>(() => {
    const entries: [string, boolean][] =
      connectionsData?.connections?.map(
        (c: { name: string; connected: boolean }) => [c.name, c.connected]
      ) ?? [];
    return new Map(entries);
  }, [connectionsData]);

  const integrations: IntegrationSummary[] = data?.integrations ?? [];
  const connectedCount = integrations.filter((i) => connectionMap.get(i.name)).length;
  const availableCount = integrations.length - connectedCount;

  const categories = useMemo(() => {
    const set = new Set<string>();
    integrations.forEach((i) => i.categories?.forEach((c) => set.add(c)));
    return Array.from(set).sort();
  }, [integrations]);

  // Rank for sort: live (connected) → available (configured) → not configured.
  function rank(i: IntegrationSummary): number {
    if (connectionMap.get(i.name)) return 0;
    if (i.configured !== false) return 1;
    return 2;
  }

  const visible = integrations
    .filter((i) => {
      const c = connectionMap.get(i.name) ?? false;
      if (filter === "connected" && !c) return false;
      if (filter === "available" && c) return false;
      if (category !== "all" && !i.categories?.includes(category)) return false;
      return true;
    })
    .sort((a, b) => rank(a) - rank(b));

  const [connectError, setConnectError] = useState<string | null>(null);

  async function handleConnect(integration: string) {
    setConnectError(null);
    try {
      const result = await startIntegrationAuth(integration);
      if (result.type === "cookie") {
        setCookieAuth({
          integration,
          loginUrl: result.loginUrl,
          cdpProxyUrl: result.cdpProxyUrl,
          cdpToken: result.cdpToken,
          sessionId: result.sessionId,
        });
        return;
      }
      if (result.type === "oauth2") {
        window.location.href = result.url;
        return;
      }
      setConnectError(`Manual auth required for ${integration}.`);
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : "Connect failed");
    }
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
        <ApiKeyPanel />

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

        {connectError && (
          <div className="login-error" style={{ marginBottom: 16 }}>
            ERR — {connectError}
          </div>
        )}

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

          {categories.length > 0 && (
            <div className="cat-select-wrap">
              <label className="cat-select-label" htmlFor="cat-select">Category</label>
              <select
                id="cat-select"
                className="cat-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="grid">
          {visible.map((i, idx) => {
            const connected = connectionMap.get(i.name) ?? false;
            const configured = i.configured !== false;
            // Not configured (no creds/manual auth) → not connectable, unclickable.
            const clickable = configured;
            return (
              <article
                key={i.name}
                className={`card ${clickable ? "card-clickable" : "card-disabled"}`}
                style={{ animationDelay: `${Math.min(idx * 35, 600)}ms` }}
                onClick={clickable ? () => setDetail(i.name) : undefined}
                role={clickable ? "button" : undefined}
                aria-disabled={clickable ? undefined : true}
                tabIndex={clickable ? 0 : -1}
                onKeyDown={clickable ? (e) => { if (e.key === "Enter") setDetail(i.name); } : undefined}
              >
                <div className="card-top">
                  <span className="card-index">№ {pad(idx + 1)}</span>
                  <span className={`card-status ${connected ? "live" : ""}`}>
                    <span className="led" />
                    {connected ? "Live" : configured ? "Standby" : "Not configured"}
                  </span>
                </div>

                <div className="card-head">
                  <IntegrationLogo name={i.name} displayName={i.displayName} logo={i.logo} size={28} />
                  <div>
                    <h3 className="card-name">{i.displayName || i.name}</h3>
                    <div className="card-ver">v{i.version} · {i.toolCount} tools</div>
                  </div>
                </div>

                {i.description && <p className="card-desc">{i.description}</p>}

                {i.categories && i.categories.length > 0 && (
                  <div className="integ-tags">
                    {i.categories.map((c) => <span key={c} className="integ-tag">{c}</span>)}
                  </div>
                )}

                <div className="card-bottom">
                  {i.name === "browser" ? (
                    <span className="card-meta">Built-in · always on</span>
                  ) : connected ? (
                    <>
                      <span className="card-meta">Session active</span>
                      <button
                        className="btn-disconnect"
                        onClick={(e) => { e.stopPropagation(); handleConnect(i.name); }}
                        title="Re-authorize"
                      >
                        Refresh
                      </button>
                    </>
                  ) : configured ? (
                    <>
                      <span className="card-meta">Not paired</span>
                      <button
                        className="btn-connect"
                        onClick={(e) => { e.stopPropagation(); handleConnect(i.name); }}
                      >
                        Connect →
                      </button>
                    </>
                  ) : (
                    <span className="card-meta">Auth not configured</span>
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

      {detail && (
        <IntegrationDetail
          name={detail}
          connected={connectionMap.get(detail) ?? false}
          onClose={() => setDetail(null)}
          onConnect={(n) => { setDetail(null); handleConnect(n); }}
        />
      )}

      {cookieAuth && (
        <CookieAuthPopup
          integration={cookieAuth.integration}
          loginUrl={cookieAuth.loginUrl}
          cdpProxyUrl={cookieAuth.cdpProxyUrl}
          cdpToken={cookieAuth.cdpToken}
          sessionId={cookieAuth.sessionId}
          onClose={() => setCookieAuth(null)}
          onSuccess={() => refetchConnections()}
        />
      )}
    </div>
  );
}
