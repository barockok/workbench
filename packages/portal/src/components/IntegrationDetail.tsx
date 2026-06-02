import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchIntegration, exportSession, importSession } from "../api";
import IntegrationLogo from "./IntegrationLogo";

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
        <button className="btn-ghost" onClick={onExport} disabled={busy}>Export session ↓</button>
      </div>
      <textarea
        className="session-transfer-paste"
        placeholder="Paste an exported session bundle JSON here…"
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        rows={4}
      />
      <div className="session-transfer-row">
        <button className="btn-connect" onClick={onImport} disabled={busy || !paste.trim()}>Import session ↑</button>
      </div>
      {msg && <div className={msg.ok ? "session-transfer-ok" : "login-error"}>{msg.text}</div>}
    </div>
  );
}

// Detail modal: integration metadata + the tools it exposes.
export default function IntegrationDetail({
  name,
  connected,
  onClose,
  onConnect,
}: {
  name: string;
  connected: boolean;
  onClose: () => void;
  onConnect: (name: string) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["integration", name],
    queryFn: () => fetchIntegration(name),
  });

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="integ-detail-title">
            <IntegrationLogo name={name} displayName={data?.displayName} logo={data?.logo} size={44} />
            <div>
              <h2 className="modal-title">{data?.displayName || name}</h2>
              <div className="card-ver">v{data?.version ?? "—"} · {data?.authType ?? "…"}</div>
            </div>
          </div>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>

        <div className="modal-body modal-detail-body">
          {isLoading && <div className="boot"><span>LOADING<span className="blinker" /></span></div>}
          {error && <div className="login-error">ERR — failed to load</div>}
          {data && (
            <>
              {data.description && <p className="integ-detail-desc">{data.description}</p>}
              {data.categories && data.categories.length > 0 && (
                <div className="integ-tags">
                  {data.categories.map((c) => <span key={c} className="integ-tag">{c}</span>)}
                </div>
              )}
              {data.authType === "cookie" && <SessionTransfer name={name} />}
              <div className="integ-tools-head">
                <span>Tools</span><span className="count">{data.tools.length}</span>
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
        </div>

        <div className="modal-foot">
          <button className={connected ? "btn-disconnect" : "btn-connect"} onClick={() => onConnect(name)}>
            {connected ? "Re-authorize" : "Connect →"}
          </button>
        </div>
      </div>
    </div>
  );
}
