import { describe, expect, it } from "vite-plus/test";
import { createSessionCommands } from "../src/components/session-page";

describe("createSessionCommands", () => {
  it("starts resume and fork commands in the session project directory", () => {
    expect(createSessionCommands("session-100", "/tmp/proj")).toStrictEqual({
      resume: "cd '/tmp/proj' && claude -r session-100",
      fork: "cd '/tmp/proj' && claude -r session-100 --fork-session",
    });
  });

  it("uses bare commands when the project directory is unavailable", () => {
    expect(createSessionCommands("session-100", null)).toStrictEqual({
      resume: "claude -r session-100",
      fork: "claude -r session-100 --fork-session",
    });
  });
});
