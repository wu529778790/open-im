import { sanitize } from '../sanitize.js';

const MAX_STRING = 512;

function sanitizeValue(v: unknown): unknown {
  if (v === null || typeof v === 'boolean' || typeof v === 'number') return v;
  if (typeof v === 'string') {
    const s = sanitize(v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v);
    return s;
  }
  if (Array.isArray(v)) return v.slice(0, 32).map((x) => sanitizeValue(x));
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let i = 0;
    for (const [k, val] of Object.entries(o)) {
      if (i++ >= 32) break;
      out[k] = sanitizeValue(val);
    }
    return out;
  }
  return undefined;
}

/** 结构化遥测 data 字段：截断长串、走 sanitize。 */
export function sanitizeTelemetryData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  return sanitizeValue(data) as Record<string, unknown>;
}
