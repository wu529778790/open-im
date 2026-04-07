import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeLogger,
  emitStructuredEvent,
  initLogger,
  shutdownLoggerTelemetry,
} from '../logger.js';
import { hashUserId } from './hash-user.js';
import { initTelemetryUpload, enqueueTelemetryLine, shutdownTelemetryUpload } from './telemetry-upload.js';

describe('hashUserId', () => {
  it('is stable for same input', () => {
    expect(hashUserId('u1')).toBe(hashUserId('u1'));
    expect(hashUserId('u1')).not.toBe(hashUserId('u2'));
  });
});

describe('emitStructuredEvent + JSONL', () => {
  let dir: string;

  afterEach(async () => {
    await shutdownLoggerTelemetry();
    await closeLogger();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('writes one JSON line when telemetry enabled', async () => {
    dir = mkdtempSync(join(tmpdir(), 'open-im-ev-'));
    initLogger({
      logDir: dir,
      logLevel: 'INFO',
      telemetry: { enabled: true },
    });
    emitStructuredEvent('Test', 'unit.test', { k: 1 }, 'INFO', 'hello');
    await shutdownLoggerTelemetry();
    await closeLogger();
    const jsonl = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    expect(jsonl.length).toBe(1);
    const line = JSON.parse(readFileSync(join(dir, jsonl[0]), 'utf-8')) as {
      v: number;
      event: string;
      tag: string;
      data: { k: number };
    };
    expect(line.v).toBe(1);
    expect(line.event).toBe('unit.test');
    expect(line.tag).toBe('Test');
    expect(line.data.k).toBe(1);
  });

  it('no-ops when telemetry disabled', async () => {
    dir = mkdtempSync(join(tmpdir(), 'open-im-ev-'));
    initLogger({
      logDir: dir,
      logLevel: 'INFO',
      telemetry: { enabled: false },
    });
    emitStructuredEvent('Test', 'unit.test', {});
    await shutdownLoggerTelemetry();
    await closeLogger();
    const jsonl = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    expect(jsonl.length).toBe(0);
  });
});

describe('telemetry upload', () => {
  it('POSTs NDJSON to HTTPS endpoint on shutdown', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    initTelemetryUpload({
      enabled: true,
      url: 'https://example.com/v1/ingest',
      token: 'secret',
    });
    enqueueTelemetryLine('{"x":1}\n');
    await shutdownTelemetryUpload();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/v1/ingest',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer secret',
          'content-type': 'application/x-ndjson',
        }),
      })
    );
    vi.unstubAllGlobals();
  });

  it('POSTs when queue reaches batch size without waiting for shutdown', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    initTelemetryUpload({
      enabled: true,
      url: 'https://example.com/v1/ingest',
    });
    for (let i = 0; i < 100; i++) {
      enqueueTelemetryLine(`{"n":${i}}\n`);
    }
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await shutdownTelemetryUpload();
    vi.unstubAllGlobals();
  });

  it('does not POST sparse lines until min interval elapses', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    initTelemetryUpload({
      enabled: true,
      url: 'https://example.com/v1/ingest',
    });
    enqueueTelemetryLine('{"sparse":1}\n');
    enqueueTelemetryLine('{"sparse":2}\n');
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await shutdownTelemetryUpload();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
