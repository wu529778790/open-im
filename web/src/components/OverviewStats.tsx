import type { PlatformKey } from "../types.js";
import { PLATFORM_KEYS } from "../constants.js";

interface HealthPlatform {
  configured?: boolean;
  enabled?: boolean;
}

interface Props {
  health: Record<string, unknown> | null;
  serviceStatus: { running: boolean; pid?: number };
  t: (k: string) => string;
}

export function OverviewStats({ health, serviceStatus, t }: Props) {
  const platforms = (health?.platforms ?? {}) as Record<string, HealthPlatform>;
  let configured = 0;
  let enabled = 0;
  PLATFORM_KEYS.forEach((k: PlatformKey) => {
    const p = platforms[k];
    if (p?.configured) configured += 1;
    if (p?.enabled) enabled += 1;
  });
  const total = PLATFORM_KEYS.length;

  return (
    <section className="section">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">{t("statConfiguredLabel")}</div>
          <div className="stat-value">
            {configured}/{total}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("statEnabledLabel")}</div>
          <div className="stat-value">{enabled}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("statServiceLabel")}</div>
          <div className="stat-value">{serviceStatus.running ? t("serviceRunningShort") : t("serviceIdleShort")}</div>
        </div>
      </div>
    </section>
  );
}
