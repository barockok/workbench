import { useState } from "react";
import { resetBrowserSession } from "../api";

// Account-level control: wipe the user's persistent capture-browser profile
// (logs them out of every site in the capture browser).
export default function BrowserSessionPanel() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onReset() {
    if (!window.confirm("Reset browser session? This logs you out of all sites in the capture browser.")) return;
    setBusy(true);
    setMsg(null);
    try {
      await resetBrowserSession();
      setMsg({ ok: true, text: "Browser session reset." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="apikey-panel">
      <div className="apikey-head"><span>Browser session</span></div>
      <p className="integ-detail-desc">
        The capture browser remembers your logins across plugins. Reset to log out of everything and start fresh.
      </p>
      <button className="btn-disconnect" onClick={onReset} disabled={busy}>Reset browser session</button>
      {msg && <div className={msg.ok ? "session-transfer-ok" : "login-error"}>{msg.text}</div>}
    </div>
  );
}
