// The workbench mark: a lowercase w on the accent, the same one the docs site
// puts in its topbar and its favicon. Kept as a component rather than a glyph
// typed into each page so the three standalone pages cannot drift from it.
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <span
      className="brand-mark"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      aria-hidden
    >
      w
    </span>
  );
}

// Mark plus wordmark, for pages that sit outside the app shell and would
// otherwise carry no identity at all.
export function BrandLockup({ size = 24 }: { size?: number }) {
  return (
    <div className="brand-lockup">
      <BrandMark size={size} />
      <span className="brand-name">workbench</span>
    </div>
  );
}
