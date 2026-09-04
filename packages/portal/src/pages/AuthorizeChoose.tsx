import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { fetchProviders, fetchAuthUrl, fetchKeycloakAuthUrl, SERVER_URL } from "../api";
import { Button } from "../components/ui/Button";

// Lands here from the server's GET /authorize — an MCP agent is asking a
// human to authenticate to workbench itself (not connect one integration).
// If the human is already signed in to the portal, the hidden form below
// auto-submits and no picker is ever shown. Otherwise this is the same
// provider choice /login offers, carrying the agent's ticket through.
export default function AuthorizeChoose() {
  const [search] = useSearchParams();
  const ticket = search.get("ticket") ?? "";
  // Deliberately NOT read from the URL: this form posts a live session
  // token, so its target must come only from our own build-time config
  // (SERVER_URL), never from a query param a crafted link could set to an
  // attacker's origin.
  const resumeUrl = `${SERVER_URL}/authorize/resume`;
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
      const { url } =
        name === "google" ? await fetchAuthUrl(ticket) : await fetchKeycloakAuthUrl(ticket);
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
            <div className="ui-form-error">Missing or invalid link. Ask your agent to try again.</div>
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
      <form ref={formRef} method="POST" action={resumeUrl} hidden>
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="token" value={token ?? ""} />
      </form>

      <section className="login-form">
        <div className="login-card">
          <div className="login-eyebrow">Authorize agent</div>
          <h1 className="login-title">Approve agent access</h1>
          <p className="login-sub">
            An agent is requesting access to your workbench. Sign in to continue.
          </p>

          {!showChoice ? (
            <p className="login-sub">Signing in…</p>
          ) : (
            <>
              {(error || resumeError) && (
                <div className="ui-form-error">
                  {error ?? "Your session couldn't be resumed automatically. Sign in again."}
                </div>
              )}

              {providers.includes("google") && (
                <Button onClick={() => handleProvider("google")} variant="outline" size="lg" type="button">
                  Continue with Google
                </Button>
              )}

              {providers.includes("keycloak") && (
                <Button onClick={() => handleProvider("keycloak")} variant="outline" size="lg" type="button">
                  Continue with Keycloak
                </Button>
              )}

              {providers.length === 0 && (
                <div className="ui-form-error">No auth provider configured</div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
