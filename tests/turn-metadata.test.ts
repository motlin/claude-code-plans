import {describe, expect, it} from "vite-plus/test";
import {assistantTurnDetails, userTurnDetails} from "../src/lib/turn-metadata";
import type {MessageSessionLine} from "../src/lib/transcript";

function assistantLine(extra: Partial<MessageSessionLine>, message: Record<string, unknown> = {}): MessageSessionLine {
	return {
		type: "assistant",
		lineIndex: 0,
		message: {role: "assistant", content: [{type: "text", text: "hi"}], ...message},
		...extra,
	} as MessageSessionLine;
}

describe("assistantTurnDetails", () => {
	it("has nothing to say about a turn without usage, effort, advisor, transformations, or safeguards", () => {
		expect(assistantTurnDetails(assistantLine({}))).toStrictEqual([]);
	});

	it("says nothing about evaluated safeguards that flagged nothing", () => {
		const line = assistantLine(
			{},
			{
				input_transformations: [],
				safeguard_results: [
					{
						type: "dangerous_tool_use",
						status: {
							type: "available",
							tool_uses: {toolu_1: {type: "evaluated", outcome: "not_flagged"}},
						},
					},
				],
			},
		);
		expect(assistantTurnDetails(line)).toStrictEqual([]);
	});

	it("lists token usage, truncation, per-turn effort and the advisor model", () => {
		expect(
			assistantTurnDetails(
				assistantLine({
					usage: {
						input_tokens: 800,
						cache_read_input_tokens: 595_000,
						cache_creation_input_tokens: 0,
						output_tokens: 595,
					},
					stopReason: "max_tokens",
					perTurnEffort: "high",
					advisorModel: "claude-opus-5-5",
				}),
			),
		).toStrictEqual(["595.8k in / 595 out", "Truncated at max tokens", "high effort", "advisor Opus 5.5"]);
	});

	it("counts dropped thinking blocks with their reasons", () => {
		expect(
			assistantTurnDetails(
				assistantLine(
					{},
					{
						input_transformations: [
							{type: "thinking_dropped", path: "messages.2.content.0", reason: "model_binding_mismatch"},
							{type: "thinking_dropped", path: "messages.5.content.0", reason: "model_binding_mismatch"},
							{type: "thinking_dropped", path: "messages.8.content.0", reason: "prefix_binding_mismatch"},
						],
					},
				),
			),
		).toStrictEqual(["3 thinking blocks dropped (model_binding_mismatch ×2, prefix_binding_mismatch ×1)"]);
	});

	it("flags safeguard outcomes other than not_flagged and unavailable safeguards", () => {
		expect(
			assistantTurnDetails(
				assistantLine(
					{},
					{
						safeguard_results: [
							{
								type: "dangerous_tool_use",
								status: {
									type: "available",
									tool_uses: {
										toolu_1: {type: "evaluated", outcome: "flagged"},
										toolu_2: {type: "evaluated", outcome: "not_flagged"},
									},
								},
							},
							{type: "prompt_injection", status: {type: "unavailable"}},
						],
					},
				),
			),
		).toStrictEqual([
			"safeguard flagged 1 tool call · 1 unavailable (dangerous_tool_use: toolu_1 flagged; prompt_injection: unavailable)",
		]);
	});
});

describe("userTurnDetails", () => {
	it("has nothing to say about an ordinary typed prompt", () => {
		expect(userTurnDetails({type: "user", lineIndex: 0})).toStrictEqual([]);
	});

	it("names a scheduled origin, the prompt source and a queued-for-later turn", () => {
		expect(
			userTurnDetails({
				type: "user",
				lineIndex: 0,
				turnOrigin: "scheduled",
				scheduledTaskId: "ecc5631f",
				queuePriority: "later",
			}),
		).toStrictEqual(["Scheduled task ecc5631f · queued for later"]);
	});

	it("names a peer origin and a non-typed prompt source", () => {
		expect({
			peer: userTurnDetails({type: "user", lineIndex: 0, turnOrigin: "peer"}),
			suggestion: userTurnDetails({type: "user", lineIndex: 0, promptSource: "suggestion_accepted"}),
			system: userTurnDetails({type: "user", lineIndex: 0, promptSource: "system", queuePriority: "later"}),
		}).toStrictEqual({
			peer: ["From another session"],
			suggestion: ["Suggestion accepted prompt"],
			system: ["System prompt · queued for later"],
		});
	});

	it("gives the classifier's branch with the live cwd and platform", () => {
		expect(
			userTurnDetails({
				type: "user",
				lineIndex: 0,
				classifierContext: {liveCwd: "/repo/sub", branch: "feature", platform: "macos"},
			}),
		).toStrictEqual(["Branch feature (/repo/sub · macos)"]);
	});

	it("falls back to the live cwd when there is no branch", () => {
		expect(userTurnDetails({type: "user", lineIndex: 0, classifierContext: {liveCwd: "/tmp"}})).toStrictEqual([
			"Directory /tmp",
		]);
	});
});
