import { useState } from "react";
import { captureCookies, cancelCookieAuth } from "../api";
import CdpScreencast from "./CdpScreencast";

interface Props {
  integration: string;
  loginUrl: string;
  cdpProxyUrl: string;
  cdpToken: string;
  sessionId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CookieAuthPopup({ integration, cdpProxyUrl, cdpToken, sessionId, onClose, onSuccess }: Props) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCapture() {
    setCapturing(true);
    setError(null);
    try {
      await captureCookies(integration, sessionId);
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Capture failed");
    } finally {
      setCapturing(false);
    }
  }

  async function handleCancel() {
    await cancelCookieAuth(integration, sessionId);
    onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <h2 className="modal-title">Pair <span>{integration}</span></h2>
          <button onClick={handleCancel} className="btn-ghost" aria-label="Close">Close</button>
        </div>

        <div className="modal-instructions">
          <div><b>01</b> — Complete login in the remote browser below (mouse + keyboard streamed via CDP).</div>
          <div><b>02</b> — Click "Capture session" once authenticated.</div>
        </div>

        <div className="modal-body" style={{ padding: 0, background: "#000" }}>
          <CdpScreencast
            cdpProxyUrl={cdpProxyUrl}
            sessionId={sessionId}
            cdpToken={cdpToken}
            width={1024}
          />
        </div>

        {error && <div className="modal-error">ERR — {error}</div>}

        <div className="modal-foot">
          <button onClick={handleCancel} className="btn-ghost">Cancel</button>
          <button onClick={handleCapture} disabled={capturing} className="btn-connect">
            {capturing ? "Capturing…" : "Capture session"}
          </button>
        </div>
      </div>
    </div>
  );
}
