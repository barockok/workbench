import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { fetchProviders, fetchAuthUrl, fetchKeycloakAuthUrl } from "../api";

// Lands here from the server's GET /authorize — an MCP agent is asking a
// human to authenticate to workbench itself (not connect one integration).
// If the human is already signed in to the portal, the hidden form below
// auto-submits and no picker is ever shown. Otherwise this is the same
// provider choice /login offers, carrying the agent's ticket through.
export default function AuthorizeChoose() {
  const [search] = useSearchParams();
  const ticket = search.get("ticket") ?? "";
  const resumeUrl = search.get("resume") ?? "";
  const resumeError = search.get("error");
  const { user, token, isLoading } = useAuth();
  const [providers, setProviders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const attemptedResume = useRef(false);

  useEffect(() => {
    fetchProviders().then((r) => setProviders(r.providers)).catch(() => {});
  }, []);

  // Auto-resume for an already-signed-in human: a real top-level form POST
  // (not a fetch) so the browser attaches the server's awb_oauth_binding
  // cookie itself — a cross-origin fetch could never do that, which is what
  // makes this safe against login CSRF instead of just convenient. Skipped
  // if resumeError is set (a prior attempt already failed once) so it can't loop.
  useEffect(() => {
    if (isLoading || !user || !token || resumeError || attemptedResume.current) return;
    attemptedResume.current = true;
    formRef.current?.submit();
  }, [isLoading, user, token, resumeError]);

  async function handleProvider(name: "google" | "keycloak") {
    setError(null);
    try {
      const { url } = name === "google" ? await fetchAuthUrl(ticket) : await fetchKeycloakAuthUrl(ticket);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start sign in");
    }
  }

  if (!ticket) {
    return (
      <div className="login-shell">
        <section className="login-form">
          <div className="login-card">
            <div className="login-error">ERR — Missing or invalid link. Ask your agent to try again.</div>
          </div>
        </section>
      </div>
    );
  }

  // Show the picker once loading has settled and we're NOT about to silently
  // auto-submit (no session, or a session that already failed to resume once).
  const showChoice = !isLoading && (!user || !token || !!resumeError);

  return (
    <div className="login-shell">
      {resumeUrl && (
        <form ref={formRef} method="POST" action={resumeUrl} style={{ display: "none" }}>
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="token" value={token ?? ""} />
        </form>
      )}

      <section className="login-form">
        <div className="login-card">
          <div className="login-eyebrow">// access ── authorize agent</div>
          <h1 className="login-title">Approve agent<br />access<em>.</em></h1>
          <p className="login-sub">
            An agent is requesting access to your workbench. Sign in to continue.
          </p>

          {!showChoice ? (
            <p className="card-meta">Signing in…</p>
          ) : (
            <>
              {(error || resumeError) && (
                <div className="login-error">
                  ERR — {error ?? "Your session couldn't be resumed automatically. Sign in again."}
                </div>
              )}

              {providers.includes("google") && (
                <button onClick={() => handleProvider("google")} className="btn-google" type="button">
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
                <button onClick={() => handleProvider("keycloak")} className="btn-keycloak" type="button">
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
            </>
          )}
        </div>
      </section>
    </div>
  );
}
