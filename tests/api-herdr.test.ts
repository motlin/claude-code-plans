import {describe, expect, it, vi} from "vite-plus/test";
import {
	HerdrPaneIndexResponse,
	herdrPanesQueryOptions,
	sendHerdrPrompt,
	sendHerdrQuestionAnswer,
} from "../src/lib/api/herdr";

const linkedPane = {
	host: "herdr",
	paneId: "w100:p100",
	terminalId: "terminal-test-100",
	workspaceId: "w100",
	tabId: "w100:t100",
	focused: true,
	cwd: "/tmp/test/project",
	foregroundCwd: "/tmp/test/project/src",
	agentStatus: "working",
	agent: "claude",
	terminalTitle: "Alice test terminal",
	agentSessionId: "session-test-100",
	revision: 100,
	sessionId: "session-test-100",
	via: "both",
	viewedState: {
		currentMessageIndex: 100,
		lastViewedMessageIndex: 50,
		reviewTargetMessageIndex: 100,
		newMessageCount: 50,
		viewedInCcp: false,
		viewedInHerdr: true,
		viewedAnywhere: true,
	},
} as const;

describe("herdr panes API contract", () => {
	it("parses the complete pane link and exposes a stable query key", () => {
		expect({
			response: HerdrPaneIndexResponse.parse({panes: [linkedPane], writesEnabled: true}),
			queryKey: herdrPanesQueryOptions.queryKey,
		}).toStrictEqual({
			response: {panes: [linkedPane], writesEnabled: true},
			queryKey: ["herdr", "panes"],
		});
	});

	it("rejects fields outside the ccp-owned response contract", () => {
		expect(
			HerdrPaneIndexResponse.safeParse({
				panes: [{...linkedPane, unexpectedTestField: true}],
				writesEnabled: false,
			}).success,
		).toBe(false);
	});

	it("posts a prompt to the live-session endpoint", async () => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(Response.json({ok: true}));

		await sendHerdrPrompt("session-test-100", "Ask Alice to inspect the test", fetcher);

		expect(fetcher.mock.calls).toStrictEqual([
			[
				"/api/herdr/prompt",
				{
					method: "POST",
					credentials: "same-origin",
					headers: {"Content-Type": "application/json"},
					body: JSON.stringify({
						sessionId: "session-test-100",
						prompt: "Ask Alice to inspect the test",
					}),
				},
			],
		]);
	});

	it("surfaces the prompt endpoint's error without treating it as success", async () => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(Response.json({error: "Fabricated agent is not ready"}, {status: 409}));

		await expect(sendHerdrPrompt("session-test-100", "Ask Alice to inspect the test", fetcher)).rejects.toThrow(
			"Fabricated agent is not ready",
		);
	});

	it("posts a question's answers to the live-pane question endpoint", async () => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(Response.json({ok: true}));

		await sendHerdrQuestionAnswer(
			"session-test-100",
			"toolu_test_100",
			[{selected: [1]}, null, {selected: [0], other: "Pepper"}],
			fetcher,
		);

		expect(fetcher.mock.calls).toStrictEqual([
			[
				"/api/herdr/question",
				{
					method: "POST",
					credentials: "same-origin",
					headers: {"Content-Type": "application/json"},
					body: JSON.stringify({
						sessionId: "session-test-100",
						toolUseId: "toolu_test_100",
						answers: [{selected: [1]}, null, {selected: [0], other: "Pepper"}],
					}),
				},
			],
		]);
	});

	it("surfaces the question endpoint's error", async () => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(Response.json({error: "That question is no longer pending"}, {status: 409}));

		await expect(
			sendHerdrQuestionAnswer("session-test-100", "toolu_test_100", [{selected: [0]}], fetcher),
		).rejects.toThrow("That question is no longer pending");
	});
});
