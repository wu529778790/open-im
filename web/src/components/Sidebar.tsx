import { IcoAi, IcoFiles, IcoLogo, IcoOverview, IcoPlatforms, IcoWizard } from "./icons.js";

interface Props {
  activeNav: string;
  onNavigate: (id: string) => void;
  t: (k: string) => string;
}

const NAV_ITEMS = [
  { id: "overview",   icon: IcoOverview,  key: "dashboardTitle" },
  { id: "wizard",     icon: IcoWizard,    key: "navSetupWizard" },
  { id: "platforms",  icon: IcoPlatforms, key: "platformsTitle"  },
  { id: "files",      icon: IcoFiles,     key: "navConfigFiles"  },
  { id: "ai",         icon: IcoAi,        key: "aiTitle"         },
] as const;

export function Sidebar({ activeNav, onNavigate, t }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo"><IcoLogo /></div>
        <span className="sidebar-brand">open-im</span>
      </div>
      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Management</div>
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${activeNav === item.id ? "active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            <item.icon />
            <span>{t(item.key)}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
