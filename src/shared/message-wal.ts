/**
 * Message WAL (Write-Ahead Log) — 消息持久化
 *
 * 进程崩溃时保留未处理的消息，重启后可重放。
 * 实现：JSONL 文件，每条消息一行。
 */

import { createWriteStream, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP_HOME } from '../constants.js';
import { createLogger } from '../logger.js';

const log = createLogger('MessageWAL');

export interface WALEntry {
  msgId: string;
  platform: string;
  userId: string;
  chatId: string;
  text: string;
  timestamp: number;
  status: 'pending' | 'done';
}

const WAL_DIR = join(APP_HOME, 'data');
const WAL_FILE = join(WAL_DIR, 'messages.jsonl');

let stream: ReturnType<typeof createWriteStream> | null = null;

function ensureDir(): void {
  if (!existsSync(WAL_DIR)) mkdirSync(WAL_DIR, { recursive: true });
}

/**
 * 写入消息到 WAL（处理前调用）
 */
export function walWrite(entry: Omit<WALEntry, 'status'>): void {
  try {
    ensureDir();
    const line = JSON.stringify({ ...entry, status: 'pending' }) + '\n';
    if (!stream) {
      stream = createWriteStream(WAL_FILE, { flags: 'a' });
    }
    stream.write(line);
  } catch (err) {
    log.warn('WAL write failed:', err);
  }
}

/**
 * 标记消息为已处理（处理后调用）
 */
export function walCommit(msgId: string): void {
  try {
    ensureDir();
    // 读取所有条目，过滤掉已完成的
    const entries = readAllEntries();
    const pending = entries.filter(e => !(e.msgId === msgId && e.status === 'pending'));
    // 重写文件（只保留未完成的）
    writeFileSync(WAL_FILE, pending.map(e => JSON.stringify(e)).join('\n') + (pending.length ? '\n' : ''), 'utf-8');
  } catch (err) {
    log.warn('WAL commit failed:', err);
  }
}

/**
 * 读取所有未处理的消息（重启时调用）
 */
export function walReadPending(): WALEntry[] {
  try {
    ensureDir();
    const entries = readAllEntries();
    return entries.filter(e => e.status === 'pending');
  } catch (err) {
    log.warn('WAL read failed:', err);
    return [];
  }
}

/**
 * 清空 WAL 文件（所有消息处理完后调用）
 */
export function walClear(): void {
  try {
    ensureDir();
    writeFileSync(WAL_FILE, '', 'utf-8');
  } catch (err) {
    log.warn('WAL clear failed:', err);
  }
}

function readAllEntries(): WALEntry[] {
  if (!existsSync(WAL_FILE)) return [];
  const content = readFileSync(WAL_FILE, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map(line => {
    try { return JSON.parse(line) as WALEntry; }
    catch { return null; }
  }).filter((e): e is WALEntry => e !== null);
}
