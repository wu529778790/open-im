/**
 * Sentry 错误追踪集成
 *
 * - 默认启用，收集错误用于改进产品质量
 * - 用户可通过 OPEN_IM_TELEMETRY=false 或 config.json opt-out
 * - 只收集错误类型和堆栈，不收集用户数据（PII）
 */

import * as Sentry from '@sentry/node';
import { createLogger } from '../logger.js';

const log = createLogger('Sentry');

// 开发者的 Sentry DSN（所有 open-im 实例共享）
const DEFAULT_DSN = 'https://cc5ad094c1229b2a2ff23ab54b0fd807@o4508612762861568.ingest.us.sentry.io/4511583989727232';

let initialized = false;

/**
 * 清理 PII（用户数据）
 * 只保留错误信息，移除敏感内容
 */
function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    // 跳过敏感字段
    if (/token|secret|password|key|api_key|apikey|auth/i.test(key)) continue;
    // 跳过用户 ID（只保留平台信息）
    if (/userId|user_id|userKey|user_key/i.test(key)) {
      clean[key] = '[redacted]';
      continue;
    }
    // 截断长字符串
    if (typeof value === 'string' && value.length > 200) {
      clean[key] = value.substring(0, 200) + '...';
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * 初始化 Sentry
 * - 默认启用（收集错误改进产品）
 * - 用户可通过 OPEN_IM_TELEMETRY=false 或 telemetry.enabled=false opt-out
 */
export function initSentry(telemetryEnabled = true): void {
  // 检查 opt-out
  const envOptOut = process.env.OPEN_IM_TELEMETRY?.trim().toLowerCase();
  if (envOptOut === 'false' || envOptOut === '0' || envOptOut === 'no' || !telemetryEnabled) {
    log.debug('Sentry disabled (user opt-out)');
    return;
  }

  // 优先使用用户自定义 DSN，否则用默认 DSN
  const dsn = process.env.OPEN_IM_SENTRY_DSN || DEFAULT_DSN;

  try {
    Sentry.init({
      dsn,
      // 只捕获 error 级别
      beforeSend(event) {
        if (event.level !== 'error' && event.level !== 'fatal') return null;

        // 清理 PII
        if (event.extra) {
          event.extra = sanitizeContext(event.extra as Record<string, unknown>);
        }
        if (event.contexts) {
          for (const [key, value] of Object.entries(event.contexts)) {
            if (typeof value === 'object' && value !== null) {
              (event.contexts as Record<string, unknown>)[key] = sanitizeContext(value as Record<string, unknown>);
            }
          }
        }

        return event;
      },
      // 不开启 performance monitoring
      tracesSampleRate: 0,
      // 环境标识
      environment: process.env.NODE_ENV ?? 'production',
      // 附加面包屑
      beforeBreadcrumb(breadcrumb) {
        if (breadcrumb.category === 'console' || breadcrumb.category === 'http') {
          return breadcrumb;
        }
        return null;
      },
    });
    initialized = true;
    log.info('Sentry initialized (error tracking enabled)');
  } catch (err) {
    log.warn('Sentry init failed:', err);
  }
}

/**
 * 上报错误到 Sentry（自动清理 PII）
 */
export function captureError(error: Error | unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    Sentry.withScope((scope) => {
      if (context) {
        scope.setExtras(sanitizeContext(context));
      }
      if (error instanceof Error) {
        scope.setTag('error.name', error.name);
        scope.setTag('error.message', error.message.substring(0, 200));
      }
      Sentry.captureException(error);
    });
  } catch {
    // Sentry 本身不应影响业务
  }
}

/**
 * 刷新并关闭 Sentry（优雅关闭时调用）
 */
export async function flushSentry(): Promise<void> {
  if (!initialized) return;
  try {
    await Sentry.flush(3000);
  } catch {
    // ignore
  }
}
