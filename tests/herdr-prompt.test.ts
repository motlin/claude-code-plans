import {describe, expect, it, vi} from "vite-plus/test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {ActiveSessionEntry} from "../src/lib/active-session-store";
import type {HerdrResult} from "../src/lib/herdr/client";
import {
	handleHerdrPrompt,
	herdrWritesEnabled,
	midTurnPromptReady,
	resolveHerdrPromptTarget,
	type HerdrMidTurnDependencies,
	type HerdrPromptDependencies,
} from "../src/lib/herdr/prompt";
import {createHerdrPaneTable, type HerdrPaneState} from "../src/lib/herdr/pane-table";
import type {HerdrRequester} from "../src/lib/herdr/panes";
import {rejectCrossSite} from "../src/lib/same-origin-guard";

function request(body: unknown, headers?: HeadersInit): Request {
	const requestHeaders = new Headers(headers);
	requestHeaders.set("Content-Type", "application/json");
	return new Request("http://127.0.0.1:7526/api/herdr/prompt", {
		method: "POST",
		headers: requestHeaders,
		body: JSON.stringify(body),
	});
}

async function describeResponse(response: Response): Promise<{
	body: unknown;
	status: number;
}> {
	const contentType = response.headers.get("content-type");
	return {
		body: contentType?.startsWith("application/json") ? await response.json() : await response.text(),
		status: response.status,
	};
}

function entry(overrides: Partial<ActiveSessionEntry> = {}): ActiveSessionEntry {
	return {
		sessionId: "session-test-100",
		state: "working",
		cwd: "/tmp/test/project",
		model: "claude-test-model",
		startedAt: 0,
		lastActivity: 0,
		claudeEnv: {},
		tmuxPane: "",
		tmuxServerSocket: "",
		herdrPane: "w100:p100",
		herdrWorkspace: "w100",
		herdrSocketPath: "/tmp/test/herdr.sock",
		lastSubagentActivityAt: null,
		backgroundTasks: [],
		...overrides,
	};
}

function snapshot(paneId: string): object {
	const workspaceId = paneId.split(":")[0];
	return {
		type: "session_snapshot",
		snapshot: {
			version: "99.0.0-test",
			protocol: 100,
			workspaces: [],
			tabs: [],
			panes: [
				{
					pane_id: paneId,
					terminal_id: "terminal-test-100",
					workspace_id: workspaceId,
					tab_id: `${workspaceId}:t100`,
					focused: true,
					agent_status: "idle",
					agent: "claude",
					agent_session: {
						source: "test-source",
						agent: "claude",
						kind: "id",
						value: "session-test-100",
					},
					revision: 100,
				},
			],
			layouts: [],
			agents: [],
			focused_workspace_id: workspaceId,
			focused_tab_id: `${workspaceId}:t100`,
			focused_pane_id: paneId,
		},
	};
}

function dependencies(overrides: Partial<HerdrPromptDependencies> = {}): HerdrPromptDependencies {
	return {
		rejectRequest: rejectCrossSite,
		writesEnabled: () => true,
		resolveTarget: async () =>
			Promise.resolve({
				ok: true,
				value: {terminalId: "terminal-test-100", paneId: "w100:p100"},
			}),
		request: async () => Promise.resolve({ok: true, value: {type: "agent_prompted"}}),
		createRequestId: () => "ccp:prompt:test-100",
		midTurn: midTurnDependencies(),
		...overrides,
	};
}

function midTurnDependencies(overrides: Partial<HerdrMidTurnDependencies> = {}): HerdrMidTurnDependencies {
	return {
		ready: () => false,
		resolveTarget: async () =>
			Promise.resolve({
				ok: true,
				value: {terminalId: "terminal-test-100", paneId: "w100:p200"},
			}),
		request: async () => Promise.resolve({ok: true, value: {}}),
		createRequestId: () => "ccp:mid-turn:test-100",
		pause: async () => Promise.resolve(),
		...overrides,
	};
}

describe("herdr prompt write handler", () => {
	it("reads write enablement from persisted application config", () => {
		const directory = mkdtempSync(join(tmpdir(), "herdr-writes-test-"));
		const configPath = join(directory, "config.json");
		try {
			expect(herdrWritesEnabled(configPath)).toBe(false);
			writeFileSync(configPath, JSON.stringify({herdr_writes_enabled: true}));
			expect(herdrWritesEnabled(configPath)).toBe(true);
			writeFileSync(configPath, JSON.stringify({herdr_writes_enabled: false}));
			expect(herdrWritesEnabled(configPath)).toBe(false);
		} finally {
			rmSync(directory, {recursive: true, force: true});
		}
	});

	it("returns before parsing or resolving when writes are disabled", async () => {
		const resolveTarget = vi.fn<HerdrPromptDependencies["resolveTarget"]>();
		const sendRequest = vi.fn<HerdrRequester>();

		const response = await handleHerdrPrompt(
			request({sessionId: "session-test-100", prompt: "Test prompt"}),
			dependencies({writesEnabled: () => false, resolveTarget, request: sendRequest}),
		);

		expect({
			response: await describeResponse(response),
			resolveTargetCalls: resolveTarget.mock.calls,
			sendRequestCalls: sendRequest.mock.calls,
		}).toStrictEqual({
			response: {body: {error: "herdr writes are disabled"}, status: 403},
			resolveTargetCalls: [],
			sendRequestCalls: [],
		});
	});

	it("rejects cross-site requests before checking the feature flag", async () => {
		const calls: string[] = [];

		const response = await handleHerdrPrompt(
			request(
				{sessionId: "session-test-100", prompt: "Test prompt"},
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

	it("returns 400 without resolving for invalid input", async () => {
		const resolveTarget = vi.fn<HerdrPromptDependencies["resolveTarget"]>();

		const response = await handleHerdrPrompt(
			request({sessionId: "session-test-100"}),
			dependencies({resolveTarget}),
		);

		expect({
			response: await describeResponse(response),
			resolveTargetCalls: resolveTarget.mock.calls,
		}).toStrictEqual({
			response: {body: {error: "sessionId and prompt are required"}, status: 400},
			resolveTargetCalls: [],
		});
	});

	it("re-resolves a durable terminal to its current pane for every request", async () => {
		const snapshots = [snapshot("w100:p100"), snapshot("w200:p200")];
		const requests: object[] = [];
		const requester: HerdrRequester = async (requestValue) => {
			requests.push(requestValue);
			const value = snapshots.shift();
			if (!value) return Promise.reject(new Error("missing fabricated snapshot"));
			return Promise.resolve({ok: true, value});
		};
		const entries = [entry()];

		const targets = await Promise.all([
			resolveHerdrPromptTarget("session-test-100", entries, requester),
			resolveHerdrPromptTarget("session-test-100", entries, requester),
		]);

		expect({targets, requests}).toStrictEqual({
			targets: [
				{
					ok: true,
					value: {terminalId: "terminal-test-100", paneId: "w100:p100"},
				},
				{
					ok: true,
					value: {terminalId: "terminal-test-100", paneId: "w200:p200"},
				},
			],
			requests: [
				{id: "ccp:snap", method: "session.snapshot", params: {}},
				{id: "ccp:snap", method: "session.snapshot", params: {}},
			],
		});
	});

	it("resolves the target from a current pane table without a socket round trip", async () => {
		const requests: object[] = [];
		const requester: HerdrRequester = async (requestValue) => {
			requests.push(requestValue);
			return Promise.resolve({ok: false, code: "connect-failed", message: "socket must not be used"});
		};
		const table = createHerdrPaneTable();
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fabricated snapshot matches the wire shape
		const {snapshot: state} = snapshot("w100:p100") as {snapshot: HerdrPaneState};
		table.seed(state);
		table.apply("pane_moved", {
			previous_pane_id: "w100:p100",
			previous_workspace_id: "w100",
			previous_tab_id: "w100:t100",
			pane: {...state.panes[0], pane_id: "w300:p300", workspace_id: "w300", tab_id: "w300:t300", revision: 101},
		});

		const target = await resolveHerdrPromptTarget("session-test-100", [entry()], requester, table);

		expect({target, requests}).toStrictEqual({
			target: {ok: true, value: {terminalId: "terminal-test-100", paneId: "w300:p300"}},
			requests: [],
		});
	});

	it("sends the exact agent.prompt request to the current pane", async () => {
		const requests: object[] = [];
		const sendRequest: HerdrRequester = async (requestValue) => {
			requests.push(requestValue);
			return Promise.resolve({ok: true, value: {type: "agent_prompted"}});
		};

		const response = await handleHerdrPrompt(
			request({sessionId: "session-test-100", prompt: "Test prompt for Alice\nSecond line"}),
			dependencies({request: sendRequest}),
		);

		expect({response: await describeResponse(response), requests}).toStrictEqual({
			response: {body: {ok: true}, status: 200},
			requests: [
				{
					id: "ccp:prompt:test-100",
					method: "agent.prompt",
					params: {
						target: "w100:p100",
						text: "Test prompt for Alice\nSecond line",
					},
				},
			],
		});
	});

	it.each([
		{code: "agent_not_ready", status: 409},
		{code: "agent_prompt_stalled", status: 409},
		{code: "empty_agent_prompt", status: 400},
		{code: "fabricated_transport_error", status: 502},
	])("maps $code to HTTP $status with the herdr reason", async ({code, status}) => {
		const error: HerdrResult<unknown> = {
			ok: false,
			code,
			message: `Fabricated ${code} reason`,
		};

		const response = await handleHerdrPrompt(
			request({sessionId: "session-test-100", prompt: "Test prompt"}),
			dependencies({request: async () => Promise.resolve(error)}),
		);

		expect(await describeResponse(response)).toStrictEqual({
			body: {error: `Fabricated ${code} reason`, code},
			status,
		});
	});

	it("types a mid-turn prompt as text then Enter into the freshly resolved pane while working with no dialog", async () => {
		const calls: unknown[] = [];
		const record: HerdrRequester = async (requestValue) => {
			calls.push(requestValue);
			return Promise.resolve({ok: true, value: {}});
		};

		const responses = [];
		for (const prompt of ["Alice's follow-up", "First line\nSecond line"]) {
			responses.push(
				await describeResponse(
					await handleHerdrPrompt(
						request({sessionId: "session-test-100", prompt, midTurn: true}),
						dependencies({
							request: async () => Promise.reject(new Error("agent.prompt must not be used")),
							midTurn: midTurnDependencies({
								ready: (sessionId) => {
									calls.push(`ready ${sessionId}`);
									return true;
								},
								request: record,
								pause: async () => {
									calls.push("pause");
									return Promise.resolve();
								},
							}),
						}),
					),
				),
			);
		}

		expect({responses, calls}).toStrictEqual({
			responses: [
				{body: {ok: true}, status: 200},
				{body: {ok: true}, status: 200},
			],
			calls: [
				"ready session-test-100",
				"ready session-test-100",
				{
					id: "ccp:mid-turn:test-100",
					method: "pane.send_text",
					params: {pane_id: "w100:p200", text: "Alice's follow-up"},
				},
				"pause",
				"ready session-test-100",
				{
					id: "ccp:mid-turn:test-100",
					method: "agent.send_keys",
					params: {target: "w100:p200", keys: ["enter"]},
				},
				"ready session-test-100",
				"ready session-test-100",
				{
					id: "ccp:mid-turn:test-100",
					method: "pane.send_text",
					params: {pane_id: "w100:p200", text: "\u001b[200~First line\nSecond line\u001b[201~"},
				},
				"pause",
				"ready session-test-100",
				{
					id: "ccp:mid-turn:test-100",
					method: "agent.send_keys",
					params: {target: "w100:p200", keys: ["enter"]},
				},
			],
		});
	});

	it("sends a mid-turn prompt through the ready-checked agent.prompt when a dialog is pending or the state is not working", async () => {
		const requests: unknown[] = [];
		const midTurnRequests: unknown[] = [];

		const response = await handleHerdrPrompt(
			request({sessionId: "session-test-100", prompt: "Alice's follow-up", midTurn: true}),
			dependencies({
				request: async (requestValue) => {
					requests.push(requestValue);
					return Promise.resolve({
						ok: false,
						code: "agent_not_ready",
						message: "Fabricated agent is working",
					});
				},
				midTurn: midTurnDependencies({
					ready: () => false,
					request: async (requestValue) => {
						midTurnRequests.push(requestValue);
						return Promise.resolve({ok: true, value: {}});
					},
				}),
			}),
		);

		expect({response: await describeResponse(response), requests, midTurnRequests}).toStrictEqual({
			response: {body: {error: "Fabricated agent is working", code: "agent_not_ready"}, status: 409},
			requests: [
				{
					id: "ccp:prompt:test-100",
					method: "agent.prompt",
					params: {target: "w100:p100", text: "Alice's follow-up"},
				},
			],
			midTurnRequests: [],
		});
	});

	it("stops typing a mid-turn prompt with agent_not_ready once a dialog opens before Enter", async () => {
		const readiness = [true, true, false];
		const calls: unknown[] = [];

		const response = await handleHerdrPrompt(
			request({sessionId: "session-test-100", prompt: "Alice's follow-up", midTurn: true}),
			dependencies({
				midTurn: midTurnDependencies({
					ready: () => readiness.shift() ?? false,
					request: async (requestValue) => {
						calls.push(requestValue);
						return Promise.resolve({ok: true, value: {}});
					},
				}),
			}),
		);

		expect({response: await describeResponse(response), calls}).toStrictEqual({
			response: {
				body: {error: "The session opened a dialog or stopped working", code: "agent_not_ready"},
				status: 409,
			},
			calls: [
				{
					id: "ccp:mid-turn:test-100",
					method: "pane.send_text",
					params: {pane_id: "w100:p200", text: "Alice's follow-up"},
				},
			],
		});
	});
});

describe("midTurnPromptReady", () => {
	const question = {toolUseId: "toolu_test_1", questions: [{question: "Pick one", options: [{label: "A"}]}]};

	it("allows typing mid-turn only while the hook says working and no question or permission waits", () => {
		expect({
			working: midTurnPromptReady(entry({state: "working"}), null),
			idle: midTurnPromptReady(entry({state: "idle"}), null),
			waiting: midTurnPromptReady(entry({state: "waiting"}), null),
			unknown: midTurnPromptReady(entry({state: "unknown"}), null),
			noEntry: midTurnPromptReady(undefined, null),
			question: midTurnPromptReady(entry({state: "working"}), question),
			permission: midTurnPromptReady(
				entry({state: "working", pendingPermissionRequest: {toolName: "Bash", suggestions: []}}),
				null,
			),
		}).toStrictEqual({
			working: true,
			idle: false,
			waiting: false,
			unknown: false,
			noEntry: false,
			question: false,
			permission: false,
		});
	});
});
