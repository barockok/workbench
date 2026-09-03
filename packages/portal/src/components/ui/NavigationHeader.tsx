import type { ReactNode } from "react";

export interface NavigationHeaderProps {
  title: ReactNode;
  onBack?: () => void;
  trailing?: ReactNode;
}

export function NavigationHeader({ title, onBack, trailing }: NavigationHeaderProps) {
  return (
    <header className="ui-nav-header">
      <div className="ui-nav-header-lead">
        {onBack && (
          <button type="button" className="ui-nav-header-back" onClick={onBack} aria-label="Back">
            ←
          </button>
        )}
        <span className="ui-nav-header-title">{title}</span>
      </div>
      {trailing && <div className="ui-nav-header-trailing">{trailing}</div>}
    </header>
  );
}
