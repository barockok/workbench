import { useAuth } from "../context/AuthContext";
import type { ConnectLinkError } from "../api";

const COPY: Record<string, { title: string; detail: string }> = {
  LINK_INVALID: {
    title: "Link invalid or expired",
    detail: "Ask your agent to generate a new connect link.",
  },
  LINK_CONSUMED: {
    title: "Link already used",
    detail: "A connect link works once. Ask your agent for a new one.",
  },
  UNKNOWN: {
    title: "Could not open this link",
    detail: "Ask your agent to generate a new connect link.",
  },
};

export default function ConnectLinkProblem({ error }: { error: ConnectLinkError }) {
  const { user, logout } = useAuth();

  if (error.code === "ACCOUNT_MISMATCH") {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true">
        <div className="modal">
          <div className="modal-head">
            <h2 className="modal-title">Wrong workbench account</h2>
          </div>
          <div className="modal-instructions">
            <div>
              This link connects <b>{error.integration}</b> to a different workbench
              account than the one you are signed in to{user?.email ? ` (${user.email})` : ""}.
            </div>
            <div>
              Connecting from here would attach your credentials to that other
              account. Sign in as the account the link was made for, or ask your
              agent for a link for this account.
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" onClick={logout}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  const copy = COPY[error.code] ?? COPY.UNKNOWN;
  return (
    <div className="boot">
      <span>{copy.title} — {copy.detail}</span>
    </div>
  );
}
