import { useState } from "react";
import { captureCookies, cancelCookieAuth } from "../api";

interface Props {
  integration: string;
  loginUrl: string;
  cdpUrl: string;
  sessionId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function isSafeLoginUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export default function CookieAuthPopup({ integration, loginUrl, sessionId, onClose, onSuccess }: Props) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safeLogin = isSafeLoginUrl(loginUrl);

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
          <div><b>01</b> — Complete login in the embedded browser below.</div>
          <div><b>02</b> — Click "Capture session" once authenticated.</div>
        </div>

        <div className="modal-body">
          {safeLogin ? (
            <iframe
              src={loginUrl}
              sandbox="allow-scripts allow-forms"
              referrerPolicy="no-referrer"
              title={`${integration} login`}
            />
          ) : (
            <div style={{ padding: 20, color: "var(--danger)", fontFamily: "var(--mono)", fontSize: 12 }}>
              Refusing to render login: loginUrl is not https.
            </div>
          )}
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
