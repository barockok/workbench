import { markSvg, LOCKUP } from "@a-workbench/brand";

// The workbench mark, rendered from the brand package so the portal, the docs
// site and the marketing site cannot drift. Inline SVG (not an <img>) so the
// accent token colours it through currentColor in both themes.
export function BrandMark({ size = LOCKUP.standard.mark }: { size?: number }) {
  const svg = markSvg({ size, surface: "var(--surface)", variant: size <= 16 ? "small" : "full" });
  return <span className="brand-mark" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

// Mark plus wordmark. Every surface that shows both goes through this, so the
// gap between them is defined once. `compact` is the in-chrome scale.
export function BrandLockup({ size = LOCKUP.standard.mark, compact = false }: { size?: number; compact?: boolean }) {
  return (
    <div className={`brand-lockup${compact ? " brand-lockup-sm" : ""}`}>
      <BrandMark size={compact ? LOCKUP.compact.mark : size} />
      <span className="brand-name">{LOCKUP.name}</span>
    </div>
  );
}
