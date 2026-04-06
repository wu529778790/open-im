import { existsSync } from "node:fs";

/**
 * 用于 spawn 子进程的 Node 可执行文件路径。
 *
 * Windows：`fs.existsSync(process.execPath)` 为真时，`spawn(process.execPath)` 仍可能 ENOENT
 *（权限/重解析/全局 npm 与当前 shell 的 node 不一致等）。未设置 OPEN_IM_NODE 时优先用 PATH 上的 `node`，
 * 与交互式 `where node`、`node -v` 行为一致。
 *
 * 非 Windows：仍优先使用 `process.execPath`（与当前进程同源）。
 */
export function resolveNodeExecutable(): string {
  const fromEnv = (process.env.OPEN_IM_NODE ?? process.env.NODE_EXE)?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }
  if (process.platform === "win32") {
    return "node";
  }
  if (process.execPath && existsSync(process.execPath)) {
    return process.execPath;
  }
  return "node";
}
