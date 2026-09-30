import {describe, expect, it, vi} from "vite-plus/test";
import type {HerdrResult} from "../src/lib/herdr/client";
import {handleHerdrLaunch, type HerdrLaunchDependencies} from "../src/lib/herdr/launch";
import type {HerdrRequester} from "../src/lib/herdr/panes";
import {rejectCrossSite} from "../src/lib/same-origin-guard";

function request(body: unknown, headers?: HeadersInit): Request {
	const requestHeaders = new Headers(headers);
	requestHeaders.set("Content-Type", "application/json");
	return new Request("http://127.0.0.1:7526/api/herdr/launch", {
		method: "POST",
		headers: requestHeaders,
		body: JSON.stringify(body),
	});
}

async function describeResponse(response: Response): Promise<{body: unknown; status: number}> {
	return {body: await response.json(), status: response.status};
}

const rootPane = {
	pane_id: "w100:p100",
	terminal_id: "terminal-test-100",
	workspace_id: "w100",
	tab_id: "w100:t100",
	focused: false,
	cwd: "/Users/alice/project",
	agent_status: "unknown",
	revision: 0,
};

const tabCreated = {
	type: "tab_created",
	tab: {
		tab_id: "w100:t100",
		workspace_id: "w100",
		number: 1,
		label: "project",
		focused: false,
		pane_count: 1,
		agent_status: "unknown",
	},
	root_pane: rootPane,
};

function agentStarted(argv: string[]) {
	return {
		type: "agent_started",
		argv,
		agent: {
			terminal_id: "terminal-test-100",
			agent_status: "idle",
			workspace_id: "w100",
			tab_id: "w100:t100",
			pane_id: "w100:p100",
			focused: false,
			revision: 3,
			agent: "claude",
			name: "ccp-test100",
			agent_session: {
				agent: "claude",
				kind: "id",
				source: "herdr:claude",
				value: "session-test-200",
			},
		},
	};
}

interface RecordedRequest {
	request: object;
	timeoutMs: number | undefined;
}

function fakeHerdr(responses: Record<string, HerdrResult<unknown>>): {
	requester: HerdrRequester;
	requests: RecordedRequest[];
} {
	const requests: RecordedRequest[] = [];
	const requester: HerdrRequester = async (requestValue, timeoutMs) => {
		requests.push({request: requestValue, timeoutMs});
		const method = (requestValue as {method: string}).method;
		return responses[method] ?? {ok: false, code: "unexpected", message: method};
	};
	return {requester, requests};
}

function dependencies(overrides: Partial<HerdrLaunchDependencies> = {}): HerdrLaunchDependencies {
	return {
		rejectRequest: rejectCrossSite,
		writesEnabled: () => true,
		request: async () => ({ok: true, value: {type: "ok"}}),
		createLaunchId: () => "test100",
		wait: async () => {},
		...overrides,
	};
}

const trickyPrompt = `it's "quoted" $(rm -rf ~) \`id\`\nsecond line`;

describe("herdr launch write handler", () => {
	it("returns 403 before parsing when writes are disabled", async () => {
		const sendRequest = vi.fn<HerdrRequester>();

		const response = await handleHerdrLaunch(
			request({cwd: "/Users/alice/project"}),
			dependencies({writesEnabled: () => false, request: sendRequest}),
		);

		expect({
			response: await describeResponse(response),
			calls: sendRequest.mock.calls,
		}).toStrictEqual({
			response: {body: {error: "herdr writes are disabled"}, status: 403},
			calls: [],
		});
	});

	it("rejects cross-site requests before checking the feature flag", async () => {
		const calls: string[] = [];

		const response = await handleHerdrLaunch(
			request(
				{cwd: "/Users/alice/project"},
				{Origin: "https://attacker.example.com", "Sec-Fetch-Site": "cross-site"},
			),
			dependencies({
				rejectRequest: (candidate) => {
					calls.push("guard");
					return rejectCrossSite(candidate);
				},
				writesEnabled: () => {
					calls.push("feature");
					return true;
				},
			}),
		);

		expect({response: await describeResponse(response), calls}).toStrictEqual({
			response: {body: {error: "Forbidden"}, status: 403},
			calls: ["guard"],
		});
	});

	it.each([
		{name: "missing cwd", body: {}},
		{name: "relative cwd", body: {cwd: "project"}},
		{name: "empty prompt", body: {cwd: "/Users/alice/project", prompt: ""}},
		{name: "unknown field", body: {cwd: "/Users/alice/project", shell: "zsh"}},
		{
			name: "unsupported claude argument",
			body: {cwd: "/Users/alice/project", args: ["--dangerously-skip-permissions"]},
		},
		{
			name: "fork without resume",
			body: {cwd: "/Users/alice/project", args: ["--fork-session"]},
		},
	])("returns 400 without contacting herdr for $name", async ({body}) => {
		const sendRequest = vi.fn<HerdrRequester>();

		const response = await handleHerdrLaunch(request(body), dependencies({request: sendRequest}));

		expect({
			status: response.status,
			calls: sendRequest.mock.calls,
		}).toStrictEqual({status: 400, calls: []});
	});

	it("creates a tab, starts claude with an argv array, then submits the prompt verbatim", async () => {
		const args = [
			"--resume",
			"session-test-100",
			"--fork-session",
			"--model",
			"opus",
			"--effort",
			"high",
			"--permission-mode",
			"plan",
		];
		const herdr = fakeHerdr({
			"tab.create": {ok: true, value: tabCreated},
			"agent.start": {ok: true, value: agentStarted(["claude", ...args])},
			"agent.prompt": {ok: true, value: {type: "ok"}},
		});

		const response = await handleHerdrLaunch(
			request({cwd: "/Users/alice/project", prompt: trickyPrompt, args}),
			dependencies({request: herdr.requester}),
		);

		expect({response: await describeResponse(response), requests: herdr.requests}).toStrictEqual({
			response: {
				body: {
					ok: true,
					tabId: "w100:t100",
					paneId: "w100:p100",
					sessionId: "session-test-200",
				},
				status: 200,
			},
			requests: [
				{
					request: {
						id: "ccp:launch:test100:tab.create",
						method: "tab.create",
						params: {cwd: "/Users/alice/project", focus: false},
					},
					timeoutMs: undefined,
				},
				{
					request: {
						id: "ccp:launch:test100:agent.start",
						method: "agent.start",
						params: {
							name: "ccp-test100",
							kind: "claude",
							pane_id: "w100:p100",
							args,
							timeout_ms: 30000,
						},
					},
					timeoutMs: 35000,
				},
				{
					request: {
						id: "ccp:launch:test100:agent.prompt",
						method: "agent.prompt",
						params: {target: "w100:p100", text: trickyPrompt},
					},
					timeoutMs: undefined,
				},
			],
		});
	});

	it("does not send a prompt when none was given", async () => {
		const herdr = fakeHerdr({
			"tab.create": {ok: true, value: tabCreated},
			"agent.start": {ok: true, value: agentStarted(["claude"])},
		});

		const response = await handleHerdrLaunch(
			request({cwd: "/Users/alice/project"}),
			dependencies({request: herdr.requester}),
		);

		expect({
			status: response.status,
			methods: herdr.requests.map(({request: sent}) => (sent as {method: string}).method),
			startArgs: (herdr.requests[1]?.request as {params: {args: string[]}}).params.args,
		}).toStrictEqual({status: 200, methods: ["tab.create", "agent.start"], startArgs: []});
	});

	it("retries the prompt while herdr is still registering the new agent", async () => {
		const promptResults: HerdrResult<unknown>[] = [
			{
				ok: false,
				code: "agent_not_ready",
				message: "agent w100:p100 is not an active named agent",
			},
			{
				ok: false,
				code: "agent_not_ready",
				message: "agent w100:p100 is not an active named agent",
			},
			{ok: true, value: {type: "ok"}},
		];
		const methods: string[] = [];
		const waits: number[] = [];
		const sendRequest: HerdrRequester = async (requestValue) => {
			const method = (requestValue as {method: string}).method;
			methods.push(method);
			if (method === "tab.create") return {ok: true, value: tabCreated};
			if (method === "agent.start") return {ok: true, value: agentStarted(["claude"])};
			return promptResults.shift() ?? {ok: false, code: "unexpected", message: method};
		};

		const response = await handleHerdrLaunch(
			request({cwd: "/Users/alice/project", prompt: "hello"}),
			dependencies({
				request: sendRequest,
				wait: async (ms) => {
					waits.push(ms);
				},
			}),
		);

		expect({status: response.status, methods, waits}).toStrictEqual({
			status: 200,
			methods: ["tab.create", "agent.start", "agent.prompt", "agent.prompt", "agent.prompt"],
			waits: [250, 250],
		});
	});

	it("gives up on the prompt after herdr stays not-ready", async () => {
		const methods: string[] = [];
		const sendRequest: HerdrRequester = async (requestValue) => {
			const method = (requestValue as {method: string}).method;
			methods.push(method);
			if (method === "tab.create") return {ok: true, value: tabCreated};
			if (method === "agent.start") return {ok: true, value: agentStarted(["claude"])};
			return {ok: false, code: "agent_not_ready", message: "Fabricated never ready"};
		};

		const response = await handleHerdrLaunch(
			request({cwd: "/Users/alice/project", prompt: "hello"}),
			dependencies({request: sendRequest}),
		);

		expect({
			response: await describeResponse(response),
			promptAttempts: methods.filter((method) => method === "agent.prompt").length,
		}).toStrictEqual({
			response: {body: {error: "Fabricated never ready"}, status: 409},
			promptAttempts: 20,
		});
	});

	it("closes the new tab and reports the herdr reason when claude fails to start", async () => {
		const herdr = fakeHerdr({
			"tab.create": {ok: true, value: tabCreated},
			"agent.start": {ok: false, code: "agent_not_ready", message: "Fabricated startup stall"},
			"tab.close": {ok: true, value: {type: "ok"}},
		});

		const response = await handleHerdrLaunch(
			request({cwd: "/Users/alice/project", prompt: "hello"}),
			dependencies({request: herdr.requester}),
		);

		expect({
			response: await describeResponse(response),
			closeRequest: herdr.requests[2]?.request,
			requestCount: herdr.requests.length,
		}).toStrictEqual({
			response: {body: {error: "Fabricated startup stall"}, status: 409},
			closeRequest: {
				id: "ccp:launch:test100:tab.close",
				method: "tab.close",
				params: {tab_id: "w100:t100"},
			},
			requestCount: 3,
		});
	});

	it("returns 502 when herdr returns an unrecognized tab.create result", async () => {
		const herdr = fakeHerdr({"tab.create": {ok: true, value: {type: "ok"}}});

		const response = await handleHerdrLaunch(
			request({cwd: "/Users/alice/project"}),
			dependencies({request: herdr.requester}),
		);

		expect({
			response: await describeResponse(response),
			requestCount: herdr.requests.length,
		}).toStrictEqual({
			response: {body: {error: "herdr returned an invalid tab.create result"}, status: 502},
			requestCount: 1,
		});
	});
});
