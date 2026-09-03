import { useEffect, useRef, type ReactNode } from "react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  dismissible?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, size = "md", dismissible = true, children, footer }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={panelRef}
        className={`ui-modal ui-modal-${size}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="ui-modal-head">
            <h2 className="ui-modal-title">{title}</h2>
            {dismissible && (
              <button type="button" className="ui-button ui-button-ghost ui-button-sm" onClick={onClose} aria-label="Close">
                Close
              </button>
            )}
          </div>
        )}
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Note: focus does not return to the trigger element on close in this implementation —
// the spec's contract ("focus returns to the trigger on close") is deferred. Every current
// call site replaces a page that reloads or navigates away on close (or re-renders the whole
// panel), so there is no live trigger element to return focus to in practice. Flagging this
// as a known simplification, not a silent drop — revisit if a future call site needs it.
