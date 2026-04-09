import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { APP_HOME } from "./constants.js";
import { createLogger } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = createLogger("GitHook");

/** 避免每次启动在满足「已占用 hooksPath」时重复打 WARN */
let warnedForeignHooksPath = false;

function packageRoot(): string {
  return join(__dirname, "..");
}

function bundledPrepareCommitMsg(): string {
  return join(packageRoot(), "scripts", "git-hooks", "prepare-commit-msg");
}

function targetHooksDir(): string {
  return join(APP_HOME, "git-hooks");
}

function targetPrepareCommitMsg(): string {
  return join(targetHooksDir(), "prepare-commit-msg");
}

function gitTry(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { encoding: "utf-8" }).trim();
  } catch {
    return undefined;
  }
}

/** 将包内钩子复制到 ~/.open-im/git-hooks（失败则返回 false） */
function materializeOpenImHookScript(): boolean {
  const src = bundledPrepareCommitMsg();
  if (!existsSync(src)) {
    log.debug(`Bundled prepare-commit-msg not found at ${src}, skip`);
    return false;
  }
  try {
    mkdirSync(targetHooksDir(), { recursive: true });
    copyFileSync(src, targetPrepareCommitMsg());
  } catch (err) {
    log.warn(`Could not copy prepare-commit-msg: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  if (process.platform !== "win32") {
    try {
      chmodSync(targetPrepareCommitMsg(), 0o755);
    } catch {
      /* ignore */
    }
  }
  return true;
}

/**
 * 桥接启动时调用：在未占用 global core.hooksPath 时自动指向 ~/.open-im/git-hooks。
 * 若用户已设置其它 hooksPath，仅打日志，不覆盖。
 */
export function ensureOpenImGlobalPrepareCommitHook(): void {
  if (!materializeOpenImHookScript()) return;

  const hooksPath = targetHooksDir();
  const existing = gitTry(["config", "--global", "--get", "core.hooksPath"]);

  if (!existing) {
    try {
      execFileSync("git", ["config", "--global", "core.hooksPath", hooksPath]);
      log.info(`Auto-set git config --global core.hooksPath → ${hooksPath}`);
    } catch (err) {
      log.warn(
        `Could not set global core.hooksPath (is git installed?): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  const a = pathResolve(existing.replace(/^~(?=$|[/\\])/, homedir()));
  const b = pathResolve(hooksPath);
  if (a === b) return;

  if (!warnedForeignHooksPath) {
    warnedForeignHooksPath = true;
    log.warn(
      `Global core.hooksPath is "${existing}" (not open-im's dir); skipping auto wire. ` +
        `Merge scripts/git-hooks/prepare-commit-msg into that hooks directory, ` +
        `or set OPEN_IM_GIT_COAUTHOR_NO_AUTO_HOOK=1 to silence this warning.`,
    );
  }
}
