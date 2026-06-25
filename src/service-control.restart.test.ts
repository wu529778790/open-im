import { beforeEach, describe, expect, it, vi } from "vitest";

// 复用现有 service-control.test.ts 的 mock 风格：mock node:fs，避免真实文件 IO。
// 重启标志函数的逻辑只依赖 existsSync/writeFileSync/unlinkSync + APP_HOME 常量路径，
// 故只验证调用契约即可。
const { existsSyncMock, writeFileSyncMock, unlinkSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  unlinkSyncMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  readFileSync: vi.fn(),
  unlinkSync: unlinkSyncMock,
  writeFileSync: writeFileSyncMock,
  mkdirSync: vi.fn(),
}));

import { markRestartRequest, hasRestartRequested, clearRestartRequest } from "./service-control.js";

describe("restart request flag file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hasRestartRequested returns true when the flag file exists", () => {
    existsSyncMock.mockReturnValue(true);
    expect(hasRestartRequested()).toBe(true);
  });

  it("hasRestartRequested returns false when the flag file does not exist", () => {
    existsSyncMock.mockReturnValue(false);
    expect(hasRestartRequested()).toBe(false);
  });

  it("markRestartRequest writes JSON with reason + ISO timestamp", () => {
    // markRestartRequest 先 existsSync(dir) 防御 APP_HOME 不存在；mock 让其通过。
    existsSyncMock.mockReturnValue(true);
    markRestartRequest("/restart by user 123");

    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    const [path, content] = writeFileSyncMock.mock.calls[0] as [string, string];
    expect(path).toContain("open-im.restart-requested");
    const parsed = JSON.parse(content);
    expect(parsed.reason).toBe("/restart by user 123");
    expect(typeof parsed.at).toBe("string");
    expect(parsed.at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
  });

  it("clearRestartRequest unlinks the flag file", () => {
    existsSyncMock.mockReturnValue(true);
    clearRestartRequest();

    expect(unlinkSyncMock).toHaveBeenCalledTimes(1);
    const path = unlinkSyncMock.mock.calls[0][0] as string;
    expect(path).toContain("open-im.restart-requested");
  });

  it("clearRestartRequest is a no-op when no flag exists", () => {
    existsSyncMock.mockReturnValue(false);
    clearRestartRequest();
    expect(unlinkSyncMock).not.toHaveBeenCalled();
  });
});
