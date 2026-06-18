/**
 * Sentry 错误追踪集成
 *
 * 仅捕获错误，不开启性能监控（免费版 5K errors/月 够用）。
 * 通过 OPEN_IM_SENTRY_DSN 环境变量启用。
 */

import * as Sentry from '@sentry/node';
import { createLogger } from '../logger.js';

const log = createLogger('Sentry');

let initialized = false;

/**
 * 初始化 Sentry。无 DSN 则静默跳过。
 */
export function initSentry(): void {
  const dsn = process.env.OPEN_IM_SENTRY_DSN;
  if (!dsn) {
    log.debug('Sentry disabled (no OPEN_IM_SENTRY_DSN)');
    return;
  }

  try {
    Sentry.init({
      dsn,
      // 只捕获 error 级别，不捕获 warning/info
      beforeSend(event) {
        if (event.level !== 'error' && event.level !== 'fatal') return null;
        return event;
      },
      // 不开启 performance monitoring
      tracesSampleRate: 0,
      // 环境标识
      environment: process.env.NODE_ENV ?? 'production',
      // 附加面包屑（错误发生前的日志）
      beforeBreadcrumb(breadcrumb) {
        // 只保留关键 breadcrumb
        if (breadcrumb.category === 'console' || breadcrumb.category === 'http') {
          return breadcrumb;
        }
        return null;
      },
    });
    initialized = true;
    log.info('Sentry initialized');
  } catch (err) {
    log.warn('Sentry init failed:', err);
  }
}

/**
 * 上报错误到 Sentry
 */
export function captureError(error: Error | unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    Sentry.withScope((scope) => {
      if (context) {
        scope.setExtras(context);
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
 * 添加面包屑（错误发生前的上下文）
 */
export function addBreadcrumb(category: string, message: string, data?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    Sentry.addBreadcrumb({
      category,
      message: message.substring(0, 200),
      data,
      level: 'info',
    });
  } catch {
    // ignore
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
