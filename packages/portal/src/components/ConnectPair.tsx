import type { ReactNode } from "react";

// The two ends of a connection, workbench on the left and the integration on
// the right, with the state of the link between them. Shared by the pre-connect
// handoff and the result page so the same moment looks the same in both.
export function ConnectPair({
  logo,
  label,
  connected = false,
}: {
  logo: ReactNode;
  label: string;
  connected?: boolean;
}) {
  return (
    <div className="connect-pair">
      <div className="connect-pair-end">
        <span className="connect-pair-mark connect-pair-workbench" aria-hidden>
          wb
        </span>
        <span className="connect-pair-label">workbench</span>
      </div>

      {/* The dashes carry the state visually; the label carries it to anyone
          who can't see them. */}
      <span
        className={`connect-pair-link${connected ? " is-connected" : ""}`}
        role="img"
        aria-label={connected ? `workbench is connected to ${label}` : `workbench is connecting to ${label}`}
      >
        <span className="connect-pair-dash" />
        <span className="connect-pair-node" />
        <span className="connect-pair-dash" />
      </span>

      <div className="connect-pair-end">
        <span className="connect-pair-mark">{logo}</span>
        <span className="connect-pair-label">{label}</span>
      </div>
    </div>
  );
}
