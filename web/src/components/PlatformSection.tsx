import { useState, useCallback } from "react";
import { PLATFORM_DEFINITIONS, PLATFORM_KEYS } from "../constants.js";
import type { PlatformKey, WebConfigPayload } from "../types.js";
import { PlatformCard } from "./PlatformCard.js";

type Req = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;

interface Props {
  payload: WebConfigPayload;
  request: Req;
  /** 平台数据变更回调 */
  onChange: <K extends PlatformKey>(k: K, patch: Partial<WebConfigPayload["platforms"][K]>) => void;
  /** 立即持久化到磁盘（可选，Dashboard 用） */
  onPersist?: (pk: PlatformKey, patch: Record<string, unknown>) => void;
  /** 显示模式：wizard 模式下隐藏部分操作按钮 */
  mode?: "wizard" | "dashboard";
}

/**
 * 共享的平台配置区域组件
 * 
 * 在 SetupWizard 和 Dashboard 中复用，
 * 统一平台卡片的展示和交互逻辑。
 */
export function PlatformSection({ payload, request, onChange, onPersist, mode = "dashboard" }: Props) {
  const [testBusy, setTestBusy] = useState<PlatformKey | null>(null);
  const [testMsg, setTestMsg]   = useState<Partial<Record<PlatformKey, { text: string; ok: boolean }>>>({});

  const testPlatform = async (pk: PlatformKey) => {
    const def = PLATFORM_DEFINITIONS.find(d => d.key === pk); if (!def) return;
    setTestBusy(pk); setTestMsg(m => ({ ...m, [pk]: { text: "", ok: true } }));
    try {
      const cfg: Record<string, string> = {}; def.testFields.forEach(f => { cfg[f] = String((payload.platforms[pk] as Record<string, string>)[f] ?? ""); });
      const r = (await request("/api/config/test", { method: "POST", body: JSON.stringify({ platform: pk, config: cfg }) })) as { success?: boolean; message?: string; error?: string };
      setTestMsg(m => ({ ...m, [pk]: r.success ? { text: r.message || "配置校验通过。", ok: true } : { text: `配置有问题：${r.error || "?"}`, ok: false } }));
    } catch (e) { setTestMsg(m => ({ ...m, [pk]: { text: `配置有问题：${e instanceof Error ? e.message : String(e)}`, ok: false } })); }
    finally { setTestBusy(null); }
  };

  /* 已启用/已配置的平台数量统计 */
  const enabledCount = PLATFORM_KEYS.filter(k => payload.platforms[k].enabled).length;

  return (
    <div>
      <div className="platform-grid">
        {PLATFORM_DEFINITIONS.map((def) => {
          const pk = def.key as PlatformKey;
          return (
            <PlatformCard
              key={pk}
              def={def}
              values={payload.platforms[pk]}
              disabledVisual={false}
              request={request}
              onChange={(p) => onChange(pk, p as Partial<WebConfigPayload["platforms"][typeof pk]>)}
              onTest={() => void testPlatform(pk)}
              testing={testBusy === pk}
              testResult={testMsg[pk]}
              onPersist={onPersist ? (p) => onPersist(pk, p) : undefined}
            />
          );
        })}
      </div>
      
      {/* 平台统计（仅 wizard 模式显示） */}
      {mode === "wizard" && (
        <div style={{ 
          padding: "12px 0 0", 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center",
          fontSize: 13,
          color: "var(--c-text-3)"
        }}>
          <span>
            {enabledCount} / {PLATFORM_KEYS.length} 个平台已配置
          </span>
        </div>
      )}
    </div>
  );
}
