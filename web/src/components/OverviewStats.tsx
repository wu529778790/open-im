import { PLATFORM_KEYS } from "../constants.js";
import type { PlatformKey } from "../types.js";

interface HealthPlatform { configured?: boolean; enabled?: boolean }

interface Props {
  health: Record<string, unknown> | null;
  serviceStatus: { running: boolean; pid?: number };
}

export function OverviewStats({ health, serviceStatus }: Props) {
  const platforms = (health?.platforms ?? {}) as Record<string, HealthPlatform>;
  let configured = 0;
  let enabled = 0;
  PLATFORM_KEYS.forEach((k: PlatformKey) => {
    const p = platforms[k];
    if (p?.configured) configured += 1;
    if (p?.enabled) enabled += 1;
  });

  return (
    <div className="stats-grid">
      <div className="stat-card">
        <div className="stat-label">已配置</div>
        <div className="stat-value">{configured}/{PLATFORM_KEYS.length}</div>
        <div className="stat-meta">已填写凭证的平台数量</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">已启用</div>
        <div className="stat-value">{enabled}</div>
        <div className="stat-meta">会随服务启动的平台数量</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">服务</div>
        <div className="stat-value">{serviceStatus.running ? "运行中" : "未启动"}</div>
        <div className="stat-meta">{serviceStatus.running ? "本地桥接进程正在运行" : "桥接服务尚未启动"}</div>
      </div>
    </div>
  );
}