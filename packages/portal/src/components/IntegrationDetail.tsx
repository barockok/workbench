import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchIntegration, exportSession, importSession, openBrowserLiveUrl, resetBrowserSession } from "../api";
import IntegrationLogo from "./IntegrationLogo";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Badge } from "./ui/Badge";

// Built-in browser controls: open a live view (optionally at a URL) and clear
// the persistent profile. Replaces the old standalone BrowserSessionPanel.
function BrowserControls() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const qc = useQueryClient();

  async function onOpen() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await openBrowserLiveUrl(url.trim() || undefined);
      window.open(r.url, "_blank", "noopener");
      setMsg({ ok: true, text: "Live view opened in a new tab." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    if (!window.confirm("Clear browser session? This logs you out of all sites in the browser.")) return;
    setBusy(true);
    setMsg(null);
    try {
      await resetBrowserSession();
      setMsg({ ok: true, text: "Browser session cleared." });
      qc.invalidateQueries({ queryKey: ["connections"] });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="session-transfer">
      <div className="integ-tools-head"><span>Browser controls</span></div>
      <p className="integ-detail-desc">
        Open a live view to drive the browser by hand. Leave the URL blank to view the current page, or enter a URL to
        navigate there first.
      </p>
      <div className="session-transfer-row">
        <Input
          style={{ flex: 1 }}
          placeholder="https://example.com (optional)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button onClick={onOpen} disabled={busy}>Open live view →</Button>
      </div>
      <div className="session-transfer-row">
        <Button variant="danger" onClick={onClear} disabled={busy}>Clear session</Button>
      </div>
      {msg && <div className={msg.ok ? "session-transfer-ok" : "ui-form-error"}>{msg.text}</div>}
    </div>
  );
}

// Move a captured cookie session between workbenches. Capture on a machine the
// login provider trusts (e.g. a residential IP), export, then import into a
// headless/in-cluster workbench the provider would otherwise block.
function SessionTransfer({ name }: { name: string }) {
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  async function onExport() {
    setMsg(null);
    setBusy(true);
    try {
      const { session } = await exportSession(name);
      const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}-session.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ ok: true, text: "Exported — bundle downloaded. Keep it secret; it's a live session." });
    } catch (e) {
      setMsg({ ok: false, text: `Export failed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    setMsg(null);
    setBusy(true);
    try {
      const session = JSON.parse(paste);
      const r = await importSession(name, session);
      setMsg({ ok: true, text: `Imported ${r.cookieCount} cookies — integration connected.` });
      setPaste("");
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["integrations"] });
    } catch (e) {
      const m = e instanceof SyntaxError ? "not valid JSON" : (e as Error).message;
      setMsg({ ok: false, text: `Import failed: ${m}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="session-transfer">
      <div className="integ-tools-head"><span>Session transfer</span></div>
      <p className="integ-detail-desc">
        Capture on a machine the login provider accepts, <b>Export</b> the session, then <b>Import</b> it into a
        workbench whose IP the provider blocks (e.g. a headless/in-cluster instance).
      </p>
      <div className="session-transfer-row">
        <Button variant="ghost" onClick={onExport} disabled={busy}>Export session ↓</Button>
      </div>
      <textarea
        className="ui-input"
        placeholder="Paste an exported session bundle JSON here…"
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        rows={4}
      />
      <div className="session-transfer-row">
        <Button onClick={onImport} disabled={busy || !paste.trim()}>Import session ↑</Button>
      </div>
      {msg && <div className={msg.ok ? "session-transfer-ok" : "ui-form-error"}>{msg.text}</div>}
    </div>
  );
}

// Detail modal: integration metadata + the tools it exposes.
export default function IntegrationDetail({
  name,
  connected,
  onClose,
  onConnect,
  onDisconnect,
}: {
  name: string;
  connected: boolean;
  onClose: () => void;
  onConnect: (name: string) => void;
  onDisconnect: (name: string) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["integration", name],
    queryFn: () => fetchIntegration(name),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <div className="integ-detail-title">
          <IntegrationLogo name={name} displayName={data?.displayName} logo={data?.logo} size={44} />
          <div>
            <div>{data?.displayName || name}</div>
            <div className="card-ver">v{data?.version ?? "—"} · {data?.authType ?? "…"}</div>
          </div>
        </div>
      }
      footer={
        data?.authType !== "none" ? (
          <>
            {connected && (
              <Button variant="danger" onClick={() => onDisconnect(name)}>
                Disconnect
              </Button>
            )}
            <Button variant={connected ? "ghost" : "primary"} onClick={() => onConnect(name)}>
              {connected ? "Re-authorize" : "Connect →"}
            </Button>
          </>
        ) : undefined
      }
    >
      {isLoading && <div className="ui-loading">Loading…</div>}
      {error && <div className="ui-form-error">ERR — failed to load</div>}
      {data && (
        <>
          {data.description && <p className="integ-detail-desc">{data.description}</p>}
          {data.categories && data.categories.length > 0 && (
            <div className="integ-tags">
              {data.categories.map((c) => <Badge key={c} variant="neutral">{c}</Badge>)}
            </div>
          )}
          {data.authType === "cookie" && <SessionTransfer name={name} />}
          {name === "browser" && <BrowserControls />}
          <div className="integ-tools-head">
            <span>Tools</span><Badge variant="neutral">{data.tools.length}</Badge>
          </div>
          <ul className="integ-tool-list">
            {data.tools.map((t) => (
              <li key={t.name} className="integ-tool">
                <code className="integ-tool-name">{t.name}</code>
                <span className="integ-tool-desc">{t.description}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
