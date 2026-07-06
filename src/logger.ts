import { createWriteStream, mkdirSync, existsSync, readdirSync, statSync, unlinkSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import type { WriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { pipeline } from 'node:stream';
import { createGzip } from 'node:zlib';
import { sanitize } from './sanitize.js';
import { APP_HOME } from './constants.js';

const DEFAULT_LOG_DIR = join(APP_HOME, 'logs');
const MAX_LOG_FILES = 10;
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
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
let auditStream: WriteStream | undefined;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function getLogFileName(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`;
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
  } catch (err) {
    // 日志轮转失败不影响主流程
    console.error('Failed to rotate log files:', err);
  }
}

/**
 * 压缩日志文件
 */
function compressFile(filePath: string): void {
  try {
    const gzip = createGzip();
    const source = createReadStream(filePath);
    const destination = createWriteStream(filePath + '.gz');
    
    pipeline(source, gzip, destination, (err) => {
      if (err) {
        console.error('Failed to compress log file:', err);
      } else {
        // 压缩成功，删除原文件
        try {
          unlinkSync(filePath);
        } catch (e) {
          console.error('Failed to delete original log file:', e);
        }
      }
    });
  } catch (err) {
    console.error('Failed to compress log file:', err);
  }
}

/**
 * 检查日志文件大小，必要时轮转
 */
function checkLogSize(): void {
  if (!logStream) return;
  
  try {
    const currentLogPath = join(logDir, getLogFileName());
    // ENOENT 防御：上次轮转刚 unlink 当前文件、新流尚未建立时，
    // write() 可能追入旧 stream 后立刻触发 checkLogSize()。此时文件不存在，
    // 直接跳过，下一轮 write() 会自动建好新文件。
    if (!existsSync(currentLogPath)) return;
    const stats = statSync(currentLogPath);
    
    if (stats.size > MAX_LOG_SIZE) {
      // 关闭当前日志流
      logStream.end();
      logStream = undefined;
      
      // 压缩当前日志文件
      compressFile(currentLogPath);
      
      // 创建新的日志文件
      logStream = createWriteStream(join(logDir, getLogFileName()), { flags: 'a' });
    }
  } catch (err) {
    console.error('Failed to check log size:', err);
  }
}

export function initLogger(dirOrOpts?: string | LoggerInitOptions, level?: LogLevel, telemetry?: TelemetryInitOptions) {
  let dir: string | undefined;
  let lev: LogLevel | undefined;
  if (dirOrOpts && typeof dirOrOpts === 'object' && !Array.isArray(dirOrOpts)) {
    dir = dirOrOpts.logDir;
    lev = dirOrOpts.logLevel;
  } else {
    dir = dirOrOpts as string | undefined;
    lev = level;
  }

  if (dir) logDir = dir;
  if (lev) minLevel = LOG_LEVELS[lev] ?? LOG_LEVELS.DEBUG;
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  rotateOldLogs();
  logStream = createWriteStream(join(logDir, getLogFileName()), { flags: 'a' });

  // Audit log — always enabled, separate file
  if (auditStream) { auditStream.end(); auditStream = undefined; }
  auditStream = createWriteStream(join(logDir, 'audit.log'), { flags: 'a' });
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
  
  // 检查日志文件大小
  checkLogSize();
}

export function createLogger(tag: string) {
  return {
    info: (msg: string, ...args: unknown[]) => write('INFO', tag, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => write('WARN', tag, msg, ...args),
    error: (msg: string, ...args: unknown[]) => write('ERROR', tag, msg, ...args),
    debug: (msg: string, ...args: unknown[]) => write('DEBUG', tag, msg, ...args),
  };
}

/**
 * Audit log — records user interactions for debugging and compliance.
 * Always enabled, writes to audit.log.
 */
export function auditLog(
  platform: string,
  userId: string,
  action: string,
  detail?: Record<string, unknown>,
): void {
  const entry = {
    ts: new Date().toISOString(),
    platform,
    userId,
    action,
    ...detail,
  };
  auditStream?.write(JSON.stringify(entry) + '\n');
}

export async function closeLogger(): Promise<void> {
  if (auditStream) {
    const as = auditStream;
    auditStream = undefined;
    as.end();
    try {
      await finished(as);
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
