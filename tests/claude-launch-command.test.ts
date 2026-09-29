import { describe, expect, it } from "vite-plus/test";
import { buildClaudeCopyCommand, validateClaudeLaunchArgs } from "../src/lib/claude-launch-command";

describe("buildClaudeCopyCommand", () => {
  it.each([
    {
      name: "bare launch",
      input: { cwd: "/Users/alice/project" },
      expected: "cd '/Users/alice/project' && claude",
    },
    {
      name: "directory with a single quote and spaces",
      input: { cwd: "/Users/alice/bob's project" },
      expected: "cd '/Users/alice/bob'\\''s project' && claude",
    },
    {
      name: "prompt with quotes, command substitution and newlines",
      input: {
        cwd: "/Users/alice/project",
        prompt: `it's "quoted" $(rm -rf ~) \`id\`\nsecond line`,
      },
      expected: `cd '/Users/alice/project' && claude 'it'\\''s "quoted" $(rm -rf ~) \`id\`\nsecond line'`,
    },
    {
      name: "fork with model, effort and permission mode",
      input: {
        cwd: "/Users/alice/project",
        args: [
          "--resume",
          "11111111-2222-3333-4444-555555555555",
          "--fork-session",
          "--model",
          "opus[1m]",
          "--effort",
          "high",
          "--permission-mode",
          "plan",
        ],
        prompt: "continue",
      },
      expected:
        "cd '/Users/alice/project' && claude --resume 11111111-2222-3333-4444-555555555555 --fork-session --model 'opus[1m]' --effort high --permission-mode plan 'continue'",
    },
  ])("builds the $name command", ({ input, expected }) => {
    expect(buildClaudeCopyCommand(input)).toBe(expected);
  });
});

describe("validateClaudeLaunchArgs", () => {
  it.each([
    { args: [], expected: null },
    { args: ["--resume", "session-test-100", "--fork-session"], expected: null },
    { args: ["--model", "claude-opus-5-5", "--effort", "max"], expected: null },
    { args: ["--permission-mode", "acceptEdits"], expected: null },
    { args: ["--dangerously-skip-permissions"], expected: "unsupported claude argument" },
    { args: ["--model"], expected: "--model requires a value" },
    { args: ["--model", "--effort"], expected: "invalid value for --model" },
    { args: ["--effort", "extreme"], expected: "invalid value for --effort" },
    { args: ["--permission-mode", "yolo"], expected: "invalid value for --permission-mode" },
    { args: ["--resume", "$(id)"], expected: "invalid value for --resume" },
    { args: ["--fork-session"], expected: "--fork-session requires --resume" },
    { args: ["--effort", "low", "--effort", "high"], expected: "duplicate claude argument" },
  ])("returns $expected for $args", ({ args, expected }) => {
    expect(validateClaudeLaunchArgs(args)).toBe(expected);
  });
});
