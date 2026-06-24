import { IcoLogo } from "./icons.js";
import { DASHBOARD_NAV_ITEMS, type DashboardNavId } from "./dashboard-nav.js";

interface Props {
  toggleDark: () => void;
  serviceStatus: { running: boolean; pid?: number };
  busy: boolean;
  onValidate: () => void;
  onSave: () => void;
  onToggleService: () => void;
  activeNav: DashboardNavId;
  onNavigate: (id: DashboardNavId) => void;
  sectionTitle: string;
  sectionHint: string;
  showPrimaryActions: boolean;
}

export function Header({
  toggleDark,
  serviceStatus, busy,
  onValidate, onSave, onToggleService,
  activeNav, onNavigate, sectionTitle, sectionHint, showPrimaryActions,
}: Props) {
  return (
    <header className="app-header">
      <div className="app-header-main">
        <div className="app-header-brand" aria-label="open-im">
          <span className="app-header-logo"><IcoLogo /></span>
          <span className="app-header-brand-text">open-im</span>
        </div>

        <nav className="app-nav" aria-label="控制中心">
          {DASHBOARD_NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`app-nav-item ${activeNav === item.id ? "active" : ""}`}
              aria-current={activeNav === item.id ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <item.icon />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="app-header-spacer" />

        <div className={`app-header-status ${serviceStatus.running ? "running" : "idle"}`}>
          <span className={`dot ${serviceStatus.running ? "running" : "idle"}`} />
          <span>{serviceStatus.running ? "运行中" : "未启动"}</span>
          {serviceStatus.running && serviceStatus.pid ? (
            <span className="app-header-status-meta mono">pid {serviceStatus.pid}</span>
          ) : null}
        </div>

        <div className="app-header-tools">
          <a href="https://github.com/wu529778790/open-im" target="_blank" rel="noreferrer" className="btn btn-g btn-sm">GitHub</a>
          <button type="button" className="dark-btn" onClick={toggleDark} aria-label="切换暗黑模式">◐</button>
        </div>
      </div>

      <div className="app-header-context">
        <div className="app-context-copy">
          <h1 className="app-context-title">{sectionTitle}</h1>
          <p className="app-context-hint">{sectionHint}</p>
        </div>
        <div className="app-context-actions" aria-label="桥接：校验、保存、启动、停止">
          {showPrimaryActions ? (
            <>
              <button type="button" className="btn btn-w btn-sm" disabled={busy} onClick={onValidate}>校验配置</button>
              <button type="button" className="btn btn-s btn-sm" disabled={busy} onClick={onSave}>保存配置</button>
              <button
                type="button"
                className={`btn btn-sm ${serviceStatus.running ? "btn-d" : "btn-p"}`}
                disabled={busy}
                onClick={onToggleService}
              >
                {serviceStatus.running ? "停止桥接" : "启动桥接"}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}