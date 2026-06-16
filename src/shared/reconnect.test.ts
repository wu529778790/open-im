import { describe, expect, it } from 'vitest';
import { jitteredDelay, isFatalReconnectError, SLOW_PROBE_MS, reconnectDelay } from './reconnect.js';

describe('jitteredDelay', () => {
  it('returns 0 for a base of 0', () => {
    expect(jitteredDelay(0)).toBe(0);
  });

  it('stays within ±30% of the base across many samples', () => {
    for (let i = 0; i < 100; i++) {
      const d = jitteredDelay(1000, 0.3);
      expect(d).toBeGreaterThanOrEqual(700);
      expect(d).toBeLessThanOrEqual(1300);
    }
  });
});

describe('isFatalReconnectError', () => {
  it('flags auth/credential errors as fatal', () => {
    expect(isFatalReconnectError(new Error('Unauthorized 401'))).toBe(true);
    expect(isFatalReconnectError(new Error('403 Forbidden'))).toBe(true);
    expect(isFatalReconnectError(new Error('invalid signature'))).toBe(true);
    expect(isFatalReconnectError(new Error('invalid token'))).toBe(true);
    expect(isFatalReconnectError(new Error('Subscribe failed: 846609 not subscribed'))).toBe(true);
    expect(isFatalReconnectError('Token 已过期，请重新登录')).toBe(true);
  });

  it('does not flag transient errors', () => {
    expect(isFatalReconnectError(new Error('ECONNRESET'))).toBe(false);
    expect(isFatalReconnectError(new Error('read timeout'))).toBe(false);
    expect(isFatalReconnectError(new Error('session idle timeout'))).toBe(false);
  });
});

describe('reconnectDelay', () => {
  it('uses the slow-probe interval when fatal', () => {
    const d = reconnectDelay(1000, true);
    expect(d).toBeGreaterThanOrEqual(Math.round(SLOW_PROBE_MS * 0.7));
    expect(d).toBeLessThanOrEqual(Math.round(SLOW_PROBE_MS * 1.3));
  });

  it('uses the jittered base when not fatal', () => {
    const d = reconnectDelay(1000, false);
    expect(d).toBeGreaterThanOrEqual(700);
    expect(d).toBeLessThanOrEqual(1300);
  });
});
