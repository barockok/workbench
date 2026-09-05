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

// Mark plus wordmark. Every surface that shows both goes through this, so the
// gap between them is defined once — hand-assembling the row is how the login
// hero ended up with the mark jammed against the word.
//
// `compact` is the in-chrome scale (sidebar, login hero), where the lockup sits
// beside navigation rather than introducing a page.
export function BrandLockup({ size = 24, compact = false }: { size?: number; compact?: boolean }) {
  return (
    <div className={`brand-lockup${compact ? " brand-lockup-sm" : ""}`}>
      <BrandMark size={compact ? 20 : size} />
      <span className="brand-name">workbench</span>
    </div>
  );
}
