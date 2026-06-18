interface Props {
  toggleDark: () => void;
  serviceStatus: { running: boolean; pid?: number };
  busy: boolean;
  onValidate: () => void;
  onSave: () => void;
  onToggleService: () => void;
  t: (k: string) => string;
}

export function Header({
  toggleDark,
  serviceStatus, busy,
  onValidate, onSave, onToggleService,
  t,
}: Props) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="header-status">
          <span className={`dot ${serviceStatus.running ? "running" : "idle"}`} />
          {serviceStatus.running ? t("serviceRunningShort") : t("serviceIdleShort")}
          {serviceStatus.running && serviceStatus.pid ? ` · pid ${serviceStatus.pid}` : ""}
        </div>
      </div>
      <div className="header-right">
        <button type="button" className="btn btn-w btn-sm" disabled={busy} onClick={onValidate}>{t("validate")}</button>
        <button type="button" className="btn btn-s btn-sm" disabled={busy} onClick={onSave}>{t("save")}</button>
        <button
          type="button"
          className={`btn btn-sm ${serviceStatus.running ? "btn-d" : "btn-p"}`}
          disabled={busy}
          onClick={onToggleService}
        >
          {serviceStatus.running ? t("stop") : t("start")}
        </button>
        <div className="header-divider" />
        <a href="https://github.com/wu529778790/open-im" target="_blank" rel="noreferrer" className="btn btn-g btn-sm">GitHub</a>
        <button type="button" className="dark-btn" onClick={toggleDark} aria-label={t("darkModeToggle")}>◐</button>
      </div>
    </header>
  );
}
