const BATCH_MAX_LINES = 50;
const FLUSH_INTERVAL_MS = 4000;
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

function scheduleIdleFlush() {
  if (!uploadEnabled || !endpoint || idleTimer || flushing) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    void flushPipeline();
  }, FLUSH_INTERVAL_MS);
}

async function postBatch(lines: string[]): Promise<boolean> {
  if (!endpoint || lines.length === 0) return true;
  const body = lines.join('');
  const headers: Record<string, string> = {
    'content-type': 'application/x-ndjson',
    accept: 'application/json',
  };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(endpoint, { method: 'POST', headers, body });
  return res.ok;
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
  } finally {
    flushing = false;
    if (uploadEnabled && endpoint && queue.length > 0 && !backoffTimer) {
      scheduleIdleFlush();
    }
  }
}

function backoffThenRetry(): Promise<void> {
  return new Promise((resolve) => {
    clearBackoffTimer();
    backoffTimer = setTimeout(() => {
      backoffTimer = null;
      backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs * 2);
      void flushPipeline().finally(resolve);
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
  if (!uploadEnabled) {
    queue = [];
  }
}

/** 单行 NDJSON（已含 \\n）。 */
export function enqueueTelemetryLine(line: string): void {
  if (!uploadEnabled || !endpoint) return;
  if (queue.length >= MAX_QUEUE) {
    queue.splice(0, Math.floor(MAX_QUEUE / 4));
  }
  queue.push(line);
  if (queue.length >= BATCH_MAX_LINES) {
    clearIdleTimer();
    void flushPipeline();
  } else if (!idleTimer && !flushing && !backoffTimer) {
    scheduleIdleFlush();
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
      await fetch(ep, { method: 'POST', headers, body });
    } catch {
      /* best effort */
    }
  }
}
