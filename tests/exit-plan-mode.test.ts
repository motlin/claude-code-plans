import { describe, expect, it } from "vite-plus/test";
import { describeExitPlanModeResult, parseAllowedPrompts } from "../src/lib/exit-plan-mode";

describe("parseAllowedPrompts", () => {
  it("keeps tool/prompt pairs in order", () => {
    expect(
      parseAllowedPrompts([
        { tool: "Bash", prompt: "stage and commit git changes" },
        { tool: "Bash", prompt: "run just precommit" },
      ]),
    ).toStrictEqual([
      { tool: "Bash", prompt: "stage and commit git changes" },
      { tool: "Bash", prompt: "run just precommit" },
    ]);
  });

  it("returns an empty list for a missing or malformed value", () => {
    expect({
      missing: parseAllowedPrompts(undefined),
      notAnArray: parseAllowedPrompts({ tool: "Bash", prompt: "x" }),
      wrongShape: parseAllowedPrompts([{ tool: "Bash" }]),
    }).toStrictEqual({ missing: [], notAnArray: [], wrongShape: [] });
  });
});

describe("describeExitPlanModeResult", () => {
  it("returns null when there is no result yet", () => {
    expect(describeExitPlanModeResult(undefined, undefined)).toStrictEqual(null);
  });

  it("collapses the plan-approval instructions to a one-line status", () => {
    expect(
      describeExitPlanModeResult(
        "User has approved your plan. You can now start coding. Start with updating your todo list if applicable\n\nYour plan has been saved to: /Users/craig/.claude/plans/just-dump-brew-soft-sky.md\nYou can refer back to it if needed during implementation.",
        undefined,
      ),
    ).toStrictEqual({ tone: "approved", text: "Plan approved" });
  });

  it("collapses the exit-approval wording to the same status", () => {
    expect(
      describeExitPlanModeResult(
        "User has approved exiting plan mode. You can now proceed.",
        undefined,
      ),
    ).toStrictEqual({ tone: "approved", text: "Plan approved" });
  });

  it("reports a bare rejection without the model-directed boilerplate", () => {
    expect(
      describeExitPlanModeResult(
        "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
        true,
      ),
    ).toStrictEqual({ tone: "rejected", text: "Plan rejected" });
  });

  it("keeps the user's own words when they rejected with feedback", () => {
    expect(
      describeExitPlanModeResult(
        "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\nalso plan on working in a new worktree",
        true,
      ),
    ).toStrictEqual({
      tone: "rejected",
      text: "Plan rejected",
      detail: "also plan on working in a new worktree",
    });
  });

  it("passes a genuine tool error through unchanged", () => {
    expect(
      describeExitPlanModeResult(
        "You are not in plan mode. To enter plan mode, call the EnterPlanMode tool first.",
        true,
      ),
    ).toStrictEqual({
      tone: "error",
      text: "You are not in plan mode. To enter plan mode, call the EnterPlanMode tool first.",
    });
  });

  it("passes an unrecognized non-error result through as info", () => {
    expect(describeExitPlanModeResult("Plan saved.", undefined)).toStrictEqual({
      tone: "info",
      text: "Plan saved.",
    });
  });
});
