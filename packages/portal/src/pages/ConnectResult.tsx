import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchIntegrations, type IntegrationSummary } from "../api";
import IntegrationLogo from "../components/IntegrationLogo";
import { ConnectPair } from "../components/ConnectPair";

type Status = "ok" | "denied" | "expired" | "failed";

const COPY: Record<Status, { title: string; detail: string }> = {
  ok: {
    title: "Connected",
    detail: "Your agent can use this app's tools from now on.",
  },
  denied: {
    title: "Connection cancelled",
    detail: "Access was declined at the provider, so nothing was saved. Start again when you're ready.",
  },
  expired: {
    title: "Connect link expired",
    detail: "A connect link works once, and not for long. Ask your agent for a new one.",
  },
  failed: {
    title: "Connection failed",
    detail: "Something went wrong finishing the handshake. Try again, or check the workbench logs.",
  },
};

// Anything we didn't send ourselves is a failure. Defaulting the other way
// would let a truncated or hand-edited URL claim success the server never
// reported.
function readStatus(raw: string | null): Status {
  return raw === "ok" || raw === "denied" || raw === "expired" ? raw : "failed";
}

export default function ConnectResult() {
  const { integration = "" } = useParams();
  const [search] = useSearchParams();
  const status = readStatus(search.get("status"));

  // Read once, on mount, and clear: the marker describes how this tab arrived,
  // and leaving it set would mislabel a later visit made from inside the portal.
  const [fromLink] = useState(() => {
    const marker = sessionStorage.getItem("awb_connect_origin");
    sessionStorage.removeItem("awb_connect_origin");
    return marker === "link";
  });

  const { data } = useQuery<{ integrations: IntegrationSummary[] }>({
    queryKey: ["integrations"],
    queryFn: fetchIntegrations,
  });

  const integ = useMemo(
    () => data?.integrations.find((i) => i.name === integration),
    [data, integration]
  );
  const label = integ?.displayName || integration;

  useEffect(() => {
    document.title = `${COPY[status].title} — workbench`;
  }, [status]);

  return (
    <div className="connect-result">
      <div className="connect-result-card">
        <ConnectPair
          connected={status === "ok"}
          logo={
            <IntegrationLogo name={integration} displayName={label} logo={integ?.logo} size={44} />
          }
          label={label}
        />

        <h1 className="connect-result-title">{COPY[status].title}</h1>
        <p className="connect-result-detail">{COPY[status].detail}</p>

        {fromLink ? (
          <p className="connect-result-cta">You can close this tab and return to your agent.</p>
        ) : (
          <Link className="ui-button ui-button-outline ui-button-md" to={`/apps/${integration}`}>
            Back to {label}
          </Link>
        )}
      </div>
    </div>
  );
}
