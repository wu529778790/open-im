import { IcoLogo } from "./icons.js";
import { DASHBOARD_NAV_ITEMS, type DashboardNavId } from "./dashboard-nav.js";

interface Props {
  activeNav: string;
  onNavigate: (id: string) => void;
  t: (k: string) => string;
}

export function Sidebar({ activeNav, onNavigate, t }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo"><IcoLogo /></div>
        <span className="sidebar-brand">open-im</span>
      </div>
      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Management</div>
        {DASHBOARD_NAV_ITEMS.map(item => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${activeNav === item.id ? "active" : ""}`}
            onClick={() => onNavigate(item.id as DashboardNavId)}
          >
            <item.icon />
            <span>{t(item.key)}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
