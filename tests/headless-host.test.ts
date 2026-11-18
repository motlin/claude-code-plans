import {describe, expect, it} from "vite-plus/test";

import {withHeadlessSessions} from "../src/lib/headless/host";
import {HeadlessRegistry} from "../src/lib/headless/registry";
import type {TerminalHost} from "../src/lib/terminal-host";
import {FakeCli} from "./helpers/fake-headless-cli";

const HEADLESS_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PANE_SESSION_ID = "pane-session-alice";

function hostStub(calls: string[]): TerminalHost
{
	const write = (name: string) => async (): Promise<Response> =>
	{
		calls.push(name);
		return Promise.resolve(
			Response.json(
				{
					ok: true,
					via: "pane",
				},
			),
		);
	};
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stub of only the members these tests reach
	return {
		id: "herdr",
		canWrite: true,
		canStream: true,
		listPanes: async () => Promise.resolve([]),
		prompt: write("prompt"),
		interrupt: write("interrupt"),
		stopBackgroundAgents: write("stopBackgroundAgents"),
		stopBackgroundTask: write("stopBackgroundTask"),
		answerQuestion: write("answerQuestion"),
		answerPermission: write("answerPermission"),
		readPermissionDialog: write("readPermissionDialog"),
		readPlanDialog: write("readPlanDialog"),
		answerPlan: write("answerPlan"),
		readElicitationDialog: write("readElicitationDialog"),
		answerElicitation: write("answerElicitation"),
		readRefusalFallbackDialog: write("readRefusalFallbackDialog"),
		answerRefusalFallback: write("answerRefusalFallback"),
		rewind: write("rewind"),
		toggleRemoteControl: write("toggleRemoteControl"),
		applyLiveOption: write("applyLiveOption"),
	} as unknown as TerminalHost;
}

interface Harness
{
	host: TerminalHost;
	cli: FakeCli;
	hostCalls: string[];
	cleared: string[];
}

function harness({
	writesEnabled = true,
}:
{
	writesEnabled?: boolean;
} = {}): Harness
{
	const cli = new FakeCli();
	let next = 0;
	const registry = new HeadlessRegistry(
		{
			spawnCli: () => cli,
			createSessionId: () => HEADLESS_ID,
			createRequestId: () => `req-${++next}`,
			readState: () => [],
			writeState: () => undefined,
			processCommand: async () => Promise.resolve(null),
			killPid: () => undefined,
			broadcast: () => undefined,
		},
	);
	registry.launch(
		{
			cwd: "/fixture/alice-project",
			prompt: "Say pong",
		},
	);
	cli.stdin.length = 0;
	cli.autoAcknowledge = true;
	const hostCalls: string[] = [];
	const cleared: string[] = [];
	return {
		host: withHeadlessSessions(
			hostStub(hostCalls),
			{
				registry: () => registry,
				rejectRequest: () => null,
				writesEnabled: () => writesEnabled,
				clearPendingPermission: (sessionId) =>
				{
					cleared.push(sessionId);
				},
			},
		),
		cli,
		hostCalls,
		cleared,
	};
}

function post(body: object): Request
{
	return new Request(
		"http://localhost/api/herdr/x",
		{
			method: "POST",
			headers:
			{
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		},
	);
}

function get(sessionId: string): Request
{
	return new Request(`http://localhost/api/herdr/x?sessionId=${sessionId}`);
}

function startTask(cli: FakeCli, taskId: string, description: string, toolUseId?: string): void
{
	cli.emit(
		{
			type: "system",
			subtype: "task_started",
			task_id: taskId,
			description,
			...(toolUseId === undefined
				? {}
				:
					{
						tool_use_id: toolUseId,
					}),
		},
	);
}

function askTool(cli: FakeCli, requestId: string, request: object): void
{
	cli.emit(
		{
			type: "control_request",
			request_id: requestId,
			request:
			{
				subtype: "can_use_tool",
				...request,
			},
		},
	);
}

describe("withHeadlessSessions", () =>
{
	it("lists a headless session as a headless pane link beside the host's panes", async () =>
	{
		const {host} = harness();

		expect(await host.listPanes()).toStrictEqual([
			{
				host: "headless",
				paneId: `headless:${HEADLESS_ID}`,
				terminalId: `headless:${HEADLESS_ID}`,
				workspaceId: "headless",
				tabId: `headless:${HEADLESS_ID}`,
				focused: false,
				cwd: "/fixture/alice-project",
				foregroundCwd: "/fixture/alice-project",
				agentStatus: "working",
				agent: "claude",
				terminalTitle: null,
				agentSessionId: HEADLESS_ID,
				revision: 0,
				sessionId: HEADLESS_ID,
				via: "env",
			},
		]);
	});

	it("leaves writes for pane sessions to the terminal host", async () =>
	{
		const {host, cli, hostCalls} = harness();

		const response = await host.interrupt(
			post(
				{
					sessionId: PANE_SESSION_ID,
				},
			),
		);

		expect(await response.json()).toStrictEqual(
			{
				ok: true,
				via: "pane",
			},
		);
		expect(hostCalls).toStrictEqual(["interrupt"]);
		expect(cli.stdin).toStrictEqual([]);
	});

	it("refuses headless writes while Live terminal input is off", async () =>
	{
		const {host, cli} = harness(
			{
				writesEnabled: false,
			},
		);

		const response = await host.interrupt(
			post(
				{
					sessionId: HEADLESS_ID,
				},
			),
		);

		expect(response.status).toBe(403);
		expect(cli.stdin).toStrictEqual([]);
	});

	it("sends a prompt as a user message", async () =>
	{
		const {host, cli} = harness();

		const response = await host.prompt(
			post(
				{
					sessionId: HEADLESS_ID,
					prompt: "And now ping",
				},
			),
		);

		expect(await response.json()).toStrictEqual(
			{
				ok: true,
			},
		);
		expect(cli.stdin).toStrictEqual([
			{
				type: "user",
				message:
				{
					role: "user",
					content: "And now ping",
				},
				parent_tool_use_id: null,
				session_id: "",
			},
		]);
	});

	it("interrupts with an interrupt control_request instead of Esc", async () =>
	{
		const {host, cli} = harness();

		const response = await host.interrupt(
			post(
				{
					sessionId: HEADLESS_ID,
					force: true,
				},
			),
		);

		expect(await response.json()).toStrictEqual(
			{
				ok: true,
			},
		);
		expect(cli.stdin).toStrictEqual([
			{
				type: "control_request",
				request_id: "req-2",
				request:
				{
					subtype: "interrupt",
				},
			},
		]);
	});

	it("stops one task by its id with stop_task", async () =>
	{
		const {host, cli} = harness();
		startTask(cli, "b0000aaaa", "Watch Alice's build", "toolu_watch");
		startTask(cli, "a0000bbbb", "Research Bob's question");

		const response = await host.stopBackgroundTask(
			post(
				{
					sessionId: HEADLESS_ID,
					id: "a0000bbbb",
					kind: "agent",
					description: "Research Bob's question",
					command: null,
				},
			),
		);

		expect(await response.json()).toStrictEqual(
			{
				ok: true,
			},
		);
		expect(cli.stdin).toStrictEqual([
			{
				type: "control_request",
				request_id: "req-2",
				request:
				{
					subtype: "stop_task",
					task_id: "a0000bbbb",
				},
			},
		]);
	});

	it("falls back to the launching tool_use id, then the task's description, to find the task to stop", async () =>
	{
		const {host, cli} = harness();
		startTask(cli, "b0000aaaa", "npm run watch", "toolu_watch");
		startTask(cli, "b0000cccc", "Tail Carol's log");

		const byToolUse = await host.stopBackgroundTask(
			post(
				{
					sessionId: HEADLESS_ID,
					id: "toolu_watch",
					kind: "bash",
					description: "Watch",
					command: "npm run watch",
				},
			),
		);
		const byDescription = await host.stopBackgroundTask(
			post(
				{
					sessionId: HEADLESS_ID,
					kind: "bash",
					description: "Tail  Carol's\nlog",
					command: null,
				},
			),
		);

		expect([byToolUse.status, byDescription.status]).toStrictEqual([200, 200]);
		expect(
			cli.stdin.map(
				(frame) =>
					(
						frame as
						{
							request: unknown;
						}
					).request,
			),
		).toStrictEqual([
			{
				subtype: "stop_task",
				task_id: "b0000aaaa",
			},
			{
				subtype: "stop_task",
				task_id: "b0000cccc",
			},
		]);
	});

	it("answers 409 for a task that is not running", async () =>
	{
		const {host, cli} = harness();

		const response = await host.stopBackgroundTask(
			post(
				{
					sessionId: HEADLESS_ID,
					id: "b0000dead",
					kind: "bash",
					description: "Gone",
					command: null,
				},
			),
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toStrictEqual(
			{
				error: "That task is not running",
				code: "task_not_running",
			},
		);
		expect(cli.stdin).toStrictEqual([]);
	});

	it("stops all agents with one stop_task per running task", async () =>
	{
		const {host, cli} = harness();
		startTask(cli, "a0000aaaa", "Research Alice's question");
		startTask(cli, "a0000bbbb", "Research Bob's question");
		startTask(cli, "b0000cccc", "npm run watch");

		const response = await host.stopBackgroundAgents(
			post(
				{
					sessionId: HEADLESS_ID,
				},
			),
		);

		expect(response.status).toBe(200);
		expect(
			cli.stdin.map(
				(frame) =>
					(
						frame as
						{
							request: unknown;
						}
					).request,
			),
		).toStrictEqual([
			{
				subtype: "stop_task",
				task_id: "a0000aaaa",
			},
			{
				subtype: "stop_task",
				task_id: "a0000bbbb",
			},
			{
				subtype: "stop_task",
				task_id: "b0000cccc",
			},
		]);
	});

	it("allows the oldest open tool ask with its own input and clears the hook store's pending permission", async () =>
	{
		const {host, cli, cleared} = harness();
		askTool(
			cli,
			"cli-perm-1",
			{
				tool_name: "Bash",
				input:
				{
					command: "ls",
				},
			},
		);
		askTool(
			cli,
			"cli-perm-2",
			{
				tool_name: "Edit",
				input:
				{
					file_path: "/fixture/alice-project/a.ts",
				},
			},
		);

		const response = await host.answerPermission(
			post(
				{
					sessionId: HEADLESS_ID,
					decision: "allow",
				},
			),
		);

		expect(await response.json()).toStrictEqual(
			{
				ok: true,
			},
		);
		expect(cli.stdin).toStrictEqual([
			{
				type: "control_response",
				response:
				{
					subtype: "success",
					request_id: "cli-perm-1",
					response:
					{
						behavior: "allow",
						updatedInput:
						{
							command: "ls",
						},
					},
				},
			},
		]);
		expect(cleared).toStrictEqual([HEADLESS_ID]);
	});

	it("denies with the CLI's rejection message", async () =>
	{
		const {host, cli} = harness();
		askTool(
			cli,
			"cli-perm-1",
			{
				tool_name: "Bash",
				input:
				{
					command: "rm -rf build",
				},
			},
		);

		await host.answerPermission(
			post(
				{
					sessionId: HEADLESS_ID,
					decision: "deny",
				},
			),
		);

		expect(cli.stdin).toStrictEqual([
			{
				type: "control_response",
				response:
				{
					subtype: "success",
					request_id: "cli-perm-1",
					response:
					{
						behavior: "deny",
						message: "The user doesn't want to proceed with this tool use. The tool use was rejected.",
					},
				},
			},
		]);
	});

	it("always-allows with the ask's own permission suggestions, and reads the dialog shape from them", async () =>
	{
		const {host, cli} = harness();
		const suggestion =
		{
			type: "addRules",
			rules: [
				{
					toolName: "Bash",
					ruleContent: "npm test:*",
				},
			],
			behavior: "allow",
			destination: "session",
		};
		askTool(
			cli,
			"cli-perm-1",
			{
				tool_name: "Bash",
				input:
				{
					command: "npm test",
				},
				permission_suggestions: [suggestion],
			},
		);

		const dialog = await host.readPermissionDialog(get(HEADLESS_ID));
		await host.answerPermission(
			post(
				{
					sessionId: HEADLESS_ID,
					decision: "always",
				},
			),
		);

		expect(await dialog.json()).toStrictEqual(
			{
				dialog:
				{
					denyFirst: false,
					persistent: true,
					auto: true,
				},
			},
		);
		expect(cli.stdin).toStrictEqual([
			{
				type: "control_response",
				response:
				{
					subtype: "success",
					request_id: "cli-perm-1",
					response:
					{
						behavior: "allow",
						updatedInput:
						{
							command: "npm test",
						},
						updatedPermissions: [suggestion],
					},
				},
			},
		]);
	});

	it("answers 409 not_pending when no tool ask is open", async () =>
	{
		const {host} = harness();

		const response = await host.answerPermission(
			post(
				{
					sessionId: HEADLESS_ID,
					decision: "allow",
				},
			),
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toStrictEqual(
			{
				error: "No permission request is pending",
				code: "not_pending",
			},
		);
	});

	it("answers AskUserQuestion by allowing it with the chosen labels as answers", async () =>
	{
		const {host, cli} = harness();
		const input =
		{
			questions: [
				{
					question: "Which database?",
					header: "Database",
					options: [
						{
							label: "SQLite",
						},
						{
							label: "Postgres",
						},
					],
				},
				{
					question: "Which extras?",
					header: "Extras",
					multiSelect: true,
					options: [
						{
							label: "FTS",
						},
						{
							label: "WAL",
						},
					],
				},
				{
					question: "Anything else?",
					header: "Else",
					options: [
						{
							label: "No",
						},
					],
				},
			],
		};
		askTool(
			cli,
			"cli-ask-1",
			{
				tool_name: "AskUserQuestion",
				input,
				tool_use_id: "toolu_ask",
			},
		);

		const response = await host.answerQuestion(
			post(
				{
					sessionId: HEADLESS_ID,
					toolUseId: "toolu_ask",
					answers: [
						{
							selected: [1],
						},
						{
							selected: [0, 1],
							other: "Backups\nnightly",
						},
						null,
					],
				},
			),
		);

		expect(response.status).toBe(200);
		expect(cli.stdin).toStrictEqual([
			{
				type: "control_response",
				response:
				{
					subtype: "success",
					request_id: "cli-ask-1",
					response:
					{
						behavior: "allow",
						updatedInput:
						{
							...input,
							answers:
							{
								"Which database?": "Postgres",
								"Which extras?": "FTS, WAL, Backups nightly",
							},
						},
					},
				},
			},
		]);
	});

	it("reads the refusal-fallback dialog from its request and answers it with the chosen result", async () =>
	{
		const {host, cli} = harness();
		cli.emit(
			{
				type: "control_request",
				request_id: "cli-dialog-1",
				request:
				{
					subtype: "request_user_dialog",
					dialog_kind: "refusal_fallback_prompt",
					payload:
					{
						originalModel: "claude-fable-5",
						fallbackModel: "claude-opus-4-8",
						apiRefusalCategory: "cyber",
					},
				},
			},
		);

		const dialog = await host.readRefusalFallbackDialog(get(HEADLESS_ID));
		const answer = await host.answerRefusalFallback(
			post(
				{
					sessionId: HEADLESS_ID,
					choice: "edit_prompt",
				},
			),
		);

		expect(await dialog.json()).toStrictEqual(
			{
				dialog:
				{
					body: "claude-fable-5 declined this request.",
					guidance: null,
					category: "cyber",
					switchLabel: "Switch to claude-opus-4-8",
					switchRow: 1,
					editLabel: "Edit prompt and retry with claude-fable-5",
					editRow: 2,
					focus: "switch",
				},
			},
		);
		expect(await answer.json()).toStrictEqual(
			{
				ok: true,
				text: "Say pong",
			},
		);
		expect(cli.stdin).toStrictEqual([
			{
				type: "control_response",
				response:
				{
					subtype: "success",
					request_id: "cli-dialog-1",
					response:
					{
						behavior: "completed",
						result: "edit_prompt",
					},
				},
			},
		]);
	});

	it("reads no refusal-fallback dialog while none is pending", async () =>
	{
		const {host} = harness();

		const response = await host.readRefusalFallbackDialog(get(HEADLESS_ID));

		expect(await response.json()).toStrictEqual(
			{
				dialog: null,
			},
		);
	});

	it("refuses keystroke-only controls such as rewind for a headless session", async () =>
	{
		const {host, hostCalls} = harness();

		const response = await host.rewind(
			post(
				{
					sessionId: HEADLESS_ID,
				},
			),
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toStrictEqual(
			{
				error: "Not available in a headless session",
				code: "headless_unsupported",
			},
		);
		expect(hostCalls).toStrictEqual([]);
	});

	it("hands a session whose CLI has exited back to the terminal host", async () =>
	{
		const {host, cli} = harness();
		cli.exit(
			{
				code: null,
				signal: "SIGKILL",
				error: null,
			},
		);

		const response = await host.prompt(
			post(
				{
					sessionId: HEADLESS_ID,
					prompt: "Still there?",
				},
			),
		);

		// The ended session leaves the registry, so the write falls through to the terminal host.
		expect(await response.json()).toStrictEqual(
			{
				ok: true,
				via: "pane",
			},
		);
	});
});
