import {describe, expect, it} from "vite-plus/test";

import {handleHerdrStopTask, parseTasksDialog, type HerdrStopTaskDependencies} from "../src/lib/herdr/stop-task";
import {rejectCrossSite} from "../src/lib/same-origin-guard";
import
{
	EMPTY,
	IDLE_PROMPT,
	MIXED,
	MIXED_AGENT_DETAIL,
	MONITOR,
	MONITOR_AFTER_DETAIL_X,
	MONITOR_DOWN,
	MONITOR_SHELL_DETAIL,
	SINGLE_AFTER_X,
	SINGLE_DETAIL,
	TRUNCATED_WITH_COMPLETED,
	TWO_SHELLS,
	TYPED_TASKS,
} from "./fixtures/tasks-dialog-screens";

/** What each key does to the screen: `${screen}|${key}` → the next screen. Keys with no entry leave it as is. */
type Transitions = Readonly<Record<string, string>>;

const SCREEN_NAMES = new Map<string, string>([
	[EMPTY, "EMPTY"],
	[IDLE_PROMPT, "IDLE_PROMPT"],
	[MIXED, "MIXED"],
	[MONITOR, "MONITOR"],
	[MONITOR_AFTER_DETAIL_X, "MONITOR_AFTER_DETAIL_X"],
	[MONITOR_DOWN, "MONITOR_DOWN"],
	[MONITOR_SHELL_DETAIL, "MONITOR_SHELL_DETAIL"],
	[SINGLE_AFTER_X, "SINGLE_AFTER_X"],
	[SINGLE_DETAIL, "SINGLE_DETAIL"],
	[TWO_SHELLS, "TWO_SHELLS"],
	[TYPED_TASKS, "TYPED_TASKS"],
]);

function postRequest(body: unknown): Request
{
	return new Request(
		"http://127.0.0.1:7526/api/herdr/stop-task",
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

/** A fake pane: reads serve the current screen, and every write moves it along `transitions`. */
function harness(start: string, transitions: Transitions, overrides: Partial<HerdrStopTaskDependencies> = {})
{
	const log: string[] = [];
	let screen = start;
	const name = (value: string): string => SCREEN_NAMES.get(value) ?? "?";
	const byName = new Map([...SCREEN_NAMES].map(([value, key]) => [key, value]));
	const dependencies: HerdrStopTaskDependencies =
	{
		rejectRequest: rejectCrossSite,
		writesEnabled: () => true,
		resolveTarget: async () =>
			Promise.resolve(
				{
					ok: true,
					value:
					{
						terminalId: "terminal-1",
						paneId: "w1:p1",
					},
				},
			),
		readScreen: async () =>
		{
			log.push(`read ${name(screen)}`);
			return Promise.resolve(
				{
					ok: true,
					value: screen,
				},
			);
		},
		request: async (call) =>
		{
			const fields = call as
			{
				method: string;
				params:
				{
					keys?: string[];
					text?: string;
				};
			};
			const key =
				fields.method === "pane.send_text"
					? `text:${fields.params.text ?? ""}`
					: (fields.params.keys ?? []).join(" ");
			log.push(key);
			const next = transitions[`${name(screen)}|${key}`];
			if (next !== undefined) screen = byName.get(next) ?? screen;
			return Promise.resolve(
				{
					ok: true,
					value:
					{
						type: "ok",
					},
				},
			);
		},
		createRequestId: () => "ccp:stop-task:test",
		pause: async () => Promise.resolve(),
		...overrides,
	};
	return {
		log,
		dependencies,
	};
}

const SLEEP_ALONE =
{
	sessionId: "session-1",
	kind: "bash",
	description: "Sleep alone",
	command: "sleep 300",
};

/** The real CLI path from the idle prompt through the MONITOR captures. */
const MONITOR_FLOW: Transitions =
{
	"IDLE_PROMPT|text:/tasks": "TYPED_TASKS",
	"TYPED_TASKS|enter": "MONITOR",
	"MONITOR|down": "MONITOR_DOWN",
	"MONITOR_DOWN|enter": "MONITOR_SHELL_DETAIL",
	"MONITOR_SHELL_DETAIL|text:x": "MONITOR_AFTER_DETAIL_X",
	"MONITOR_AFTER_DETAIL_X|esc": "IDLE_PROMPT",
	"MONITOR|esc": "IDLE_PROMPT",
	"MONITOR_SHELL_DETAIL|esc": "IDLE_PROMPT",
};

async function post(
	body: unknown,
	start: string,
	transitions: Transitions,
	overrides: Partial<HerdrStopTaskDependencies> = {},
)
{
	const {log, dependencies} = harness(start, transitions, overrides);
	const response = await handleHerdrStopTask(postRequest(body), dependencies);
	return {
		status: response.status,
		body: await response.json(),
		keys: log.filter((line) => !line.startsWith("read ")),
		finalScreen: log.findLast((line) => line.startsWith("read ")),
	};
}

describe("parseTasksDialog", () =>
{
	it("reads the list's rows, statuses and selection, skipping section headings", () =>
	{
		expect(parseTasksDialog(MIXED)).toStrictEqual(
			{
				view: "list",
				rows: [
					{
						label: "sleep 300",
						status: "running",
						selected: true,
					},
					{
						label: "sleep 300",
						status: "running",
						selected: false,
					},
					{
						label: "Wait around agent",
						status: "running · Opus 5.5",
						selected: false,
					},
					{
						label: "Earlier in this session (0)",
						status: "",
						selected: false,
					},
				],
			},
		);
	});

	it("keeps a cut-off command's ellipsis and reads finished rows", () =>
	{
		expect(parseTasksDialog(TRUNCATED_WITH_COMPLETED)).toStrictEqual(
			{
				view: "list",
				rows: [
					{
						label: "sleep 301 && echo this is a much longer command l…",
						status: "running",
						selected: true,
					},
					{
						label: "sleep 300",
						status: "running",
						selected: false,
					},
					{
						label: "Wait around agent",
						status: "done · Opus 5.5",
						selected: false,
					},
					{
						label: "Earlier in this session (0)",
						status: "",
						selected: false,
					},
				],
			},
		);
	});

	it("reads a shell's detail and an agent's detail", () =>
	{
		expect([parseTasksDialog(SINGLE_DETAIL), parseTasksDialog(MIXED_AGENT_DETAIL)]).toStrictEqual([
			{
				view: "detail",
				title: "Sleep alone",
				command: "sleep 300",
			},
			{
				view: "detail",
				title: "Wait around agent",
				command: null,
			},
		]);
	});

	it("reads the empty list, and nothing off the prompt", () =>
	{
		expect([parseTasksDialog(EMPTY), parseTasksDialog(IDLE_PROMPT), parseTasksDialog(TYPED_TASKS)]).toStrictEqual([
			{
				view: "list",
				rows: [
					{
						label: "Earlier in this session (0)",
						status: "",
						selected: true,
					},
				],
			},
			null,
			null,
		]);
	});
});

describe("herdr stop-task handler", () =>
{
	it("opens /tasks, moves one row down, checks the detail, presses x, then closes the list", async () =>
	{
		expect(await post(SLEEP_ALONE, IDLE_PROMPT, MONITOR_FLOW)).toStrictEqual(
			{
				status: 200,
				body:
				{
					ok: true,
				},
				keys: ["text:/tasks", "enter", "down", "enter", "text:x", "esc"],
				finalScreen: "read MONITOR_AFTER_DETAIL_X",
			},
		);
	});

	it("presses x on the detail /tasks opens with when only one task runs, and sends no Escape after the dialog closes", async () =>
	{
		expect(
			await post(
				SLEEP_ALONE,
				IDLE_PROMPT,
				{
					"IDLE_PROMPT|text:/tasks": "TYPED_TASKS",
					"TYPED_TASKS|enter": "SINGLE_DETAIL",
					"SINGLE_DETAIL|text:x": "SINGLE_AFTER_X",
				},
			),
		).toStrictEqual(
			{
				status: 200,
				body:
				{
					ok: true,
				},
				keys: ["text:/tasks", "enter", "text:x"],
				finalScreen: "read SINGLE_AFTER_X",
			},
		);
	});

	it("closes the dialog without pressing x when no running row matches", async () =>
	{
		expect(
			await post(
				{
					...SLEEP_ALONE,
					description: "Nope",
					command: "sleep 999",
				},
				IDLE_PROMPT,
				MONITOR_FLOW,
			),
		).toStrictEqual(
			{
				status: 409,
				body:
				{
					error: "That task isn’t in the terminal’s task list",
					code: "not-found",
				},
				keys: ["text:/tasks", "enter", "esc"],
				finalScreen: "read MONITOR",
			},
		);
	});

	it("refuses to guess between two running rows that read the same", async () =>
	{
		expect(
			await post(
				{
					...SLEEP_ALONE,
					description: "Sleep same",
				},
				IDLE_PROMPT,
				{
					"IDLE_PROMPT|text:/tasks": "TYPED_TASKS",
					"TYPED_TASKS|enter": "MIXED",
					"MIXED|esc": "IDLE_PROMPT",
				},
			),
		).toStrictEqual(
			{
				status: 409,
				body:
				{
					error: "More than one task in the terminal matches that one",
					code: "ambiguous",
				},
				keys: ["text:/tasks", "enter", "esc"],
				finalScreen: "read MIXED",
			},
		);
	});

	it("backs out without x when the detail shows a different task", async () =>
	{
		expect(
			await post(
				{
					...SLEEP_ALONE,
					description: "Sleep other",
				},
				IDLE_PROMPT,
				{
					"IDLE_PROMPT|text:/tasks": "TYPED_TASKS",
					"TYPED_TASKS|enter": "SINGLE_DETAIL",
					"SINGLE_DETAIL|esc": "IDLE_PROMPT",
				},
			),
		).toStrictEqual(
			{
				status: 409,
				body:
				{
					error: "That task isn’t in the terminal’s task list",
					code: "not-found",
				},
				keys: ["text:/tasks", "enter", "esc"],
				finalScreen: "read SINGLE_DETAIL",
			},
		);
	});

	it("presses nothing more when the dialog never appears", async () =>
	{
		expect(
			await post(
				SLEEP_ALONE,
				IDLE_PROMPT,
				{
					"IDLE_PROMPT|text:/tasks": "TYPED_TASKS",
					"TYPED_TASKS|enter": "IDLE_PROMPT",
				},
			),
		).toStrictEqual(
			{
				status: 409,
				body:
				{
					error: "The terminal didn’t open its task list",
					code: "no-dialog",
				},
				keys: ["text:/tasks", "enter"],
				finalScreen: "read IDLE_PROMPT",
			},
		);
	});

	it("reports a task still listed after x, and closes the dialog", async () =>
	{
		expect(
			await post(
				SLEEP_ALONE,
				IDLE_PROMPT,
				{
					...MONITOR_FLOW,
					"MONITOR_SHELL_DETAIL|text:x": "MONITOR_SHELL_DETAIL",
				},
			),
		).toStrictEqual(
			{
				status: 409,
				body:
				{
					error: "The terminal didn’t stop the task",
					code: "not-stopped",
				},
				keys: ["text:/tasks", "enter", "down", "enter", "text:x", "esc"],
				finalScreen: "read MONITOR_SHELL_DETAIL",
			},
		);
	});

	it("types nothing when a dialog is already up", async () =>
	{
		expect(await post(SLEEP_ALONE, TWO_SHELLS, MONITOR_FLOW)).toStrictEqual(
			{
				status: 409,
				body:
				{
					error: "The terminal is not showing an empty prompt",
					code: "not-at-prompt",
				},
				keys: [],
				finalScreen: "read TWO_SHELLS",
			},
		);
	});

	it("is forbidden while herdr writes are off", async () =>
	{
		expect(
			await post(
				SLEEP_ALONE,
				IDLE_PROMPT,
				MONITOR_FLOW,
				{
					writesEnabled: () => false,
				},
			),
		).toStrictEqual(
			{
				status: 403,
				body:
				{
					error: "herdr writes are disabled",
				},
				keys: [],
				finalScreen: undefined,
			},
		);
	});
});
