import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchAuthUrl, fetchKeycloakAuthUrl, fetchProviders } from "../api";

// Only ever an in-app path. A stored value is never trusted as a URL: a
// protocol-relative form ("//host") or a backslash form ("/\host", which some
// browsers normalize to "//host") would navigate off-origin after login.
function safeReturnPath(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  return value;
}

export default function Login() {
  const { login, token } = useAuth();
  const [error, setError] = useState("");
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    if (!token) return;
    const returnTo = sessionStorage.getItem("awb_return_to");
    sessionStorage.removeItem("awb_return_to");
    window.location.href = safeReturnPath(returnTo);
  }, [login, token]);

  useEffect(() => {
    fetchProviders().then((r) => setProviders(r.providers)).catch(() => {});
  }, []);

  const handleGoogle = async () => {
    try {
      const { url } = await fetchAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start sign in");
    }
  };

  const handleKeycloak = async () => {
    try {
      const { url } = await fetchKeycloakAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start sign in");
    }
  };

  return (
    <div className="login-shell">
      <aside className="login-art">
        <div className="meta">
          <span>workbench<span className="sep"> / </span><b>v0.1</b></span>
          <span className="sep">·</span>
          <span>mcp aggregator</span>
        </div>

        <div className="glyph">
          ./connect <em>—</em><br />
          your agent's<br />
          <em>tool</em>belt<span className="arrow">_</span>
        </div>

        <div className="specs">
          <div>
            <label>TOOLS</label>
            <strong><em>71</em></strong>
          </div>
          <div>
            <label>PLUGINS</label>
            <strong>08</strong>
          </div>
          <div>
            <label>NODE</label>
            <strong><em>online</em></strong>
          </div>
        </div>
      </aside>

      <section className="login-form">
        <div className="login-card">
          <div className="login-eyebrow">// access ── 01</div>
          <h1 className="login-title">Identify<br />terminal<em>.</em></h1>
          <p className="login-sub">
            Sign in to pair your agent sessions to authorized SaaS tools —
            one identity, one console.
          </p>

          {error && <div className="login-error">ERR — {error}</div>}

          {providers.includes("google") && (
            <button onClick={handleGoogle} className="btn-google" type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                <path fill="#14111d" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#14111d" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#14111d" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#14111d" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>
          )}

          {providers.includes("keycloak") && (
            <button onClick={handleKeycloak} className="btn-keycloak" type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="#14111d" strokeWidth="2">
                <circle cx="12" cy="8" r="4"/>
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
              </svg>
              Continue with Keycloak
            </button>
          )}

          {providers.length === 0 && (
            <div className="login-error">ERR — No auth provider configured</div>
          )}

          <div className="login-fine">
            <span className="pip" /> AES-256-GCM
            <span style={{ color: "var(--mute)" }}>·</span> encrypted at rest
            <span style={{ color: "var(--mute)" }}>·</span> self-hosted
          </div>
        </div>
      </section>
    </div>
  );
}
