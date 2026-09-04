import type { ReactNode } from "react";

export function EmptyState({ message, action }: { message: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <p className="ui-empty-msg">{message}</p>
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}
