import { createHash } from 'node:crypto';

/** 展示用哈希：同一 userId 稳定、不可逆还原原文。 */
export function hashUserId(userId: string): string {
  return createHash('sha256').update(`open-im\0${userId}`, 'utf8').digest('hex').slice(0, 24);
}
