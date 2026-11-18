import {z} from "zod";

import {rejectCrossSite} from "../same-origin-guard";
import {herdrRequest, type HerdrResult} from "./client";
import type {HerdrRequester} from "./panes";
import {showsAnyDialog} from "./permission-screen";
import {herdrWritesEnabled, resolveHerdrPromptTarget, type HerdrPromptTarget} from "./prompt";
import {readHerdrScreen} from "./read-screen";
import {readComposerInput, visibleText} from "./rewind";

/**
 * Stops one background task through the CLI's own `/tasks` dialog, the local stand-in for upstream's
 * `transport.stopTask`. Read off CLI 2.1.327 (tests/fixtures/tasks-dialog-screens.ts): `/tasks` is an
 * immediate command, so it opens mid-turn too. With one task running it opens straight on that task's
 * detail; otherwise on a "Background" list (shells by command, everything else by description, newest
 * first, under kind headings once kinds mix). Enter opens a row's detail, whose title is the task's
 * description; `x` there stops it and drops back to the list, or closes the dialog when it was the only
 * one. Every key follows a screen read that shows what the key expects, and a screen that doesn't match
 * backs out with Escape before `x` is ever pressed.
 */

const COMMAND = "/tasks";
const LIST_TITLE = "Background";
const LIST_FOOTER = "Esc to close";
const DETAIL_FOOTER = "← to go back";
const DIALOG_BORDER = "▔";
/** A selectable task row: selection mark, status glyph, label, then the status after a run of spaces. */
const TASK_ROW = /^ {2}(❯| ) (\S) (.*?\S) {2,}(\S.*?)\s*$/u;
/** The row that opens the session's earlier, finished tasks. */
const EARLIER_ROW = /^ {2}(❯| ) +(Earlier in this session \(\d+\))\s*$/u;
const COMMAND_LINE = /^\s*Command:\s+(.*?)\s*$/u;

const STEP_PAUSE_MS = 80;
/** Screen reads before giving up on the CLI drawing the next step (about 2 s at the step pause). */
const SCREEN_ATTEMPTS = 25;

export interface TasksDialogRow
{
	label: string;
	/** "running", "running · Opus 5.5", "done · Opus 5.5"; empty for the Earlier row. */
	status: string;
	selected: boolean;
}

export type TasksDialog =
	|
	  {
			view: "list";
			rows: TasksDialogRow[];
	  }
	|
	  {
			view: "detail";
			title: string;
			/** A shell's `Command:` line; null for other kinds. */
			command: string | null;
	  };

/** The `/tasks` dialog drawn on screen, or null when it is not. */
export function parseTasksDialog(screen: string): TasksDialog | null
{
	const lines = screen.split("\n");
	const border = lines.findLastIndex((line) => line.startsWith(DIALOG_BORDER));
	if (border < 0) return null;
	const block = lines.slice(border + 1);
	const footer = block.findLastIndex((line) => line.includes(LIST_FOOTER));
	if (footer < 0) return null;
	const body = block.slice(0, footer);
	if (block[footer]?.includes(DETAIL_FOOTER) === true)
	{
		const title = body.find((line) => line.trim() !== "")?.trim();
		if (title === undefined) return null;
		const command = body.map((line) => COMMAND_LINE.exec(line)?.[1]).find((value) => value !== undefined);
		return {
			view: "detail",
			title,
			command: command ?? null,
		};
	}
	if (body.find((line) => line.trim() !== "")?.trim() !== LIST_TITLE) return null;
	const rows = body.flatMap((line): TasksDialogRow[] =>
	{
		const task = TASK_ROW.exec(line);
		if (task !== null)
			return [
				{
					label: task[3] ?? "",
					status: task[4] ?? "",
					selected: task[1] === "❯",
				},
			];
		const earlier = EARLIER_ROW.exec(line);
		if (earlier !== null)
			return [
				{
					label: earlier[2] ?? "",
					status: "",
					selected: earlier[1] === "❯",
				},
			];
		return [];
	});
	return {
		view: "list",
		rows,
	};
}

const HerdrStopTaskSchema = z.strictObject(
	{
		sessionId: z.string().min(1),
		kind: z.enum(["bash", "agent", "monitor", "workflow", "task"]),
		description: z.string(),
		command: z.string().nullable(),
	},
);

type StopTaskTarget = z.infer<typeof HerdrStopTaskSchema>;

function oneLine(text: string): string
{
	return text.replace(/\s+/gu, " ").trim();
}

/** Whether a label the dialog drew (cut with "…" when too long) is `full`. */
function drawnAs(drawn: string, full: string): boolean
{
	return drawn.endsWith("…") ? full.startsWith(drawn.slice(0, -1)) : drawn === full;
}

/** What the list shows for the task: a shell's command, any other task's description. */
function listLabel(task: StopTaskTarget): string
{
	return oneLine(task.kind === "bash" && task.command !== null ? task.command : task.description);
}

function runningMatches(rows: readonly TasksDialogRow[], task: StopTaskTarget): number[]
{
	const label = listLabel(task);
	return rows.flatMap((row, index) => (row.status.startsWith("running") && drawnAs(row.label, label) ? [index] : []));
}

/** Whether the detail is the task's: its title, and a shell's command. */
function detailMatches(
	dialog: Extract<
		TasksDialog,
		{
			view: "detail";
		}
	>,
	task: StopTaskTarget,
): boolean
{
	const title = oneLine(task.description === "" ? (task.command ?? "") : task.description);
	if (dialog.title !== title) return false;
	if (task.kind !== "bash" || task.command === null) return true;
	return dialog.command !== null && drawnAs(dialog.command, oneLine(task.command));
}

export interface HerdrStopTaskDependencies
{
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
	readScreen: (sessionId: string, paneId: string) => Promise<HerdrResult<string>>;
	request: HerdrRequester;
	createRequestId: () => string;
	/** Waits between keys and screen reads so the TUI reads each key and redraws. */
	pause: () => Promise<void>;
}

export const defaultHerdrStopTaskDependencies: HerdrStopTaskDependencies =
{
	rejectRequest: rejectCrossSite,
	writesEnabled: herdrWritesEnabled,
	resolveTarget: async (sessionId) => resolveHerdrPromptTarget(sessionId),
	readScreen: async (_sessionId, paneId) => readHerdrScreen(paneId, herdrRequest, "ansi"),
	request: herdrRequest,
	createRequestId: () => `ccp:stop-task:${crypto.randomUUID()}`,
	pause: async () =>
		new Promise((resolve) =>
		{
			setTimeout(resolve, STEP_PAUSE_MS);
		}),
};

type StopTaskFailure = "not-at-prompt" | "no-dialog" | "not-found" | "ambiguous" | "not-stopped" | "pane";

const FAILURE_MESSAGES: Readonly<Record<StopTaskFailure, string>> =
{
	"not-at-prompt": "The terminal is not showing an empty prompt",
	"no-dialog": "The terminal didn’t open its task list",
	"not-found": "That task isn’t in the terminal’s task list",
	ambiguous: "More than one task in the terminal matches that one",
	"not-stopped": "The terminal didn’t stop the task",
	pane: "The terminal couldn’t be read or typed into",
};

class StopAborted extends Error
{
	/** The response code: the reason, or for a refused herdr/tmux call that call's own code. */
	readonly code: string;

	constructor(
		readonly reason: StopTaskFailure,
		refused?:
		{
			code: string;
			message: string;
		},
	)
	{
		super(refused?.message ?? FAILURE_MESSAGES[reason]);
		this.code = refused?.code ?? reason;
	}
}

function errorResponse(error: string, status: number, code?: string): Response
{
	return Response.json(
		code === undefined
			?
				{
					error,
				}
			:
				{
					error,
					code,
				},
		{
			status,
		},
	);
}

function targetFailureStatus(code: string): number
{
	return code === "agent_not_ready" ? 409 : 502;
}

/**
 * POST `{sessionId, kind, description, command}`: stop that running background task through the
 * session's live CLI. Nothing is typed unless the CLI shows an empty prompt with no dialog up.
 */
export async function handleHerdrStopTask(
	request: Request,
	dependencies: HerdrStopTaskDependencies = defaultHerdrStopTaskDependencies,
): Promise<Response>
{
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;
	if (!dependencies.writesEnabled()) return errorResponse("herdr writes are disabled", 403);
	const parsed = HerdrStopTaskSchema.safeParse(await request.json());
	if (!parsed.success) return errorResponse("sessionId, kind, description and command are required", 400);
	const task = parsed.data;

	const target = await dependencies.resolveTarget(task.sessionId);
	if (!target.ok) return errorResponse(target.message, targetFailureStatus(target.code), target.code);
	const {paneId} = target.value;

	const read = async (): Promise<string> =>
	{
		const screen = await dependencies.readScreen(task.sessionId, paneId);
		if (!screen.ok) throw new StopAborted("pane", screen);
		return visibleText(screen.value);
	};
	const send = async (
		call:
			|
			  {
					method: "agent.send_keys";
					keys: string[];
			  }
			|
			  {
					method: "pane.send_text";
					text: string;
			  },
	) =>
	{
		const response = await dependencies.request(
			{
				id: dependencies.createRequestId(),
				method: call.method,
				params:
					call.method === "agent.send_keys"
						?
							{
								target: paneId,
								keys: call.keys,
							}
						:
							{
								target: paneId,
								text: call.text,
							},
			},
		);
		if (!response.ok) throw new StopAborted("pane", response);
	};
	const press = async (key: string) =>
		send(
			{
				method: "agent.send_keys",
				keys: [key],
			},
		);
	/** Re-reads until `accept` returns a value, or gives up with `reason`. */
	const waitFor = async <T>(accept: (screen: string) => T | null, reason: StopTaskFailure): Promise<T> =>
	{
		for (let attempt = 0; attempt < SCREEN_ATTEMPTS; attempt++)
		{
			if (attempt > 0) await dependencies.pause();
			const value = accept(await read());
			if (value !== null) return value;
		}
		throw new StopAborted(reason);
	};

	let dialogOpen = false;
	try
	{
		const first = await read();
		if (readComposerInput(first) !== "" || showsAnyDialog(first)) throw new StopAborted("not-at-prompt");
		await send(
			{
				method: "pane.send_text",
				text: COMMAND,
			},
		);
		await dependencies.pause();
		await waitFor((screen) => (readComposerInput(screen) === COMMAND ? true : null), "not-at-prompt");
		await press("enter");
		await dependencies.pause();
		let dialog = await waitFor(parseTasksDialog, "no-dialog");
		dialogOpen = true;

		if (dialog.view === "list")
		{
			let rows = dialog.rows;
			const matches = runningMatches(rows, task);
			if (matches.length === 0) throw new StopAborted("not-found");
			if (matches.length > 1) throw new StopAborted("ambiguous");
			// One arrow per screen read, so a selection that doesn't move is caught before Enter.
			for (let step = 0; ; step++)
			{
				const wanted = runningMatches(rows, task);
				const selected = rows.findIndex((row) => row.selected);
				if (wanted.length !== 1 || selected < 0 || step > rows.length) throw new StopAborted("not-found");
				const delta = (wanted[0] ?? selected) - selected;
				if (delta === 0) break;
				await press(delta > 0 ? "down" : "up");
				await dependencies.pause();
				const moved = await waitFor(parseTasksDialog, "not-found");
				if (moved.view !== "list") throw new StopAborted("not-found");
				rows = moved.rows;
			}
			await press("enter");
			await dependencies.pause();
			dialog = await waitFor((screen) =>
			{
				const shown = parseTasksDialog(screen);
				return shown?.view === "detail" ? shown : null;
			}, "not-found");
		}
		if (!detailMatches(dialog, task)) throw new StopAborted("not-found");

		await send(
			{
				method: "pane.send_text",
				text: "x",
			},
		);
		await dependencies.pause();
		const outcome = await waitFor((screen): "closed" | "list" | null =>
		{
			const shown = parseTasksDialog(screen);
			if (shown === null) return readComposerInput(screen) === null ? null : "closed";
			if (shown.view === "list" && runningMatches(shown.rows, task).length === 0) return "list";
			return null;
		}, "not-stopped");
		if (outcome === "list") await press("esc");
	}
	catch (error)
	{
		if (!(error instanceof StopAborted)) throw error;
		if (dialogOpen && error.reason !== "pane") await press("esc").catch(() => undefined);
		return errorResponse(
			error.message,
			error.reason === "pane" ? targetFailureStatus(error.code) : 409,
			error.code,
		);
	}
	return Response.json(
		{
			ok: true,
		},
	);
}
