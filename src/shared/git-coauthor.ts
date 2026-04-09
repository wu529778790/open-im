import { DEFAULT_OPEN_IM_COAUTHOR_ADDR } from "../constants.js";
import { createLogger } from "../logger.js";
import { ensureOpenImGlobalPrepareCommitHook } from "../git-hook.js";

const log = createLogger("GitCoauthor");

const DISABLE_VALUES = new Set(["0", "false", "no"]);

/**
 * GitHub 会识别 commit message 中的 Co-authored-by 并在提交页展示共同作者。
 *
 * **默认开启**：无需也不应手动设置 `OPEN_IM_GIT_COAUTHOR_LINE`，桥接启动时会自动写入该变量；
 * 仅当 `OPEN_IM_GIT_COAUTHOR=0|false|no` 时才会清空。地址来自 {@link DEFAULT_OPEN_IM_COAUTHOR_ADDR}。
 *
 * - OPEN_IM_GIT_COAUTHOR=0|false|no — 关闭共同作者（不写 OPEN_IM_GIT_COAUTHOR_LINE）
 * - OPEN_IM_GIT_COAUTHOR_NAME — 显示名，默认 open-im
 * - OPEN_IM_GIT_COAUTHOR_NO_AUTO_HOOK=1 — 不自动改 git global core.hooksPath（需自行装钩子）
 */
export function resolveOpenImGitCoauthorLine(): string | undefined {
  const flag = process.env.OPEN_IM_GIT_COAUTHOR?.trim().toLowerCase();
  if (flag && DISABLE_VALUES.has(flag)) return undefined;

  const addr = DEFAULT_OPEN_IM_COAUTHOR_ADDR;
  if (!addr.trim()) return undefined;

  const rawName = process.env.OPEN_IM_GIT_COAUTHOR_NAME?.trim() || "open-im";
  const name = rawName.replace(/[<>]/g, "").trim() || "open-im";
  return `Co-authored-by: ${name} <${addr}>`;
}

/**
 * 默认开启：设置 `process.env.OPEN_IM_GIT_COAUTHOR_LINE` 供子进程与 git 钩子使用；
 * AI 发起的 commit 会由 prepare-commit-msg 追加该行（除非已显式关闭共同作者）。
 */
export function applyOpenImGitCoauthorToProcessEnv(): void {
  const line = resolveOpenImGitCoauthorLine();
  if (line) {
    process.env.OPEN_IM_GIT_COAUTHOR_LINE = line;
    if (!isTruthyEnv(process.env.OPEN_IM_GIT_COAUTHOR_NO_AUTO_HOOK)) {
      ensureOpenImGlobalPrepareCommitHook();
    }
    log.info("Git co-author enabled; AI git commits will append OPEN_IM_GIT_COAUTHOR_LINE when the hook runs.");
  } else {
    delete process.env.OPEN_IM_GIT_COAUTHOR_LINE;
  }
}

function isTruthyEnv(v: string | undefined): boolean {
  const t = v?.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes";
}
