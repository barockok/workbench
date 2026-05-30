import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { connectSession, connectCapture } from "../api";
import CdpScreencast from "../components/CdpScreencast";

type SessionInfo = Awaited<ReturnType<typeof connectSession>>;

export default function Connect() {
  const { integration } = useParams();
  const [search] = useSearchParams();
  const jwt = search.get("t") ?? "";

  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!jwt) { setError("Missing link token."); return; }
    connectSession(jwt).then(setInfo).catch((e) => setError(e.message));
  }, [jwt]);

  async function handleCapture() {
    setCapturing(true);
    setError(null);
    try {
      await connectCapture(jwt);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Capture failed");
    } finally {
      setCapturing(false);
    }
  }

  if (done) {
    return <div className="boot"><span>CONNECTED — {integration}. You can close this tab and return to your agent.</span></div>;
  }
  if (error && !info) {
    return <div className="boot"><span>ERR — {error}</span></div>;
  }
  if (!info) {
    return <div className="boot"><span>LOADING LOGIN<span className="blinker" /></span></div>;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <h2 className="modal-title">Connect <span>{info.integration}</span></h2>
        </div>
        <div className="modal-instructions">
          <div><b>01</b> — Log in to the remote browser below.</div>
          <div><b>02</b> — Click "Capture session" once authenticated.</div>
        </div>
        <div className="modal-body" style={{ padding: 0, background: "#000" }}>
          <CdpScreencast cdpProxyUrl={info.cdpProxyUrl} sessionId={info.sessionId} cdpToken={info.cdpToken} width={1024} />
        </div>
        {error && <div className="modal-error">ERR — {error}</div>}
        <div className="modal-foot">
          <button onClick={handleCapture} disabled={capturing} className="btn-connect">
            {capturing ? "Capturing…" : "Capture session"}
          </button>
        </div>
      </div>
    </div>
  );
}
