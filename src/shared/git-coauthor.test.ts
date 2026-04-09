import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { DEFAULT_OPEN_IM_COAUTHOR_ADDR } from "../constants.js";
import { resolveOpenImGitCoauthorLine } from "./git-coauthor.js";

const KEYS = ["OPEN_IM_GIT_COAUTHOR", "OPEN_IM_GIT_COAUTHOR_NAME"] as const;

describe("resolveOpenImGitCoauthorLine", () => {
  const backup: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of KEYS) backup[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (backup[k] === undefined) delete process.env[k];
      else process.env[k] = backup[k]!;
    }
  });

  function setEnv(pairs: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
    for (const [k, v] of Object.entries(pairs)) {
      const key = k as (typeof KEYS)[number];
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    }
  }

  it("returns undefined when disabled", () => {
    setEnv({
      OPEN_IM_GIT_COAUTHOR: "0",
    });
    expect(resolveOpenImGitCoauthorLine()).toBeUndefined();
  });

  it("uses packaged default email", () => {
    setEnv({});
    delete process.env.OPEN_IM_GIT_COAUTHOR;
    expect(resolveOpenImGitCoauthorLine()).toBe(
      `Co-authored-by: open-im <${DEFAULT_OPEN_IM_COAUTHOR_ADDR}>`,
    );
  });

  it("builds trailer with custom name and default email", () => {
    setEnv({
      OPEN_IM_GIT_COAUTHOR_NAME: "OpenIM Bot",
    });
    expect(resolveOpenImGitCoauthorLine()).toBe(
      `Co-authored-by: OpenIM Bot <${DEFAULT_OPEN_IM_COAUTHOR_ADDR}>`,
    );
  });

  it("strips angle brackets from name", () => {
    setEnv({
      OPEN_IM_GIT_COAUTHOR_NAME: "bad<>name",
    });
    expect(resolveOpenImGitCoauthorLine()).toBe(
      `Co-authored-by: badname <${DEFAULT_OPEN_IM_COAUTHOR_ADDR}>`,
    );
  });
});
