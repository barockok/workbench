import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { ThemeToggle } from "../ui/ThemeToggle";

const HELP_URL = "https://github.com/barockok/workbench";

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="wb-nav-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const HomeIcon = () => <Icon><path d="M2 7l6-5 6 5v6.2a.8.8 0 0 1-.8.8H2.8a.8.8 0 0 1-.8-.8z" /></Icon>;
const AppsIcon = () => (
  <Icon>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </Icon>
);
const AgentsIcon = () => (
  <Icon>
    <path d="M5 1.5v3M11 1.5v3" />
    <rect x="3" y="4.5" width="10" height="5" rx="1" />
    <path d="M8 9.5v5" />
  </Icon>
);
const ActivityIcon = () => <Icon><path d="M1 8h3l2-5.5L10 13l2-5h3" /></Icon>;
const SettingsIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="2.4" />
    <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
  </Icon>
);
const HelpIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6.3" />
    <path d="M6.2 6.2A1.8 1.8 0 1 1 8 8.3v.7" />
    <path d="M8 11.6h.01" />
  </Icon>
);

const NAV = [
  { to: "/", label: "Home", end: true, Glyph: HomeIcon },
  { to: "/apps", label: "Apps", end: false, Glyph: AppsIcon },
  { to: "/agents", label: "Agents", end: false, Glyph: AgentsIcon },
  { to: "/activity", label: "Activity", end: false, Glyph: ActivityIcon },
];

function itemClass({ isActive }: { isActive: boolean }) {
  return `wb-nav-item${isActive ? " wb-nav-item-active" : ""}`;
}

export function Sidebar() {
  const { user } = useAuth();

  return (
    <nav className="wb-sidebar" aria-label="Main">
      <div className="wb-brand">workbench</div>

      <ul className="wb-nav">
        {NAV.map(({ to, label, end, Glyph }) => (
          <li key={to}>
            <NavLink to={to} end={end} className={itemClass}>
              <Glyph />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="wb-sidebar-foot">
        <NavLink to="/settings" className={itemClass}>
          <SettingsIcon />
          Settings
        </NavLink>
        <a className="wb-nav-item" href={HELP_URL} target="_blank" rel="noreferrer noopener">
          <HelpIcon />
          Help
        </a>
        <div className="wb-user">
          <span className="wb-user-email" title={user?.email ?? undefined}>
            {user?.email ?? "Signed in"}
          </span>
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
