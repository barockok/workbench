import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { redeemConnectLink, connectCapture, ConnectLinkError } from "../api";
import type { RedeemResult } from "../api";
import CdpScreencast from "../components/CdpScreencast";
import ConnectLinkProblem from "../components/ConnectLinkProblem";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";

type CookieInfo = Extract<RedeemResult, { type: "cookie" }>;

export default function Connect() {
  const { integration } = useParams();
  const [search] = useSearchParams();
  const jwt = search.get("t") ?? "";

  const [info, setInfo] = useState<CookieInfo | null>(null);
  const [problem, setProblem] = useState<ConnectLinkError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [done, setDone] = useState(false);
  const redeemed = useRef(false);

  useEffect(() => {
    if (redeemed.current) return;
    redeemed.current = true;
    if (!jwt) { setError("Missing link token."); return; }
    redeemConnectLink(jwt)
      .then((result) => {
        if (result.type === "oauth2") { window.location.href = result.url; return; }
        if (result.type === "cookie") { setInfo(result); return; }
        setError("Unexpected link type.");
      })
      .catch((e) => {
        if (e instanceof ConnectLinkError) setProblem(e);
        else setError(e instanceof Error ? e.message : "Link failed");
      });
  }, [jwt]);

  async function handleCapture() {
    setCapturing(true);
    setError(null);
    try {
      await connectCapture(jwt);
      setDone(true);
    } catch (e) {
      if (e instanceof ConnectLinkError) setProblem(e);
      else setError(e instanceof Error ? e.message : "Capture failed");
    } finally {
      setCapturing(false);
    }
  }

  if (problem) return <ConnectLinkProblem error={problem} />;
  if (done) {
    return <div className="ui-loading">Connected — {integration}. You can close this tab and return to your agent.</div>;
  }
  if (error && !info) {
    return <div className="ui-loading">Error — {error}</div>;
  }
  if (!info) {
    return <div className="ui-loading">Loading…</div>;
  }

  return (
    <Modal open onClose={() => {}} title={<>Connect <span>{info.integration}</span></>}
      footer={
        <Button onClick={handleCapture} disabled={capturing}>
          {capturing ? "Capturing…" : "Capture session"}
        </Button>
      }
    >
      <div className="modal-instructions">
        <div><b>01</b> — Log in to the remote browser below.</div>
        <div><b>02</b> — Click "Capture session" once authenticated.</div>
      </div>
      <div style={{ padding: 0, background: "#000", marginTop: "var(--s-12)" }}>
        <CdpScreencast cdpProxyUrl={info.cdpProxyUrl} sessionId={info.sessionId} cdpToken={info.cdpToken} width={1024} />
      </div>
      {error && <div className="ui-form-error" style={{ marginTop: "var(--s-12)" }}>ERR — {error}</div>}
    </Modal>
  );
}
