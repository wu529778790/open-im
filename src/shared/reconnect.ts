/**
 * 重连韧性共享工具：抖动（jitter）+ 致命错误慢探测。
 *
 * 各平台长连接断开后各自重连，原本退避固定无抖动 → 车队重启会锁步重连风暴；
 * 且致命（鉴权）错误也紧密/无限重试， hammer 网关。
 *
 * 策略（已与产品确认）：
 * - 所有退避加 ±30% 抖动，避免锁步。
 * - 鉴权类致命错误转为**慢探测**（每 5 分钟一次 + 显眼告警）：
 *   既不紧密 hammer，也不永久断连（尊重 WeWork「避免永久断连」意图）。
 */

import { createLogger } from '../logger.js';

const log = createLogger('Reconnect');

/** 慢探测间隔：致命错误后每 5 分钟探测一次。 */
export const SLOW_PROBE_MS = 5 * 60_000;

/**
 * 在 baseMs 上叠加 ±frac 的抖动，避免车队重启锁步重连。
 * jitteredDelay(1000, 0.3) ∈ [700, 1300]。
 */
export function jitteredDelay(baseMs: number, frac = 0.3): number {
  if (baseMs <= 0) return 0;
  const jitter = baseMs * frac * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(baseMs + jitter));
}

/**
 * 判断是否为「致命/不可重试」错误（凭据无效、鉴权失败）。
 * 这类错误紧密重试无意义，应转慢探测。
 */
export function isFatalReconnectError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('401') || msg.includes('403')) return true;
  if (msg.includes('unauthorized') || msg.includes('forbidden')) return true;
  if (msg.includes('invalid signature')) return true;
  if (msg.includes('not subscribed')) return true;
  if (msg.includes('请重新登录') || msg.includes('需要重新登录') || msg.includes('token 已过期')) return true;
  if (msg.includes('invalid') && /token|secret|credential|appid|app_id|corp/.test(msg)) return true;
  return false;
}

/**
 * 计算重连延迟：致命慢探测模式下用 SLOW_PROBE_MS，否则用 jittered(base)。
 * `fatal` 由调用方维护（致命时置 true，成功连上后置 false）。
 */
export function reconnectDelay(baseMs: number, fatal: boolean): number {
  if (fatal) {
    log.warn(`致命错误，转慢探测（${Math.round(SLOW_PROBE_MS / 1000)}s 一次）`);
    return jitteredDelay(SLOW_PROBE_MS);
  }
  return jitteredDelay(baseMs);
}
