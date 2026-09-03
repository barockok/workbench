import { useEffect, useRef, type ReactNode } from "react";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: "sm" | "md" | "fullscreen";
  children: ReactNode;
  footer?: ReactNode;
}

export function BottomSheet({ open, onClose, title, size = "md", children, footer }: BottomSheetProps) {
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
    <div className="ui-sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={panelRef}
        className={`ui-sheet ui-sheet-${size}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui-sheet-grip" aria-hidden />
        {title && (
          <div className="ui-modal-head">
            <h2 className="ui-modal-title">{title}</h2>
            <button type="button" className="ui-button ui-button-ghost ui-button-sm" onClick={onClose} aria-label="Close">
              Close
            </button>
          </div>
        )}
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
