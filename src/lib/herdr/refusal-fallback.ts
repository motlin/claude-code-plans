import {z} from "zod";

import {rejectCrossSite} from "../same-origin-guard";
import {herdrRequest, type HerdrResult} from "./client";
import type {HerdrRequester} from "./panes";
import {herdrWritesEnabled, resolveHerdrPromptTarget, type HerdrPromptTarget} from "./prompt";
import {readHerdrScreen} from "./read-screen";
import {clearInput, readComposerInput, visibleText} from "./rewind";

/**
 * The CLI's "Session paused" refusal-fallback dialog (CLI 2.1.319 `dMe`), read
 * off the pane and answered with its own keys: a digit picks its row at once
 * (1 Switch, 2 Edit), Esc cancels. Edit makes the CLI abort the turn and put
 * the refused prompt back in its input, which is moved to the browser composer.
 */
export interface RefusalFallbackDialog
{
	body: string;
	guidance: string | null;
	category: string | null;
	switchLabel: string;
	switchRow: number;
	editLabel: string;
	editRow: number;
	focus: "switch" | "edit" | null;
}

const TITLE = "Session paused";
const OPTION_ROW = /^\s*(❯\s*)?(\d+)\.\s+(.*\S)\s*$/;
const SWITCH_LABEL = /^Switch to .+$/;
const EDIT_LABEL = /^Edit prompt and retry(?: with .+)?$/;
/** The `Rwt` body's trailing category; the CLI may draw its inline code with or without the backticks. */
const DETAILS = /\s*Details:\s*`?\[([^\]]+)\]`?\s*$/;

/** Groups of consecutive non-empty lines, each joined with a space. */
function paragraphs(lines: string[]): string[]
{
	const groups: string[][] = [[]];
	for (const line of lines)
	{
		if (line.trim() === "") groups.push([]);
		else groups.at(-1)?.push(line.trim());
	}
	return groups.filter((group) => group.length > 0).map((group) => group.join(" "));
}

/**
 * Read the refusal-fallback dialog under the screen's last "Session paused"
 * title: a body (with an optional `Details: [category]`), optional guidance,
 * then exactly a Switch row and an Edit row numbered 1 and 2. Null for any
 * other screen, including the CLI's usage-credits "Session paused".
 */
export function parseRefusalFallbackDialog(screen: string): RefusalFallbackDialog | null
{
	const lines = screen.split("\n");
	const start = lines.findLastIndex((line) => line.trim() === TITLE);
	if (start < 0) return null;
	const below = lines.slice(start + 1);
	const firstRow = below.findIndex((line) => OPTION_ROW.test(line));
	if (firstRow < 0) return null;
	const rows: RegExpExecArray[] = [];
	for (const line of below.slice(firstRow))
	{
		const row = OPTION_ROW.exec(line);
		if (row === null) break;
		rows.push(row);
	}
	if (rows.length !== 2) return null;
	const switchRow = rows.find((row) => SWITCH_LABEL.test(row[3] ?? ""));
	const editRow = rows.find((row) => EDIT_LABEL.test(row[3] ?? ""));
	if (switchRow === undefined || editRow === undefined) return null;
	if (switchRow === editRow || !["1", "2"].includes(switchRow[2] ?? "") || !["1", "2"].includes(editRow[2] ?? ""))
		return null;

	const [first = "", ...rest] = paragraphs(below.slice(0, firstRow));
	const details = DETAILS.exec(first);
	const focused = rows.find((row) => row[1] !== undefined);
	return {
		body: details === null ? first : first.slice(0, details.index).trim(),
		guidance: rest.length === 0 ? null : rest.join("\n"),
		category: details?.[1] ?? null,
		switchLabel: switchRow[3] ?? "",
		switchRow: Number(switchRow[2]),
		editLabel: editRow[3] ?? "",
		editRow: Number(editRow[2]),
		focus: focused === undefined ? null : focused === switchRow ? "switch" : "edit",
	};
}

const HerdrRefusalFallbackSchema = z.strictObject(
	{
		sessionId: z.string().min(1),
		choice: z.enum(["retry_fallback", "edit_prompt", "cancelled"]),
	},
);

export interface HerdrRefusalFallbackDependencies
{
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
	/** The pane's visible screen with its colour escapes, so a dim prompt suggestion can be told from typed text. */
	readScreen: (sessionId: string, paneId: string) => Promise<HerdrResult<string>>;
	request: HerdrRequester;
	createRequestId: () => string;
	/** Waits between keys and screen reads so the TUI reads each key and redraws. */
	pause: () => Promise<void>;
}

const STEP_PAUSE_MS = 80;
/** Screen reads while waiting for Edit to put the prompt back in the CLI input (about 3 s at the step pause). */
const EDIT_ATTEMPTS = 37;

export const defaultHerdrRefusalFallbackDependencies: HerdrRefusalFallbackDependencies =
{
	rejectRequest: rejectCrossSite,
	writesEnabled: herdrWritesEnabled,
	resolveTarget: async (sessionId) => resolveHerdrPromptTarget(sessionId),
	readScreen: async (_sessionId, paneId) => readHerdrScreen(paneId, herdrRequest, "ansi"),
	request: herdrRequest,
	createRequestId: () => `ccp:refusal-fallback:${crypto.randomUUID()}`,
	pause: async () =>
		new Promise((resolve) =>
		{
			setTimeout(resolve, STEP_PAUSE_MS);
		}),
};

const NOT_SHOWN = "The terminal is not showing this dialog";

function errorResponse(error: string, status: number): Response
{
	return Response.json(
		{
			error,
		},
		{
			status,
		},
	);
}

function rejectEarly(request: Request, dependencies: HerdrRefusalFallbackDependencies): Response | null
{
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;
	if (!dependencies.writesEnabled()) return errorResponse("herdr writes are disabled", 403);
	return null;
}

interface ScreenRead
{
	dialog: RefusalFallbackDialog | null;
	/** The CLI input box with any dim prompt suggestion left out; null when no box shows. */
	input: string | null;
}

async function readDialog(
	sessionId: string,
	paneId: string,
	dependencies: HerdrRefusalFallbackDependencies,
): Promise<HerdrResult<ScreenRead>>
{
	const screen = await dependencies.readScreen(sessionId, paneId);
	if (!screen.ok) return screen;
	return {
		ok: true,
		value:
		{
			dialog: parseRefusalFallbackDialog(visibleText(screen.value)),
			input: readComposerInput(
				visibleText(
					screen.value,
					{
						dropDim: true,
					},
				),
			),
		},
	};
}

/** GET: the session's refusal-fallback dialog as its pane shows it, or `{dialog: null}`. */
export async function handleHerdrRefusalFallbackDialog(
	request: Request,
	dependencies: HerdrRefusalFallbackDependencies = defaultHerdrRefusalFallbackDependencies,
): Promise<Response>
{
	const rejection = rejectEarly(request, dependencies);
	if (rejection) return rejection;
	const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
	if (sessionId === "") return errorResponse("sessionId is required", 400);
	const target = await dependencies.resolveTarget(sessionId);
	if (!target.ok) return errorResponse(target.message, 502);
	const read = await readDialog(sessionId, target.value.paneId, dependencies);
	if (!read.ok) return errorResponse(read.message, 502);
	return Response.json(
		{
			dialog: read.value.dialog,
		},
	);
}

/**
 * POST: answer the refusal-fallback dialog in the session's live pane. The
 * screen is read just before the key, and nothing is pressed unless it shows
 * this dialog. After Edit, the prompt the CLI puts back in its input is cleared
 * there and returned as `text`, so the browser composer gets it instead.
 */
export async function handleHerdrRefusalFallback(
	request: Request,
	dependencies: HerdrRefusalFallbackDependencies = defaultHerdrRefusalFallbackDependencies,
): Promise<Response>
{
	const rejection = rejectEarly(request, dependencies);
	if (rejection) return rejection;
	const parsed = HerdrRefusalFallbackSchema.safeParse(await request.json());
	if (!parsed.success) return errorResponse("sessionId and a refusal fallback choice are required", 400);
	const {sessionId, choice} = parsed.data;

	const target = await dependencies.resolveTarget(sessionId);
	if (!target.ok) return errorResponse(target.message, 502);
	const {paneId} = target.value;
	const first = await readDialog(sessionId, paneId, dependencies);
	if (!first.ok) return errorResponse(first.message, 502);
	const {dialog} = first.value;
	if (dialog === null) return errorResponse(NOT_SHOWN, 409);

	const press = async (key: string): Promise<HerdrResult<unknown>> =>
		dependencies.request(
			{
				id: dependencies.createRequestId(),
				method: "agent.send_keys",
				params:
				{
					target: paneId,
					keys: [key],
				},
			},
		);
	const key =
		choice === "retry_fallback"
			? String(dialog.switchRow)
			: choice === "edit_prompt"
				? String(dialog.editRow)
				: "esc";
	const pressed = await press(key);
	if (!pressed.ok) return errorResponse(pressed.message, pressed.code === "agent_not_ready" ? 409 : 502);
	if (choice !== "edit_prompt")
		return Response.json(
			{
				ok: true,
			},
		);

	const read = async (): Promise<ScreenRead> =>
	{
		const screen = await readDialog(sessionId, paneId, dependencies);
		return screen.ok
			? screen.value
			:
				{
					dialog: null,
					input: null,
				};
	};
	let text: string | null = null;
	for (let attempt = 0; attempt < EDIT_ATTEMPTS && text === null; attempt++)
	{
		await dependencies.pause();
		const screen = await read();
		if (screen.dialog === null && screen.input !== null && screen.input !== "") text = screen.input;
	}
	const cleared =
		text !== null &&
		(await clearInput(
			read,
			async (next) =>
			{
				await press(next);
			},
			dependencies.pause,
		));
	return Response.json(
		{
			ok: true,
			text: cleared ? text : null,
		},
	);
}
