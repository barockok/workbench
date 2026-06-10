import { FastifyInstance, FastifyReply } from "fastify";

// Static, generic OAuth out-of-band landing page.
//
// An agent running in a CLI can't host a redirect listener, so it can't be the
// OAuth `redirect_uri`. Instead the provider redirects here; the page shows the
// full redirect URL (verbatim, including ?code&state) with a Copy button, and
// the human pastes it back to the agent, which does the code exchange itself.
//
// Workbench does NO server work here — no code exchange, no token storage, no
// markConnected. The page is purely a clipboard hand-off.
//
// Security: the URL carries attacker-influenceable query values (e.g. a crafted
// `?error=<script>`). The script places the URL into the DOM ONLY via
// `input.value` — never innerHTML or document.write — so it can never be parsed
// as markup. The server never templates the URL into the response (the value
// exists only client-side), so there is no reflected-XSS surface here.
export function oauthRedirectPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorization complete</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0e0e10;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem;box-sizing:border-box}
  main{background:#1a1a1e;padding:2rem;border-radius:12px;width:min(560px,92vw);box-shadow:0 10px 40px #0008}
  h1{font-size:1.1rem;margin:0 0 .25rem}
  p{color:#aaa;font-size:.9rem;margin:.25rem 0 1rem}
  .row{display:flex;gap:.5rem}
  input{flex:1;min-width:0;padding:.6rem;border-radius:8px;border:1px solid #333;background:#0e0e10;color:#eee;font-family:ui-monospace,monospace;font-size:.85rem}
  button{padding:.6rem 1rem;border:0;border-radius:8px;background:#5b8cff;color:#fff;font-weight:600;cursor:pointer}
  button:active{transform:translateY(1px)}
  .ok{color:#4ade80;font-size:.85rem;height:1rem;margin:.5rem 0 0}
</style></head><body>
<main>
  <h1>Authorization complete</h1>
  <p>Copy this URL and paste it back to your agent.</p>
  <div class="row">
    <input id="url" readonly aria-label="Redirect URL">
    <button id="copy" type="button">Copy</button>
  </div>
  <p class="ok" id="ok" role="status" aria-live="polite"></p>
</main>
<script>
  // Read the full redirect URL and place it into the field via .value only, so
  // any markup in the query string stays inert text (never an HTML sink).
  var url = document.getElementById("url");
  url.value = location.href;
  document.getElementById("copy").addEventListener("click", function () {
    var done = function () { document.getElementById("ok").textContent = "Copied"; };
    url.focus();
    url.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url.value).then(done, function () {
        try { document.execCommand("copy"); done(); } catch (e) {}
      });
    } else {
      try { document.execCommand("copy"); done(); } catch (e) {}
    }
  });
</script>
</body></html>`;
}

function setHeaders(reply: FastifyReply): void {
  reply.header("content-type", "text/html; charset=utf-8");
  reply.header("x-content-type-options", "nosniff");
  // The page needs its own inline <style> + <script>, loads nothing else, and
  // makes no network calls. `frame-ancestors 'none'` blocks framing so the Copy
  // button can't be clickjacked into putting the auth code on the clipboard.
  reply.header(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'"
  );
  reply.header("x-frame-options", "DENY");
  // The URL carries ?code= — never leak it via Referer on any later navigation.
  reply.header("referrer-policy", "no-referrer");
}

export async function registerOAuthRedirectRoute(app: FastifyInstance): Promise<void> {
  app.get("/oauth/callback", async (_req, reply) => {
    setHeaders(reply);
    return reply.send(oauthRedirectPage());
  });
}
