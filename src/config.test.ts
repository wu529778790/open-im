import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  accessSyncMock,
  existsSyncMock,
  mkdirSyncMock,
  readFileSyncMock,
  statSyncMock,
  writeFileSyncMock,
  execFileSyncMock,
} = vi.hoisted(() => ({
  accessSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  execFileSyncMock: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    accessSync: accessSyncMock,
    existsSync: existsSyncMock,
    mkdirSync: mkdirSyncMock,
    readFileSync: readFileSyncMock,
    statSync: statSyncMock,
    writeFileSync: writeFileSyncMock,
  };
});

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock('./logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    infoEvent: vi.fn(),
  }),
}));

function mockConfigJson(config: unknown) {
  readFileSyncMock.mockImplementation((path: unknown) => {
    if (typeof path === 'string' && path.endsWith('/config.json')) {
      return JSON.stringify(config);
    }
    throw new Error(`unexpected read: ${String(path)}`);
  });
}

describe('config', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(false);
    readFileSyncMock.mockImplementation(() => {
      throw new Error('missing');
    });
    statSyncMock.mockReturnValue({ mtimeMs: 1 });
    accessSyncMock.mockImplementation(() => undefined);
    execFileSyncMock.mockImplementation(() => Buffer.from('ok'));
  });

  it('loadFileConfig returns empty object when config file is missing', async () => {
    const { loadFileConfig } = await import('./config.js');
    const file = loadFileConfig();
    expect(file).toEqual({});
  });

  it('fails startup early when Claude SDK runtime is incomplete', async () => {
    const { loadConfig } = await import('./config.js');
    mockConfigJson({
      tools: {
        claude: {
          env: {
            ANTHROPIC_AUTH_TOKEN: 'token',
          },
        },
      },
      platforms: {
        telegram: {
          enabled: true,
          botToken: 'tg-token',
          aiCommand: 'claude',
        },
      },
    });

    existsSyncMock.mockImplementation((path: unknown) => {
      if (typeof path !== 'string') return false;
      if (path.endsWith('/config.json')) return true;
      if (path.endsWith('/.claude/settings.json')) return false;
      if (path.includes('@anthropic-ai/claude-agent-sdk') && path.endsWith('/cli.js')) return false;
      return false;
    });

    expect(() => loadConfig()).toThrow(/Claude SDK 安装不完整/);
  });
});
