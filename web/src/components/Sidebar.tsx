import { NavIconAi, NavIconFiles, NavIconOverview, NavIconPlatforms, NavIconWizard } from "./icons.js";

interface Props {
  activeNav: string;
  onNavigate: (id: "overview" | "platforms" | "ai" | "files" | "wizard") => void;
  t: (k: string) => string;
}

export function Sidebar({ activeNav, onNavigate, t }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          open-im
        </div>
      </div>
      <nav className="sidebar-nav">
        <button type="button" className={`nav-item ${activeNav === "overview" ? "active" : ""}`} onClick={() => onNavigate("overview")}>
          <NavIconOverview />
          <span>{t("dashboardTitle")}</span>
        </button>
        <button type="button" className={`nav-item ${activeNav === "wizard" ? "active" : ""}`} onClick={() => onNavigate("wizard")}>
          <NavIconWizard />
          <span>{t("navSetupWizard")}</span>
        </button>
        <button type="button" className={`nav-item ${activeNav === "platforms" ? "active" : ""}`} onClick={() => onNavigate("platforms")}>
          <NavIconPlatforms />
          <span>{t("platformsTitle")}</span>
        </button>
        <button type="button" className={`nav-item ${activeNav === "files" ? "active" : ""}`} onClick={() => onNavigate("files")}>
          <NavIconFiles />
          <span>{t("navConfigFiles")}</span>
        </button>
        <button type="button" className={`nav-item ${activeNav === "ai" ? "active" : ""}`} onClick={() => onNavigate("ai")}>
          <NavIconAi />
          <span>{t("aiTitle")}</span>
        </button>
      </nav>
    </aside>
  );
}
