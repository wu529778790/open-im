/**
 * 遥测 NDJSON 上传：
 * - 单次 POST 最多 BATCH_MAX_LINES 条（控制 body 大小）；
 * - 事件稀疏时按 MIN_PARTIAL_FLUSH_INTERVAL_MS 合并上报，降低时间维度上的请求频率；
 * - 积压达到 BATCH_MAX_LINES 时仍立即上传（突发流量）。
 */
const BATCH_MAX_LINES = 100;
/** 稀疏流量：队列未满批时，最早在「首条入队」后经过该间隔才上传（避免短间隔反复 POST） */
const MIN_PARTIAL_FLUSH_INTERVAL_MS = 60_000;
const MAX_QUEUE = 8000;
const MAX_BACKOFF_MS = 120_000;
const INITIAL_BACKOFF_MS = 1000;

let queue: string[] = [];
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = INITIAL_BACKOFF_MS;
let uploadEnabled = false;
let endpoint: string | undefined;
let bearer: string | undefined;
let flushing = false;

interface TelemetryUploadStats {
  postedBatches: number;
  postedLines: number;
  retryableFailures: number;
  dropped4xxBatches: number;
  dropped4xxLines: number;
  networkFailures: number;
}

const stats: TelemetryUploadStats = {
  postedBatches: 0,
  postedLines: 0,
  retryableFailures: 0,
  dropped4xxBatches: 0,
  dropped4xxLines: 0,
  networkFailures: 0,
};

function resetStats() {
  stats.postedBatches = 0;
  stats.postedLines = 0;
  stats.retryableFailures = 0;
  stats.dropped4xxBatches = 0;
  stats.dropped4xxLines = 0;
  stats.networkFailures = 0;
}

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function clearBackoffTimer() {
  if (backoffTimer) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
}

function schedulePartialFlush(): void {
  if (!uploadEnabled || !endpoint || idleTimer || flushing || backoffTimer) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    void flushPipeline().catch(() => {
      /* 静默；退避重试由 flushPipeline/backoff 处理 */
    });
  }, MIN_PARTIAL_FLUSH_INTERVAL_MS);
}

async function postBatch(lines: string[]): Promise<boolean> {
  if (!endpoint || lines.length === 0) return true;
  const body = lines.join('');
  const headers: Record<string, string> = {
    'content-type': 'application/x-ndjson',
    accept: 'application/json',
  };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  try {
    const res = await fetch(endpoint, { method: 'POST', headers, body });
    try {
      await res.text();
    } catch {
      /* ignore body read errors */
    }
    if (res.ok) {
      stats.postedBatches += 1;
      stats.postedLines += lines.length;
      return true;
    }
    // 4xx（除 408/429）通常是请求本身不可恢复（鉴权/格式错误），不应无限重试。
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      stats.dropped4xxBatches += 1;
      stats.dropped4xxLines += lines.length;
      return true;
    }
    stats.retryableFailures += 1;
    return false;
  } catch {
    stats.networkFailures += 1;
    return false;
  }
}

async function flushPipeline(): Promise<void> {
  if (!uploadEnabled || !endpoint || flushing) return;
  if (queue.length === 0) return;
  flushing = true;
  try {
    while (uploadEnabled && endpoint && queue.length > 0) {
      const batch = queue.splice(0, BATCH_MAX_LINES);
      try {
        const ok = await postBatch(batch);
        if (ok) {
          backoffMs = INITIAL_BACKOFF_MS;
          clearBackoffTimer();
        } else {
          queue.unshift(...batch);
          await backoffThenRetry();
          break;
        }
      } catch {
        queue.unshift(...batch);
        await backoffThenRetry();
        break;
      }
    }
  } catch {
    /* 静默：上传失败不得向外抛，避免 unhandledRejection */
  } finally {
    flushing = false;
  }
}

function backoffThenRetry(): Promise<void> {
  return new Promise((resolve) => {
    clearBackoffTimer();
    backoffTimer = setTimeout(() => {
      backoffTimer = null;
      backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs * 2);
      void flushPipeline().catch(() => {}).finally(resolve);
    }, backoffMs);
  });
}

export function initTelemetryUpload(opts: { enabled: boolean; url?: string; token?: string }): void {
  clearIdleTimer();
  clearBackoffTimer();
  uploadEnabled = opts.enabled && !!opts.url;
  endpoint = opts.url;
  bearer = opts.token;
  backoffMs = INITIAL_BACKOFF_MS;
  resetStats();
  if (!uploadEnabled) {
    queue = [];
  }
}

/**
 * 单行 NDJSON（已含 \\n）。
 * 满 BATCH_MAX_LINES 立即上传；否则自「当前积压周期」起至少间隔 MIN_PARTIAL_FLUSH_INTERVAL_MS 再上传。
 */
export function enqueueTelemetryLine(line: string): void {
  if (!uploadEnabled || !endpoint) return;
  if (queue.length >= MAX_QUEUE) {
    queue.splice(0, Math.floor(MAX_QUEUE / 4));
  }
  const wasEmpty = queue.length === 0;
  queue.push(line);
  if (queue.length >= BATCH_MAX_LINES) {
    clearIdleTimer();
    void flushPipeline().catch(() => {
      /* 静默 */
    });
    return;
  }
  if (wasEmpty && !idleTimer && !flushing && !backoffTimer) {
    schedulePartialFlush();
  }
}

export async function shutdownTelemetryUpload(): Promise<void> {
  clearIdleTimer();
  clearBackoffTimer();
  if (!uploadEnabled || !endpoint) {
    queue = [];
    uploadEnabled = false;
    endpoint = undefined;
    bearer = undefined;
    return;
  }
  const ep = endpoint;
  const br = bearer;
  const pending = queue;
  queue = [];
  uploadEnabled = false;
  endpoint = undefined;
  bearer = undefined;
  let lines = pending;
  while (lines.length > 0) {
    const batch = lines.splice(0, BATCH_MAX_LINES);
    try {
      const body = batch.join('');
      const headers: Record<string, string> = {
        'content-type': 'application/x-ndjson',
        accept: 'application/json',
      };
      if (br) headers.authorization = `Bearer ${br}`;
      const res = await fetch(ep, { method: 'POST', headers, body });
      try {
        if (typeof res.text === 'function') {
          await res.text();
        }
      } catch {
        /* ignore body read errors */
      }
      if (res.ok) {
        stats.postedBatches += 1;
        stats.postedLines += batch.length;
      } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        stats.dropped4xxBatches += 1;
        stats.dropped4xxLines += batch.length;
      } else {
        stats.retryableFailures += 1;
      }
    } catch {
      stats.networkFailures += 1;
      /* best effort，静默 */
    }
  }
}

export function getTelemetryUploadStats(): Readonly<TelemetryUploadStats> {
  return { ...stats };
}
