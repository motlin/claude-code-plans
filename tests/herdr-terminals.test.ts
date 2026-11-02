import {describe, expect, it, vi} from "vite-plus/test";
import {HerdrTerminalIndexResponse} from "../src/lib/api/herdr-terminals";
import type {HerdrResult} from "../src/lib/herdr/client";
import type {HerdrRequester} from "../src/lib/herdr/panes";
import
{
	getHerdrTerminals,
	handleHerdrTerminalAction,
	type HerdrTerminalActionDependencies,
} from "../src/lib/herdr/terminals";
import {rejectCrossSite} from "../src/lib/same-origin-guard";

const DEFAULT_SERVER =
{
	session: null,
	socketPath: "/tmp/test/default/herdr.sock",
};
const LATER_SERVER =
{
	session: "later",
	socketPath: "/tmp/test/sessions/later/herdr.sock",
};

interface RecordedRequest
{
	request:
	{
		id: string;
		method: string;
		params: Record<string, unknown>;
	};
	socketPath: string | undefined;
}

/** A fake herdr: `respond` answers each request; every request is recorded in order. */
function fakeHerdr(
	respond: (method: string, params: Record<string, unknown>, socketPath?: string) => HerdrResult<unknown>,
)
{
	const requests: RecordedRequest[] = [];
	const requester: HerdrRequester = async (value, _timeoutMs, socketPath) =>
	{
		const request = value as RecordedRequest["request"];
		requests.push(
			{
				request,
				socketPath,
			},
		);
		return Promise.resolve(respond(request.method, request.params, socketPath));
	};
	return {
		requester,
		requests,
	};
}

function unexpected(method: string): HerdrResult<never>
{
	return {
		ok: false,
		code: "unexpected",
		message: method,
	};
}

function wirePane(paneId: string, tabId: string, overrides: Record<string, unknown> = {})
{
	const workspaceId = paneId.split(":")[0]!;
	return {
		pane_id: paneId,
		terminal_id: `terminal-${paneId}`,
		workspace_id: workspaceId,
		tab_id: tabId,
		focused: false,
		cwd: "/Users/alice/project",
		foreground_cwd: "/Users/alice/project/src",
		agent_status: "unknown",
		terminal_title: `Terminal ${paneId}`,
		revision: 1,
		...overrides,
	};
}

function wireTab(tabId: string, number: number, label: string, focused = false)
{
	return {
		tab_id: tabId,
		workspace_id: tabId.split(":")[0]!,
		number,
		label,
		focused,
		pane_count: 1,
		agent_status: "unknown",
	};
}

function wireWorkspace(workspaceId: string, number: number, label: string, focused = false)
{
	return {
		workspace_id: workspaceId,
		number,
		label,
		focused,
		pane_count: 1,
		tab_count: 1,
		active_tab_id: `${workspaceId}:t1`,
		agent_status: "unknown",
	};
}

function snapshot(
	workspaces: ReturnType<typeof wireWorkspace>[],
	tabs: ReturnType<typeof wireTab>[],
	panes: ReturnType<typeof wirePane>[],
): HerdrResult<unknown>
{
	return {
		ok: true,
		value:
		{
			type: "session_snapshot",
			snapshot:
			{
				version: "0.9.5",
				protocol: 1,
				workspaces,
				tabs,
				panes,
				layouts: [],
				agents: [],
			},
		},
	};
}

function processInfo(
	paneId: string,
	shellPid: number | null,
	foreground:
	{
		pid: number;
		cmdline: string;
	}[],
)
{
	return {
		ok: true as const,
		value:
		{
			type: "pane_process_info",
			process_info:
			{
				pane_id: paneId,
				shell_pid: shellPid,
				foreground_process_group_id: foreground[0]?.pid ?? null,
				foreground_processes: foreground.map(({pid, cmdline}) => (
				{
					pid,
					name: cmdline.split(" ")[0]!,
					cmdline,
				})),
			},
		},
	};
}

describe("getHerdrTerminals", () =>
{
	it("lists every server's workspaces, tabs and panes, Claude and plain shells, with each pane's command and process state", async () =>
	{
		const {requester, requests} = fakeHerdr((method, params, socketPath) =>
		{
			if (method === "session.snapshot" && socketPath === DEFAULT_SERVER.socketPath)
			{
				return snapshot(
					[wireWorkspace("w2", 2, "notes"), wireWorkspace("w1", 1, "project", true)],
					[wireTab("w1:t2", 2, "shell"), wireTab("w1:t1", 1, "claude", true), wireTab("w2:t1", 1, "notes")],
					[
						wirePane(
							"w1:p1",
							"w1:t1",
							{
								focused: true,
								agent: "claude",
								agent_status: "working",
								agent_session:
								{
									source: "herdr:claude",
									agent: "claude",
									kind: "id",
									value: "session-test-100",
								},
							},
						),
						wirePane("w1:p2", "w1:t2"),
						wirePane(
							"w1:p3",
							"w1:t2",
							{
								terminal_title: null,
								foreground_cwd: null,
							},
						),
						wirePane("w2:p1", "w2:t1"),
					],
				);
			}
			if (method === "session.snapshot" && socketPath === LATER_SERVER.socketPath)
			{
				return snapshot(
					[wireWorkspace("w1", 1, "later")],
					[wireTab("w1:t1", 1, "scratch")],
					[wirePane("w1:p1", "w1:t1")],
				);
			}
			if (method === "pane.process_info")
			{
				switch (params["pane_id"])
				{
					case "w1:p1":
						return processInfo("w1:p1", 100, [
							{
								pid: 101,
								cmdline: "claude --resume",
							},
						]);
					case "w1:p2":
						return processInfo("w1:p2", 200, [
							{
								pid: 200,
								cmdline: "-zsh",
							},
						]);
					case "w1:p3":
						return processInfo("w1:p3", 300, [
							{
								pid: 301,
								cmdline: "vim notes.md",
							},
						]);
					case "w2:p1":
						return processInfo("w2:p1", null, []);
					default:
						return {
							ok: false,
							code: "pane_not_found",
							message: "pane not found",
						};
				}
			}
			return unexpected(method);
		});

		const workspaces = await getHerdrTerminals(requester, () => [DEFAULT_SERVER, LATER_SERVER]);

		const shellPane =
		{
			focused: false,
			agent: null,
			agentStatus: "unknown",
			claudeSessionId: null,
		};
		expect(
			{
				workspaces,
				response: HerdrTerminalIndexResponse.parse(
					{
						workspaces,
					},
				),
				methods: requests.map(({request, socketPath}) => [request.method, request.params, socketPath]),
			},
		).toStrictEqual(
			{
				workspaces: [
					{
						workspaceId: "w1",
						number: 1,
						label: "project",
						focused: true,
						tabs: [
							{
								tabId: "w1:t1",
								number: 1,
								label: "claude",
								focused: true,
								panes: [
									{
										paneId: "w1:p1",
										terminalId: "terminal-w1:p1",
										title: "Terminal w1:p1",
										cwd: "/Users/alice/project/src",
										focused: true,
										agent: "claude",
										agentStatus: "working",
										claudeSessionId: "session-test-100",
										command: "claude --resume",
										process: "running",
									},
								],
							},
							{
								tabId: "w1:t2",
								number: 2,
								label: "shell",
								focused: false,
								panes: [
									{
										...shellPane,
										paneId: "w1:p2",
										terminalId: "terminal-w1:p2",
										title: "Terminal w1:p2",
										cwd: "/Users/alice/project/src",
										command: "-zsh",
										process: "idle",
									},
									{
										...shellPane,
										paneId: "w1:p3",
										terminalId: "terminal-w1:p3",
										title: "/Users/alice/project",
										cwd: "/Users/alice/project",
										command: "vim notes.md",
										process: "running",
									},
								],
							},
						],
					},
					{
						workspaceId: "w2",
						number: 2,
						label: "notes",
						focused: false,
						tabs: [
							{
								tabId: "w2:t1",
								number: 1,
								label: "notes",
								focused: false,
								panes: [
									{
										...shellPane,
										paneId: "w2:p1",
										terminalId: "terminal-w2:p1",
										title: "Terminal w2:p1",
										cwd: "/Users/alice/project/src",
										command: null,
										process: "exited",
									},
								],
							},
						],
					},
					{
						workspaceId: "w1@later",
						number: 1,
						label: "later (later)",
						focused: false,
						tabs: [
							{
								tabId: "w1:t1@later",
								number: 1,
								label: "scratch",
								focused: false,
								panes: [
									{
										...shellPane,
										paneId: "w1:p1@later",
										terminalId: "terminal-w1:p1",
										title: "Terminal w1:p1",
										cwd: "/Users/alice/project/src",
										command: null,
										process: "unknown",
									},
								],
							},
						],
					},
				],
				response:
				{
					workspaces,
				},
				methods: [
					["session.snapshot", {}, DEFAULT_SERVER.socketPath],
					["session.snapshot", {}, LATER_SERVER.socketPath],
					[
						"pane.process_info",
						{
							pane_id: "w1:p1",
						},
						undefined,
					],
					[
						"pane.process_info",
						{
							pane_id: "w1:p2",
						},
						undefined,
					],
					[
						"pane.process_info",
						{
							pane_id: "w1:p3",
						},
						undefined,
					],
					[
						"pane.process_info",
						{
							pane_id: "w2:p1",
						},
						undefined,
					],
					[
						"pane.process_info",
						{
							pane_id: "w1:p1@later",
						},
						undefined,
					],
				],
			},
		);
	});

	it("skips a server whose snapshot fails and returns nothing when herdr is absent", async () =>
	{
		const {requester} = fakeHerdr(() => (
		{
			ok: false,
			code: "connect-failed",
			message: "ENOENT",
		}));

		expect(await getHerdrTerminals(requester, () => [DEFAULT_SERVER])).toStrictEqual([]);
	});
});

function actionRequest(body: unknown, headers?: HeadersInit): Request
{
	const requestHeaders = new Headers(headers);
	requestHeaders.set("Content-Type", "application/json");
	return new Request(
		"http://127.0.0.1:7526/api/herdr/terminals",
		{
			method: "POST",
			headers: requestHeaders,
			body: JSON.stringify(body),
		},
	);
}

async function describeResponse(response: Response): Promise<
{
	body: unknown;
	status: number;
}>
{
	return {
		body: await response.json(),
		status: response.status,
	};
}

const tabCreated = (tabId: string, paneId: string): HerdrResult<unknown> => (
{
	ok: true,
	value:
	{
		type: "tab_created",
		tab: wireTab(tabId, 3, "new"),
		root_pane: wirePane(paneId, tabId),
	},
});

function actionDependencies(
	requester: HerdrRequester,
	overrides: Partial<HerdrTerminalActionDependencies> = {},
): HerdrTerminalActionDependencies
{
	return {
		rejectRequest: rejectCrossSite,
		writesEnabled: () => true,
		request: requester,
		createRequestId: () => "ccp:terminal:test",
		homeDir: () => "/Users/alice",
		launchServer: () => DEFAULT_SERVER,
		...overrides,
	};
}

async function runAction(body: unknown, respond: Parameters<typeof fakeHerdr>[0], overrides = {})
{
	const {requester, requests} = fakeHerdr(respond);
	const response = await handleHerdrTerminalAction(actionRequest(body), actionDependencies(requester, overrides));
	return {
		response: await describeResponse(response),
		requests: requests.map(({request, socketPath}) => (
		{
			method: request.method,
			params: request.params,
			socketPath,
		})),
	};
}

describe("handleHerdrTerminalAction", () =>
{
	it("creates a tab running the login shell in the home directory by default, on the launch server", async () =>
	{
		expect(
			await runAction(
				{
					action: "create-tab",
				},
				(method) => (method === "tab.create" ? tabCreated("w1:t3", "w1:p9") : unexpected(method)),
			),
		).toStrictEqual(
			{
				response:
				{
					body:
					{
						ok: true,
						tabId: "w1:t3",
						paneId: "w1:p9",
					},
					status: 200,
				},
				requests: [
					{
						method: "tab.create",
						params:
						{
							cwd: "/Users/alice",
							focus: false,
						},
						socketPath: DEFAULT_SERVER.socketPath,
					},
				],
			},
		);
	});

	it("creates a labelled tab in a given workspace and directory, then types the given command into its shell", async () =>
	{
		expect(
			await runAction(
				{
					action: "create-tab",
					cwd: "/Users/alice/project",
					workspaceId: "w1@later",
					label: "server",
					command: "npm run dev",
				},
				(method) =>
				{
					if (method === "tab.create") return tabCreated("w1:t3", "w1:p9");
					if (method === "pane.send_text" || method === "pane.send_keys")
						return {
							ok: true,
							value:
							{
								type: "ok",
							},
						};
					return unexpected(method);
				},
				{
					launchServer: () => LATER_SERVER,
				},
			),
		).toStrictEqual(
			{
				response:
				{
					body:
					{
						ok: true,
						tabId: "w1:t3@later",
						paneId: "w1:p9@later",
					},
					status: 200,
				},
				requests: [
					{
						method: "tab.create",
						params:
						{
							cwd: "/Users/alice/project",
							focus: false,
							workspace_id: "w1@later",
							label: "server",
						},
						socketPath: undefined,
					},
					{
						method: "pane.send_text",
						params:
						{
							pane_id: "w1:p9@later",
							text: "npm run dev",
						},
						socketPath: undefined,
					},
					{
						method: "pane.send_keys",
						params:
						{
							pane_id: "w1:p9@later",
							keys: ["enter"],
						},
						socketPath: undefined,
					},
				],
			},
		);
	});

	it("keeps the new tab and names it when typing the command fails", async () =>
	{
		expect(
			await runAction(
				{
					action: "create-tab",
					command: "top",
				},
				(method) =>
				{
					if (method === "tab.create") return tabCreated("w1:t3", "w1:p9");
					if (method === "pane.send_text")
						return {
							ok: false,
							code: "pane_not_found",
							message: "pane not found",
						};
					return unexpected(method);
				},
			),
		).toStrictEqual(
			{
				response:
				{
					body:
					{
						error: "pane not found",
						code: "pane_not_found",
						tabId: "w1:t3",
						paneId: "w1:p9",
					},
					status: 404,
				},
				requests: [
					{
						method: "tab.create",
						params:
						{
							cwd: "/Users/alice",
							focus: false,
						},
						socketPath: DEFAULT_SERVER.socketPath,
					},
					{
						method: "pane.send_text",
						params:
						{
							pane_id: "w1:p9",
							text: "top",
						},
						socketPath: undefined,
					},
				],
			},
		);
	});

	it("splits a pane in a direction, optionally in a directory and running a command", async () =>
	{
		expect(
			await runAction(
				{
					action: "split-pane",
					paneId: "w1:p2",
					direction: "down",
					cwd: "/Users/alice/logs",
					command: "tail -f app.log",
				},
				(method) =>
				{
					if (method === "pane.split")
					{
						return {
							ok: true,
							value:
							{
								type: "pane_info",
								pane: wirePane("w1:p7", "w1:t2"),
							},
						};
					}
					if (method === "pane.send_text" || method === "pane.send_keys")
						return {
							ok: true,
							value:
							{
								type: "ok",
							},
						};
					return unexpected(method);
				},
			),
		).toStrictEqual(
			{
				response:
				{
					body:
					{
						ok: true,
						paneId: "w1:p7",
					},
					status: 200,
				},
				requests: [
					{
						method: "pane.split",
						params:
						{
							target_pane_id: "w1:p2",
							direction: "down",
							focus: false,
							cwd: "/Users/alice/logs",
						},
						socketPath: undefined,
					},
					{
						method: "pane.send_text",
						params:
						{
							pane_id: "w1:p7",
							text: "tail -f app.log",
						},
						socketPath: undefined,
					},
					{
						method: "pane.send_keys",
						params:
						{
							pane_id: "w1:p7",
							keys: ["enter"],
						},
						socketPath: undefined,
					},
				],
			},
		);
	});

	it("qualifies the split pane's id with the source pane's herdr session", async () =>
	{
		expect(
			await runAction(
				{
					action: "split-pane",
					paneId: "w1:p2@later",
					direction: "right",
				},
				(method) =>
					method === "pane.split"
						?
							{
								ok: true,
								value:
								{
									type: "pane_info",
									pane: wirePane("w1:p7", "w1:t2"),
								},
							}
						: unexpected(method),
			),
		).toStrictEqual(
			{
				response:
				{
					body:
					{
						ok: true,
						paneId: "w1:p7@later",
					},
					status: 200,
				},
				requests: [
					{
						method: "pane.split",
						params:
						{
							target_pane_id: "w1:p2@later",
							direction: "right",
							focus: false,
						},
						socketPath: undefined,
					},
				],
			},
		);
	});

	it.each([
		[
			{
				action: "close-pane",
				paneId: "w1:p2",
			},
			"pane.close",
			{
				pane_id: "w1:p2",
			},
		],
		[
			{
				action: "close-tab",
				tabId: "w1:t2",
			},
			"tab.close",
			{
				tab_id: "w1:t2",
			},
		],
		[
			{
				action: "rename-tab",
				tabId: "w1:t2",
				label: "build",
			},
			"tab.rename",
			{
				tab_id: "w1:t2",
				label: "build",
			},
		],
		[
			{
				action: "focus-pane",
				paneId: "w1:p2",
			},
			"pane.focus",
			{
				pane_id: "w1:p2",
			},
		],
		[
			{
				action: "focus-tab",
				tabId: "w1:t2",
			},
			"tab.focus",
			{
				tab_id: "w1:t2",
			},
		],
	])("forwards %j to herdr's %s", async (body, method, params) =>
	{
		expect(
			await runAction(body, (called) =>
				called === method
					?
						{
							ok: true,
							value:
							{
								type: "ok",
							},
						}
					: unexpected(called),
			),
		).toStrictEqual(
			{
				response:
				{
					body:
					{
						ok: true,
					},
					status: 200,
				},
				requests: [
					{
						method,
						params,
						socketPath: undefined,
					},
				],
			},
		);
	});

	it("maps herdr's not-found errors to 404 and other failures to 502", async () =>
	{
		const notFound = await runAction(
			{
				action: "close-tab",
				tabId: "w9:t9",
			},
			() => (
			{
				ok: false,
				code: "tab_not_found",
				message: "tab w9:t9 not found",
			}),
		);
		const offline = await runAction(
			{
				action: "focus-pane",
				paneId: "w1:p1",
			},
			() => (
			{
				ok: false,
				code: "connect-failed",
				message: "ENOENT",
			}),
		);

		expect([notFound.response, offline.response]).toStrictEqual([
			{
				body:
				{
					error: "tab w9:t9 not found",
					code: "tab_not_found",
				},
				status: 404,
			},
			{
				body:
				{
					error: "ENOENT",
					code: "connect-failed",
				},
				status: 502,
			},
		]);
	});

	it.each([
		[
			{
				action: "explode",
			},
		],
		[
			{
				action: "create-tab",
				cwd: "relative/dir",
			},
		],
		[
			{
				action: "create-tab",
				command: "   ",
			},
		],
		[
			{
				action: "split-pane",
				paneId: "w1:p1",
				direction: "left",
			},
		],
		[
			{
				action: "rename-tab",
				tabId: "w1:t1",
				label: "",
			},
		],
		[
			{
				action: "close-pane",
				paneId: "w1:p1",
				extra: true,
			},
		],
	])("rejects the invalid body %j with 400 before asking herdr", async (body) =>
	{
		const result = await runAction(body, (method) => unexpected(method));

		expect(
			{
				status: result.response.status,
				requests: result.requests,
			},
		).toStrictEqual(
			{
				status: 400,
				requests: [],
			},
		);
	});

	it("refuses with 403 when Live terminal input is off, before parsing", async () =>
	{
		expect(
			await runAction(
				{
					action: "close-pane",
					paneId: "w1:p1",
				},
				(method) => unexpected(method),
				{
					writesEnabled: () => false,
				},
			),
		).toStrictEqual(
			{
				response:
				{
					body:
					{
						error: "herdr writes are disabled",
					},
					status: 403,
				},
				requests: [],
			},
		);
	});

	it("rejects cross-site requests with the same guard as the other herdr writes", async () =>
	{
		const send = vi.fn<HerdrRequester>();
		const response = await handleHerdrTerminalAction(
			actionRequest(
				{
					action: "close-pane",
					paneId: "w1:p1",
				},
				{
					Origin: "https://attacker.example.com",
					"Sec-Fetch-Site": "cross-site",
				},
			),
			actionDependencies(send),
		);

		expect(
			{
				response: await describeResponse(response),
				calls: send.mock.calls,
			},
		).toStrictEqual(
			{
				response:
				{
					body:
					{
						error: "Forbidden",
					},
					status: 403,
				},
				calls: [],
			},
		);
	});
});
