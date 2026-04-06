import { existsSync } from "node:fs";

/**
 * 用于 spawn 子进程的 Node 可执行文件路径。
 * Windows 上偶发 process.execPath 指向已删除/移动的安装（如 D: 盘路径失效），导致 ENOENT；
 * 此时回退到 PATH 中的 `node`，或通过 OPEN_IM_NODE / NODE_EXE 显式指定。
 */
export function resolveNodeExecutable(): string {
  const fromEnv = (process.env.OPEN_IM_NODE ?? process.env.NODE_EXE)?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }
  if (process.execPath && existsSync(process.execPath)) {
    return process.execPath;
  }
  return "node";
}
