import {describe, expect, it} from "vite-plus/test";
import {renderToStaticMarkup} from "react-dom/server";
import {AssistantTurnMeta, UserTurnContext} from "../src/components/turn-metadata";
import type {MessageSessionLine} from "../src/lib/transcript";

function assistantLine(extra: Partial<MessageSessionLine>, message: Record<string, unknown> = {}): MessageSessionLine {
	return {
		type: "assistant",
		lineIndex: 0,
		message: {role: "assistant", content: [{type: "text", text: "hi"}], ...message},
		...extra,
	} as MessageSessionLine;
}

describe("AssistantTurnMeta", () => {
	it("renders nothing for a turn without effort, advisor, transformations, or safeguards", () => {
		expect(renderToStaticMarkup(<AssistantTurnMeta line={assistantLine({})} />)).toBe("");
	});

	it("renders nothing for evaluated safeguards that flagged nothing", () => {
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
		expect(renderToStaticMarkup(<AssistantTurnMeta line={line} />)).toBe("");
	});

	it("shows per-turn effort and the advisor model", () => {
		const html = renderToStaticMarkup(
			<AssistantTurnMeta line={assistantLine({perTurnEffort: "high", advisorModel: "claude-opus-5-5"})} />,
		);
		expect(html).toContain('title="Per-turn effort">high effort</span>');
		expect(html).toContain('title="Advisor model claude-opus-5-5">advisor Opus 5.5</span>');
	});

	it("flags dropped thinking blocks with their reasons", () => {
		const html = renderToStaticMarkup(
			<AssistantTurnMeta
				line={assistantLine(
					{},
					{
						input_transformations: [
							{
								type: "thinking_dropped",
								path: "messages.2.content.0",
								reason: "model_binding_mismatch",
							},
							{
								type: "thinking_dropped",
								path: "messages.5.content.0",
								reason: "model_binding_mismatch",
							},
							{
								type: "thinking_dropped",
								path: "messages.8.content.0",
								reason: "prefix_binding_mismatch",
							},
						],
					},
				)}
			/>,
		);
		expect(html).toContain(
			'title="Thinking dropped from the request: model_binding_mismatch ×2, prefix_binding_mismatch ×1">3 thinking blocks dropped</span>',
		);
	});

	it("flags safeguard outcomes other than not_flagged and unavailable safeguards", () => {
		const html = renderToStaticMarkup(
			<AssistantTurnMeta
				line={assistantLine(
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
				)}
			/>,
		);
		expect(html).toContain(
			'title="dangerous_tool_use: toolu_1 flagged\nprompt_injection: unavailable">safeguard flagged 1 tool call · 1 unavailable</span>',
		);
	});
});

describe("UserTurnContext", () => {
	it("renders nothing without classifier context", () => {
		const line: MessageSessionLine = {type: "user", lineIndex: 0};
		expect(renderToStaticMarkup(<UserTurnContext line={line} />)).toBe("");
	});

	it("shows the branch with the live cwd and platform in its title", () => {
		const line: MessageSessionLine = {
			type: "user",
			lineIndex: 0,
			classifierContext: {liveCwd: "/repo/sub", branch: "feature", platform: "macos"},
		};
		const html = renderToStaticMarkup(<UserTurnContext line={line} />);
		expect(html).toContain('title="Classifier context: /repo/sub · macos"');
		expect(html).toContain(">feature</span>");
	});

	it("falls back to the live cwd when there is no branch", () => {
		const line: MessageSessionLine = {
			type: "user",
			lineIndex: 0,
			classifierContext: {liveCwd: "/tmp"},
		};
		const html = renderToStaticMarkup(<UserTurnContext line={line} />);
		expect(html).toContain('title="Classifier context: /tmp"');
		expect(html).toContain(">/tmp</span>");
	});
});
