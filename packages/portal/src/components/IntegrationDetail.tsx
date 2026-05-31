import { useQuery } from "@tanstack/react-query";
import { fetchIntegration } from "../api";
import IntegrationLogo from "./IntegrationLogo";

// Detail modal: integration metadata + the tools it exposes.
export default function IntegrationDetail({
  name,
  connected,
  onClose,
  onConnect,
}: {
  name: string;
  connected: boolean;
  onClose: () => void;
  onConnect: (name: string) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["integration", name],
    queryFn: () => fetchIntegration(name),
  });

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="integ-detail-title">
            <IntegrationLogo name={name} displayName={data?.displayName} logo={data?.logo} size={44} />
            <div>
              <h2 className="modal-title">{data?.displayName || name}</h2>
              <div className="card-ver">v{data?.version ?? "—"} · {data?.authType ?? "…"}</div>
            </div>
          </div>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>

        <div className="modal-body modal-detail-body">
          {isLoading && <div className="boot"><span>LOADING<span className="blinker" /></span></div>}
          {error && <div className="login-error">ERR — failed to load</div>}
          {data && (
            <>
              {data.description && <p className="integ-detail-desc">{data.description}</p>}
              {data.categories && data.categories.length > 0 && (
                <div className="integ-tags">
                  {data.categories.map((c) => <span key={c} className="integ-tag">{c}</span>)}
                </div>
              )}
              <div className="integ-tools-head">
                <span>Tools</span><span className="count">{data.tools.length}</span>
              </div>
              <ul className="integ-tool-list">
                {data.tools.map((t) => (
                  <li key={t.name} className="integ-tool">
                    <code className="integ-tool-name">{t.name}</code>
                    <span className="integ-tool-desc">{t.description}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className={connected ? "btn-disconnect" : "btn-connect"} onClick={() => onConnect(name)}>
            {connected ? "Re-authorize" : "Connect →"}
          </button>
        </div>
      </div>
    </div>
  );
}
