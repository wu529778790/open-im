import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  accessSyncMock,
  existsSyncMock,
  mkdirSyncMock,
  readFileSyncMock,
  readdirSyncMock,
  requireResolveMock,
  statSyncMock,
  writeFileSyncMock,
  execFileSyncMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  accessSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
  requireResolveMock: vi.fn(),
  statSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  execFileSyncMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    accessSync: accessSyncMock,
    existsSync: existsSyncMock,
    mkdirSync: mkdirSyncMock,
    readFileSync: readFileSyncMock,
    readdirSync: readdirSyncMock,
    statSync: statSyncMock,
    writeFileSync: writeFileSyncMock,
  };
});

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock('node:module', async () => {
  const actual = await vi.importActual<typeof import('node:module')>('node:module');
  return {
    ...actual,
    createRequire: () => ({
      resolve: requireResolveMock,
    }),
  };
});

vi.mock('./logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: loggerWarnMock,
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
    delete process.env.OPEN_IM_SKIP_PERMISSIONS;
    existsSyncMock.mockReturnValue(false);
    readFileSyncMock.mockImplementation(() => {
      throw new Error('missing');
    });
    readdirSyncMock.mockReturnValue([]);
    requireResolveMock.mockImplementation((specifier: string) => {
      if (specifier === '@anthropic-ai/claude-agent-sdk') {
        return '/mock/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs';
      }
      throw Object.assign(new Error(`Cannot find module '${specifier}'`), {
        code: 'MODULE_NOT_FOUND',
      });
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

  it('fails startup early when Claude SDK CLI cannot launch', async () => {
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
      if (path.includes('@anthropic-ai/claude-agent-sdk') && path.endsWith('/cli.js')) return true;
      return false;
    });
    execFileSyncMock.mockImplementation((command: unknown, args: unknown) => {
      if (
        command === process.execPath &&
        Array.isArray(args) &&
        typeof args[0] === 'string' &&
        args[0].includes('@anthropic-ai/claude-agent-sdk') &&
        args[0].endsWith('/cli.js') &&
        args[1] === '--version'
      ) {
        throw Object.assign(new Error('Command failed'), {
          stderr: Buffer.from(
            'Native CLI binary for win32-x64 not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set options.pathToClaudeCodeExecutable.'
          ),
        });
      }
      return Buffer.from('ok');
    });

    expect(() => loadConfig()).toThrow(/Native CLI binary for win32-x64 not found/);
  });

  it('accepts newer Claude SDK layout that only ships platform binaries', async () => {
    const { loadConfig } = await import('./config.js');
    const binaryExt = process.platform === 'win32' ? '.exe' : '';
    const nativePackageName = process.platform === 'linux'
      ? `@anthropic-ai/claude-agent-sdk-linux-${process.arch}`
      : `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
    const nativeBinarySpecifier = `${nativePackageName}/claude${binaryExt}`;
    const nativeBinaryPath = `/mock/node_modules/${nativePackageName}/claude${binaryExt}`;

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

    requireResolveMock.mockImplementation((specifier: string) => {
      if (specifier === '@anthropic-ai/claude-agent-sdk') {
        return '/mock/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs';
      }
      if (specifier === nativeBinarySpecifier) {
        return nativeBinaryPath;
      }
      throw Object.assign(new Error(`Cannot find module '${specifier}'`), {
        code: 'MODULE_NOT_FOUND',
      });
    });

    existsSyncMock.mockImplementation((path: unknown) => {
      if (typeof path !== 'string') return false;
      if (path.endsWith('/config.json')) return true;
      if (path.endsWith('/.claude/settings.json')) return false;
      if (path.endsWith('/@anthropic-ai/claude-agent-sdk/cli.js')) return false;
      if (path === nativeBinaryPath) return true;
      return false;
    });

    loadConfig();

    expect(execFileSyncMock).toHaveBeenCalledWith(
      nativeBinaryPath,
      ['--version'],
      expect.objectContaining({
        stdio: 'pipe',
      }),
    );
  });

  it('warns when CodeBuddy has no obvious auth indicators', async () => {
    const { loadConfig } = await import('./config.js');
    mockConfigJson({
      platforms: {
        qq: {
          enabled: true,
          appId: 'app-id',
          secret: 'secret',
          aiCommand: 'codebuddy',
        },
      },
      tools: {
        codebuddy: {
          cliPath: 'codebuddy',
        },
      },
    });

    existsSyncMock.mockImplementation((path: unknown) => {
      if (typeof path !== 'string') return false;
      if (path.endsWith('/config.json')) return true;
      if (path.endsWith('/.codebuddy')) return false;
      if (path.endsWith('/.codebuddycn')) return false;
      return false;
    });

    loadConfig();

    expect(loggerWarnMock).toHaveBeenCalledWith(expect.stringContaining('CodeBuddy 模式：未检测到明确的登录态或 API Key'));
  });

  it('leaves skipPermissions undefined when not explicitly configured', async () => {
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
      if (path.includes('@anthropic-ai/claude-agent-sdk') && path.endsWith('/cli.js')) return true;
      return false;
    });

    const config = loadConfig();

    expect(config.skipPermissions).toBeUndefined();
  });

  it('loads explicit Claude skipPermissions from config and env', async () => {
    const { loadConfig } = await import('./config.js');
    mockConfigJson({
      tools: {
        claude: {
          skipPermissions: true,
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
      if (path.includes('@anthropic-ai/claude-agent-sdk') && path.endsWith('/cli.js')) return true;
      return false;
    });

    expect(loadConfig().skipPermissions).toBe(true);

    process.env.OPEN_IM_SKIP_PERMISSIONS = 'false';
    expect(loadConfig().skipPermissions).toBe(false);

    process.env.OPEN_IM_SKIP_PERMISSIONS = 'true';
    expect(loadConfig().skipPermissions).toBe(true);
  });
});
