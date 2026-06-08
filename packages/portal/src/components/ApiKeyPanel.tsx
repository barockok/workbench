import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiKeyStatus, mintApiKey, revokeApiKey, revealApiKey } from "../api";

// Server serves the portal, so its origin is also the /mcp origin.
const MCP_URL = `${window.location.origin}/mcp`;
const PLACEHOLDER = "YOUR_API_KEY";

function maskKey(k: string): string {
  return "•".repeat(Math.max(8, k.length - 4)) + k.slice(-4);
}

// Generic MCP client config — works with any MCP-compatible client.
function configFor(key: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        workbench: {
          url: MCP_URL,
          headers: { "x-workbench-api-key": key },
        },
      },
    },
    null,
    2
  );
}

export default function ApiKeyPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["api-key-status"],
    queryFn: getApiKeyStatus,
  });

  // Plaintext key. Held after minting; also refetchable via reveal.
  const [revealed, setRevealed] = useState<string | null>(null);
  const [show, setShow] = useState(false); // masked by default
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const hasKey = data?.hasKey ?? false;

  async function handleMint() {
    setBusy(true);
    setError(null);
    try {
      const { apiKey } = await mintApiKey();
      setRevealed(apiKey);
      setShow(false);
      queryClient.invalidateQueries({ queryKey: ["api-key-status"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleReveal() {
    setBusy(true);
    setError(null);
    try {
      const { apiKey } = await revealApiKey();
      setRevealed(apiKey);
      setShow(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    setBusy(true);
    setError(null);
    try {
      await revokeApiKey();
      setRevealed(null);
      queryClient.invalidateQueries({ queryKey: ["api-key-status"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string, tag: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(tag);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  // The key value to render in the config snippet: real (masked or shown) when
  // freshly minted, else a placeholder so the snippet is always present.
  const snippetKey = revealed ? (show ? revealed : maskKey(revealed)) : PLACEHOLDER;
  // Copy always uses the real key when we have it.
  const copyKey = revealed ?? PLACEHOLDER;

  return (
    <section className="apikey-panel">
      <div className="apikey-head">
        <div className="eyebrow"><span className="dot" /> // mcp ── access key</div>
        <span className={`card-status ${hasKey ? "live" : ""}`}>
          <span className="led" />
          {isLoading ? "…" : hasKey ? "Key active" : "No key"}
        </span>
      </div>

      <p className="apikey-blurb">
        Send this key in the <code>x-workbench-api-key</code> header to{" "}
        <code>{MCP_URL}</code>. Reveal it anytime below.
      </p>

      {error && <div className="login-error" style={{ marginBottom: 12 }}>ERR — {error}</div>}

      {/* Freshly minted key — masked by default, with Show toggle + copy. */}
      {revealed && (
        <div className="apikey-reveal">
          <div className="apikey-row">
            <code className="apikey-value">{show ? revealed : maskKey(revealed)}</code>
            <button className="btn-ghost" onClick={() => setShow((s) => !s)}>
              {show ? "Hide" : "Show"}
            </button>
            <button className="btn-ghost" onClick={() => copy(revealed, "key")}>
              {copied === "key" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* Config snippet — always visible once a key exists or was just minted. */}
      {(revealed || hasKey) && (
        <div className="apikey-reveal" style={{ marginTop: 10 }}>
          <div className="apikey-snippet-label">MCP client config (JSON):</div>
          <pre className="apikey-snippet"><code>{configFor(snippetKey)}</code></pre>
          <div className="apikey-actions">
            <button className="btn-ghost" onClick={() => copy(configFor(copyKey), "cfg")}>
              {copied === "cfg" ? "Copied" : "Copy config"}
            </button>
            {!revealed && (
              <button className="btn-ghost" onClick={handleReveal} disabled={busy}>
                {busy ? "…" : "Reveal key"}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="apikey-actions" style={{ marginTop: 14 }}>
        <button className="btn-connect" onClick={handleMint} disabled={busy}>
          {busy ? "Working…" : hasKey || revealed ? "Regenerate key" : "Generate key"}
        </button>
        {(hasKey || revealed) && (
          <button className="btn-disconnect" onClick={handleRevoke} disabled={busy}>
            Revoke
          </button>
        )}
      </div>
    </section>
  );
}
