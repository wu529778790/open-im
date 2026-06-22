import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk/v2';
import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';
import type { ServerOptions } from '@opencode-ai/sdk/v2/server';
import { createLogger } from '../logger.js';

const log = createLogger('OpenCodeSDK');

interface SdkInstance {
  client: OpencodeClient;
  server: { url: string; close(): void };
}

let instance: SdkInstance | null = null;

export async function startOpencode(options?: {
  hostname?: string;
  port?: number;
  signal?: AbortSignal;
  timeout?: number;
}): Promise<OpencodeClient> {
  if (instance) {
    log.info('OpenCode SDK already running');
    return instance.client;
  }

  log.info('Starting OpenCode SDK server...');
  const result = await createOpencode({
    hostname: options?.hostname ?? '127.0.0.1',
    port: options?.port ?? 0,
    signal: options?.signal,
    timeout: options?.timeout ?? 15000,
  });

  log.info(`OpenCode server started at ${result.server.url}`);
  instance = result as SdkInstance;
  return instance.client;
}

export function stopOpencode(): void {
  if (instance) {
    log.info('Stopping OpenCode SDK server...');
    instance.server.close();
    instance = null;
    log.info('OpenCode SDK server stopped');
  }
}

export function getOpencodeClient(): OpencodeClient {
  if (!instance) {
    throw new Error('OpenCode SDK not started');
  }
  return instance.client;
}

export function isOpencodeRunning(): boolean {
  return instance !== null;
}

export async function connectToOpencode(baseUrl?: string): Promise<OpencodeClient> {
  if (instance) return instance.client;

  const url = baseUrl ?? 'http://127.0.0.1:4096';
  log.info(`Connecting to existing OpenCode server at ${url}`);
  const client = createOpencodeClient({ baseUrl: url });
  instance = { client, server: { url, close() {} } };
  return client;
}
