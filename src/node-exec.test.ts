import { describe, expect, it, vi, afterEach } from 'vitest';

describe('resolveNodeExecutable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('returns a non-empty string', async () => {
    const { resolveNodeExecutable } = await import('./node-exec.js');
    const p = resolveNodeExecutable();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
  });
});
