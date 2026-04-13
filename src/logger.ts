import { createWriteStream, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { WriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { sanitize } from './sanitize.js';
import { APP_HOME } from './constants.js';
import { sanitizeTelemetryData } from './telemetry/telemetry-sanitize.js';
import {
  enqueueTelemetryLine,
  getTelemetryUploadStats,
  initTelemetryUpload,
  shutdownTelemetryUpload,
} from './telemetry/telemetry-upload.js';

const DEFAULT_LOG_DIR = join(APP_HOME, 'logs');
const MAX_LOG_FILES = 10;
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 } as const;
export type LogLevel = keyof typeof LOG_LEVELS;

export interface TelemetryInitOptions {
  enabled: boolean;
  url?: string;
  token?: string;
}

export interface LoggerInitOptions {
  logDir?: string;
  logLevel?: LogLevel;
  telemetry?: TelemetryInitOptions;
}

let logDir = DEFAULT_LOG_DIR;
let minLevel: number = LOG_LEVELS.DEBUG;

let logStream: WriteStream | undefined;
let eventsStream: WriteStream | undefined;
let telemetryEnabled = false;
let telemetryStatsTimer: ReturnType<typeof setInterval> | null = null;
let lastTelemetryStatsSignature = '';
const TELEMETRY_STATS_INTERVAL_MS = 5 * 60_000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function getLogFileName(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`;
}

function getEventsFileName(): string {
  const d = new Date();
  return `events-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.jsonl`;
}

function rotateOldLogs() {
  try {
    const files = readdirSync(logDir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => ({ name: f, time: statSync(join(logDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (let i = MAX_LOG_FILES; i < files.length; i++) {
      unlinkSync(join(logDir, files[i].name));
    }
  } catch {
    /* ignore */
  }
}

function rotateOldJsonl() {
  try {
    const files = readdirSync(logDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ name: f, time: statSync(join(logDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (let i = MAX_LOG_FILES; i < files.length; i++) {
      unlinkSync(join(logDir, files[i].name));
    }
  } catch {
    /* ignore */
  }
}

export function initLogger(dirOrOpts?: string | LoggerInitOptions, level?: LogLevel, telemetry?: TelemetryInitOptions) {
  let dir: string | undefined;
  let lev: LogLevel | undefined;
  let tel: TelemetryInitOptions | undefined;
  if (dirOrOpts && typeof dirOrOpts === 'object' && !Array.isArray(dirOrOpts)) {
    dir = dirOrOpts.logDir;
    lev = dirOrOpts.logLevel;
    tel = dirOrOpts.telemetry;
  } else {
    dir = dirOrOpts as string | undefined;
    lev = level;
    tel = telemetry;
  }

  if (dir) logDir = dir;
  if (lev) minLevel = LOG_LEVELS[lev] ?? LOG_LEVELS.DEBUG;
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  rotateOldLogs();
  logStream = createWriteStream(join(logDir, getLogFileName()), { flags: 'a' });

  telemetryEnabled = !!tel?.enabled;
  if (telemetryStatsTimer) {
    clearInterval(telemetryStatsTimer);
    telemetryStatsTimer = null;
  }
  lastTelemetryStatsSignature = '';
  if (eventsStream) {
    eventsStream.end();
    eventsStream = undefined;
  }
  if (telemetryEnabled) {
    rotateOldJsonl();
    eventsStream = createWriteStream(join(logDir, getEventsFileName()), { flags: 'a' });
    initTelemetryUpload({
      enabled: true,
      url: tel?.url,
      token: tel?.token,
    });
    telemetryStatsTimer = setInterval(() => {
      emitTelemetryUploadStats(false);
    }, TELEMETRY_STATS_INTERVAL_MS);
  } else {
    initTelemetryUpload({ enabled: false });
  }
}

function emitTelemetryUploadStats(force: boolean): void {
  if (!telemetryEnabled) return;
  const stats = getTelemetryUploadStats();
  const signature = JSON.stringify(stats);
  if (!force && signature === lastTelemetryStatsSignature) return;
  lastTelemetryStatsSignature = signature;
  emitStructuredEvent('Telemetry', 'telemetry.upload.stats', stats);
}

function write(level: keyof typeof LOG_LEVELS, tag: string, msg: string, ...args: unknown[]) {
  if (LOG_LEVELS[level] < minLevel) return;
  const d = new Date();
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const extra = args.length > 0 ? ' ' + args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ') : '';
  const line = sanitize(`${ts} [${level}] [${tag}] ${msg}${extra}\n`);
  if (level === 'ERROR') process.stderr.write(line);
  else process.stdout.write(line);
  logStream?.write(line);
}

export function createLogger(tag: string) {
  return {
    info: (msg: string, ...args: unknown[]) => write('INFO', tag, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => write('WARN', tag, msg, ...args),
    error: (msg: string, ...args: unknown[]) => write('ERROR', tag, msg, ...args),
    debug: (msg: string, ...args: unknown[]) => write('DEBUG', tag, msg, ...args),
    infoEvent: (event: string, data?: Record<string, unknown>, msg?: string) =>
      emitStructuredEvent(tag, event, data, 'INFO', msg),
  };
}

export function emitStructuredEvent(
  tag: string,
  event: string,
  data?: Record<string, unknown>,
  level: LogLevel = 'INFO',
  msg = ''
): void {
  if (!telemetryEnabled) return;
  const payload = {
    v: 1,
    ts: new Date().toISOString(),
    level,
    tag,
    event,
    msg,
    data: sanitizeTelemetryData(data),
  };
  const line = `${JSON.stringify(payload)}\n`;
  eventsStream?.write(line);
  enqueueTelemetryLine(line);
}

export async function shutdownLoggerTelemetry(): Promise<void> {
  emitTelemetryUploadStats(true);
  if (telemetryStatsTimer) {
    clearInterval(telemetryStatsTimer);
    telemetryStatsTimer = null;
  }
  await shutdownTelemetryUpload();
}

export async function closeLogger(): Promise<void> {
  if (eventsStream) {
    const es = eventsStream;
    eventsStream = undefined;
    es.end();
    try {
      await finished(es);
    } catch {
      /* ignore */
    }
  }
  if (logStream) {
    const ls = logStream;
    logStream = undefined;
    ls.end();
    try {
      await finished(ls);
    } catch {
      /* ignore */
    }
  }
}
