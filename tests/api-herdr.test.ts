import {describe, expect, it, vi} from "vite-plus/test";
import {
	HerdrPaneIndexResponse,
	fetchHerdrElicitationDialog,
	herdrPanesQueryOptions,
	HerdrRequestError,
	isNoTerminalHost,
	isPermissionNotPending,
	launchHerdrSession,
	sendHerdrElicitationDecision,
	sendHerdrPermissionAllowAuto,
	sendHerdrPermissionDecision,
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

		await sendHerdrPrompt("session-test-100", "Ask Alice to inspect the test", {fetcher});

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

	it("flags a mid-turn prompt in the request body", async () => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(Response.json({ok: true}));

		await sendHerdrPrompt("session-test-100", "Alice's answer instead", {midTurn: true, fetcher});

		expect(fetcher.mock.calls).toStrictEqual([
			[
				"/api/herdr/prompt",
				{
					method: "POST",
					credentials: "same-origin",
					headers: {"Content-Type": "application/json"},
					body: JSON.stringify({
						sessionId: "session-test-100",
						prompt: "Alice's answer instead",
						midTurn: true,
					}),
				},
			],
		]);
	});

	it("surfaces the prompt endpoint's error without treating it as success", async () => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(Response.json({error: "Fabricated agent is not ready"}, {status: 409}));

		await expect(sendHerdrPrompt("session-test-100", "Ask Alice to inspect the test", {fetcher})).rejects.toThrow(
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

describe("sendHerdrElicitationDecision", () => {
	it("posts the card's decision to the elicitation endpoint", async () => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(Response.json({ok: true}));

		await sendHerdrElicitationDecision("session-test-100", "deny", fetcher);

		expect(fetcher.mock.calls).toStrictEqual([
			[
				"/api/herdr/elicitation",
				{
					method: "POST",
					credentials: "same-origin",
					headers: {"Content-Type": "application/json"},
					body: JSON.stringify({sessionId: "session-test-100", decision: "deny"}),
				},
			],
		]);
	});

	it("names a url card's answer with kind url", async () => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(Response.json({ok: true}));

		await sendHerdrElicitationDecision("session-test-100", "allow", fetcher, "url");

		expect(fetcher.mock.calls).toStrictEqual([
			[
				"/api/herdr/elicitation",
				{
					method: "POST",
					credentials: "same-origin",
					headers: {"Content-Type": "application/json"},
					body: JSON.stringify({sessionId: "session-test-100", decision: "allow", kind: "url"}),
				},
			],
		]);
	});

	it("throws the endpoint's error on a 409", async () => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(
			Response.json({error: "The terminal is not showing this elicitation"}, {status: 409}),
		);

		await expect(sendHerdrElicitationDecision("session-test-100", "allow", fetcher)).rejects.toThrow(
			"The terminal is not showing this elicitation",
		);
	});
});

describe("fetchHerdrElicitationDialog", () => {
	const dialog = {
		kind: "url",
		server: "spike-elicit",
		message: "Open the spike page (url-decline)",
		focus: {stop: "decline"},
		expanded: false,
		fieldCount: 0,
	};

	it("reads the session's elicitation dialog off its pane", async () => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(Response.json({dialog}));

		const result = await fetchHerdrElicitationDialog("session-test-100", fetcher);

		expect({result, calls: fetcher.mock.calls}).toStrictEqual({
			result: dialog,
			calls: [["/api/herdr/elicitation?sessionId=session-test-100", {credentials: "same-origin"}]],
		});
	});

	it("throws the endpoint's error on a 409", async () => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(
			Response.json({error: "The terminal is not showing this elicitation"}, {status: 409}),
		);

		await expect(fetchHerdrElicitationDialog("session-test-100", fetcher)).rejects.toThrow(
			"The terminal is not showing this elicitation",
		);
	});
});

describe("sendHerdrPermissionAllowAuto", () => {
	it.each([
		{presses: 3, body: {sessionId: "session-test-100", decision: "allowAuto", presses: 3}},
		{presses: null, body: {sessionId: "session-test-100", decision: "allowAuto"}},
	])("posts allowAuto with presses $presses and returns how the mode was reached", async ({presses, body}) => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(Response.json({ok: true, via: "shiftTab"}));

		const via = await sendHerdrPermissionAllowAuto("session-test-100", presses, fetcher);

		expect({
			via,
			calls: fetcher.mock.calls.map(([url, init]) => [url, init?.method, JSON.parse(String(init?.body))]),
		}).toStrictEqual({
			via: "shiftTab",
			calls: [["/api/herdr/permission", "POST", body]],
		});
	});

	it("rejects with a not-pending error the card can recognise", async () => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(
			Response.json({error: "No permission request is pending", code: "not_pending"}, {status: 409}),
		);

		const error: unknown = await sendHerdrPermissionAllowAuto("session-test-100", 3, fetcher).catch(
			(caught: unknown) => caught,
		);

		expect(isPermissionNotPending(error)).toStrictEqual(true);
	});
});

describe("sendHerdrPermissionDecision", () => {
	it("rejects with a not-pending error the card can recognise when the server holds no prompt", async () => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(
			Response.json({error: "No permission request is pending", code: "not_pending"}, {status: 409}),
		);

		const error: unknown = await sendHerdrPermissionDecision("session-test-100", "allow", fetcher).catch(
			(caught: unknown) => caught,
		);

		expect({
			message: error instanceof Error ? error.message : null,
			notPending: isPermissionNotPending(error),
		}).toStrictEqual({message: "No permission request is pending", notPending: true});
	});

	it("keeps other refusals as ordinary errors", async () => {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(
			Response.json({error: "This permission request has no persistent allow option"}, {status: 409}),
		);

		const error: unknown = await sendHerdrPermissionDecision("session-test-100", "always", fetcher).catch(
			(caught: unknown) => caught,
		);

		expect({
			message: error instanceof Error ? error.message : null,
			notPending: isPermissionNotPending(error),
		}).toStrictEqual({message: "This permission request has no persistent allow option", notPending: false});
	});
});

describe("launchHerdrSession", () => {
	async function launchError(status: number, body: object): Promise<unknown> {
		const fetcher = vi.fn<typeof fetch>();
		fetcher.mockResolvedValue(Response.json(body, {status}));
		return launchHerdrSession({cwd: "/tmp/test/project", prompt: "hi"}, fetcher).catch((caught: unknown) => caught);
	}

	function describeError(error: unknown) {
		return error instanceof HerdrRequestError
			? {
					message: error.message,
					status: error.status,
					code: error.code,
					sessionId: error.sessionId,
					noTerminalHost: isNoTerminalHost(error),
				}
			: null;
	}

	it("rejects with herdr's code so an unreachable herdr reads as no terminal host", async () => {
		expect(describeError(await launchError(502, {error: "x", code: "connect-failed"}))).toStrictEqual({
			message: "x",
			status: 502,
			code: "connect-failed",
			sessionId: undefined,
			noTerminalHost: true,
		});
	});

	it("treats a herdr launch error as a real failure, not a missing terminal", async () => {
		expect(describeError(await launchError(502, {error: "x", code: "timeout"}))).toStrictEqual({
			message: "x",
			status: 502,
			code: "timeout",
			sessionId: undefined,
			noTerminalHost: false,
		});
	});

	it("treats disabled herdr writes as no terminal host", async () => {
		expect(describeError(await launchError(403, {error: "herdr writes are disabled"}))).toStrictEqual({
			message: "herdr writes are disabled",
			status: 403,
			code: undefined,
			sessionId: undefined,
			noTerminalHost: true,
		});
	});

	it("carries the started session's id when only the prompt failed", async () => {
		expect(
			describeError(await launchError(502, {error: "x", code: "agent_prompt_failed", sessionId: "s1"})),
		).toStrictEqual({
			message: "x",
			status: 502,
			code: "agent_prompt_failed",
			sessionId: "s1",
			noTerminalHost: false,
		});
	});

	it("treats a network failure as no terminal host", () => {
		expect(isNoTerminalHost(new TypeError("Failed to fetch"))).toBe(true);
	});
});
