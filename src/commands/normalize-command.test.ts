import { describe, expect, it } from "vitest";
import { normalizeSlashCommandForDispatch } from "./handler.js";

describe("normalizeSlashCommandForDispatch", () => {
  it("strips @bot suffix from first segment", () => {
    expect(normalizeSlashCommandForDispatch("/new@my_open_im_bot")).toBe("/new");
    expect(normalizeSlashCommandForDispatch("  /help@BotName  ")).toBe("/help");
  });

  it("preserves arguments after command", () => {
    expect(normalizeSlashCommandForDispatch("/resume@bot 2")).toBe("/resume 2");
    expect(normalizeSlashCommandForDispatch("/cd@bot /tmp/foo")).toBe("/cd /tmp/foo");
  });

  it("leaves non-command or no-at unchanged", () => {
    expect(normalizeSlashCommandForDispatch("/new")).toBe("/new");
    expect(normalizeSlashCommandForDispatch("hello @user")).toBe("hello @user");
    expect(normalizeSlashCommandForDispatch("plain")).toBe("plain");
  });
});
