import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { connectBrowserSession } from "../api";
import CdpScreencast from "../components/CdpScreencast";

type Info = Awaited<ReturnType<typeof connectBrowserSession>>;

export default function BrowserView() {
  const [search] = useSearchParams();
  const jwt = search.get("t") ?? "";
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jwt) { setError("Missing link token."); return; }
    connectBrowserSession(jwt).then(setInfo).catch((e) => setError(e.message));
  }, [jwt]);

  if (error && !info) {
    return <div className="boot"><span>ERR — {error}</span></div>;
  }
  if (!info) {
    return <div className="boot"><span>LOADING BROWSER<span className="blinker" /></span></div>;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <h2 className="modal-title">Browser session</h2>
        </div>
        <div className="modal-instructions">
          <div>You are driving the live browser. Close this tab to hand control back to your agent.</div>
        </div>
        <div className="modal-body" style={{ padding: 0, background: "#000" }}>
          <CdpScreencast cdpProxyUrl={info.cdpProxyUrl} sessionId={info.sessionId} cdpToken={info.cdpToken} width={1024} bearer={jwt} />
        </div>
        {error && <div className="modal-error">ERR — {error}</div>}
      </div>
    </div>
  );
}
