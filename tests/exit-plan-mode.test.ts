import {describe, expect, it} from "vite-plus/test";
import {
	describeExitPlanModeResult,
	EXIT_PLAN_MODE_STATE_LABEL,
	exitPlanModeState,
	parseAllowedPrompts,
	planBlockSegments,
	planHeadingMeta,
	planSubtitleLine,
	planText,
} from "../src/lib/exit-plan-mode";

describe("parseAllowedPrompts", () => {
	it("keeps tool/prompt pairs in order", () => {
		expect(
			parseAllowedPrompts([
				{tool: "Bash", prompt: "stage and commit git changes"},
				{tool: "Bash", prompt: "run just precommit"},
			]),
		).toStrictEqual([
			{tool: "Bash", prompt: "stage and commit git changes"},
			{tool: "Bash", prompt: "run just precommit"},
		]);
	});

	it("returns an empty list for a missing or malformed value", () => {
		expect({
			missing: parseAllowedPrompts(undefined),
			notAnArray: parseAllowedPrompts({tool: "Bash", prompt: "x"}),
			wrongShape: parseAllowedPrompts([{tool: "Bash"}]),
		}).toStrictEqual({missing: [], notAnArray: [], wrongShape: []});
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
		).toStrictEqual({tone: "approved", text: "Plan approved"});
	});

	it("collapses the exit-approval wording to the same status", () => {
		expect(
			describeExitPlanModeResult("User has approved exiting plan mode. You can now proceed.", undefined),
		).toStrictEqual({tone: "approved", text: "Plan approved"});
	});

	it("reports a bare rejection without the model-directed boilerplate", () => {
		expect(
			describeExitPlanModeResult(
				"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
				true,
			),
		).toStrictEqual({tone: "rejected", text: "Plan rejected"});
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

describe("exitPlanModeState", () => {
	const REJECTED =
		"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\nnot yet";

	it("maps each result to upstream's plan state and label", () => {
		const states = {
			awaiting: exitPlanModeState(undefined, undefined),
			approved: exitPlanModeState("User has approved your plan. You can now start coding.", undefined),
			savedWithoutError: exitPlanModeState("Plan saved.", undefined),
			rejected: exitPlanModeState(REJECTED, true),
			rejectedWithoutErrorFlag: exitPlanModeState(REJECTED, undefined),
			error: exitPlanModeState("You are not in plan mode.", true),
		};
		expect({
			states,
			labels: Object.fromEntries(
				Object.entries(states).map(([key, state]) => [key, EXIT_PLAN_MODE_STATE_LABEL[state]]),
			),
		}).toStrictEqual({
			states: {
				awaiting: "ready",
				approved: "approved",
				savedWithoutError: "approved",
				rejected: "rejected",
				rejectedWithoutErrorFlag: "rejected",
				error: "not-approved",
			},
			labels: {
				awaiting: "Plan ready",
				approved: "Plan approved",
				savedWithoutError: "Plan approved",
				rejected: "Plan rejected",
				rejectedWithoutErrorFlag: "Plan rejected",
				error: "Plan not approved",
			},
		});
	});
});

describe("planBlockSegments", () => {
	it("splits out each inline code run, per line, as upstream's plan block does", () => {
		expect(planBlockSegments("Run `just test` then `pnpm i`\nnot `across\nlines` here")).toStrictEqual([
			{code: false, text: "Run "},
			{code: true, text: "`just test`"},
			{code: false, text: " then "},
			{code: true, text: "`pnpm i`"},
			{code: false, text: "\nnot `across\nlines` here"},
		]);
	});

	it("strips Bidi controls and tag characters before splitting", () => {
		expect(planBlockSegments("a‮b⁦`c‏`\u{E0041}d")).toStrictEqual([
			{code: false, text: "ab"},
			{code: true, text: "`c`"},
			{code: false, text: "d"},
		]);
	});

	it("returns plain text as one segment", () => {
		expect(planBlockSegments("# Plan\n\n- step")).toStrictEqual([{code: false, text: "# Plan\n\n- step"}]);
	});
});

describe("planSubtitleLine", () => {
	it("is the plan's first non-empty line, trimmed, with a leading heading mark and Bidi controls stripped", () => {
		expect({
			heading: planSubtitleLine("\n# Plan: X\n\nbody"),
			plain: planSubtitleLine("  \n  Water the plant  \nthen rest"),
			deep: planSubtitleLine("###### Deep"),
			bidi: planSubtitleLine("# ‮Plan‬"),
			empty: planSubtitleLine(" \n "),
		}).toStrictEqual({heading: "Plan: X", plain: "Water the plant", deep: "Deep", bidi: "Plan", empty: ""});
	});
});

describe("planHeadingMeta", () => {
	it("is the first Markdown heading before any code fence, with links, emphasis and code marks dropped", () => {
		expect({
			heading: planHeadingMeta("# Plan: Make a Cup of Tea\n\n1. Boil water"),
			later: planHeadingMeta("Intro\n\n## Water a *pretend* plant ##\n"),
			marks: planHeadingMeta("# Run `just test` for [the app](https://example.com) _now_"),
			snake: planHeadingMeta("# Edit snake_case_name"),
			fenced: planHeadingMeta("Intro\n```\n# not a heading\n```\n# After"),
			tilde: planHeadingMeta("~~~\n# no\n~~~"),
			none: planHeadingMeta("Just text"),
			missing: planHeadingMeta(undefined),
		}).toStrictEqual({
			heading: "Plan: Make a Cup of Tea",
			later: "Water a pretend plant",
			marks: "Run just test for the app now",
			snake: "Edit snake_case_name",
			fenced: undefined,
			tilde: undefined,
			none: undefined,
			missing: undefined,
		});
	});
});

describe("planText", () => {
	it("is the plan string when it has any non-space text, else undefined (upstream's planless ExitPlanMode)", () => {
		expect([planText({plan: "# P"}), planText({plan: "  \n"}), planText({}), planText({plan: 3})]).toStrictEqual([
			"# P",
			undefined,
			undefined,
			undefined,
		]);
	});
});
