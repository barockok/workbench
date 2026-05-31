import { useState } from "react";

// Generic "app" mark shown when a plugin defines no logo (or it fails to load).
function CogMark({ size }: { size: number }) {
  return (
    <span
      className="integ-logo integ-logo-fallback"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
      </svg>
    </span>
  );
}

// Renders the plugin logo; falls back to a generic cog when there's no logo
// or it fails to load.
export default function IntegrationLogo({
  name,
  displayName,
  logo,
  size = 36,
}: {
  name: string;
  displayName?: string;
  logo?: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const label = (displayName || name).trim();

  if (!logo || broken) {
    return <CogMark size={size} />;
  }
  return (
    <img
      className="integ-logo"
      src={logo}
      alt={`${label} logo`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
