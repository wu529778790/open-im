import type { Lang } from "../hooks/useI18n.js";

interface Props {
  lang: Lang;
  toggleLang: () => void;
  toggleDark: () => void;
  serviceStatus: { running: boolean; pid?: number };
  busy: boolean;
  onValidate: () => void;
  onSave: () => void;
  onToggleService: () => void;
  t: (k: string) => string;
}

export function Header({
  lang,
  toggleLang,
  toggleDark,
  serviceStatus,
  busy,
  onValidate,
  onSave,
  onToggleService,
  t,
}: Props) {
  return (
    <header className="main-header">
      <div className="main-header-top">
        <div>
          <h1 className="main-title">{t("dashboardTitle")}</h1>
        </div>
        <div className="header-actions">
          <a href="https://github.com/wu529778790/open-im" target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            GitHub
          </a>
          <button type="button" className="dark-mode-toggle" onClick={toggleDark} aria-label={t("darkModeToggle")}>
            ◐
          </button>
          <button type="button" className="lang-button" onClick={toggleLang}>
            {lang === "zh" ? "EN" : "中文"}
          </button>
        </div>
      </div>
      <div className="main-header-toolbar" role="toolbar" aria-label={t("headerToolbarAria")}>
        <button type="button" className="btn btn-warning btn-sm" disabled={busy} onClick={onValidate}>
          {t("validate")}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onSave}>
          {t("save")}
        </button>
        <button
          type="button"
          className={`btn btn-sm ${serviceStatus.running ? "btn-danger" : "btn-primary"}`}
          disabled={busy}
          onClick={onToggleService}
        >
          {serviceStatus.running ? t("stop") : t("start")}
        </button>
      </div>
    </header>
  );
}
