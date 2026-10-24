import {z} from "zod";

import {getActiveSessionEntry} from "../active-session-store";
import {getPendingQuestion} from "../pending-question-store";
import {rejectCrossSite} from "../same-origin-guard";
import {herdrRequest, type HerdrResult} from "./client";
import {readHerdrScreen} from "./plan";
import type {HerdrRequester} from "./panes";
import {herdrWritesEnabled, resolveHerdrPromptTarget, type HerdrPromptTarget} from "./prompt";

/**
 * Conversation rewind by driving the live CLI's own MessageSelector (Esc Esc),
 * as read off CLI 2.1.310: a "Rewind" header over a subtitle ending
 * "the point before…", one row per prompt plus a last "(current)" row the
 * selector opens on, and "Enter to continue · Esc to cancel". Enter restores
 * the conversation at once unless file checkpointing is on, which first shows
 * "Confirm you want to restore…" with numbered restore options.
 */

const SELECTOR_TITLE = "Rewind";
const SELECTOR_FOOTER = "Enter to continue";
const SELECTOR_SUBTITLE = /^Restore .* point before…$/;
const CONFIRM_SUBTITLE = "Confirm you want to restore";
const CURRENT_ROW = "(current)";
const SELECTED_ROW = /^\s*❯\s+(.*\S)\s*$/;
const OPTION_LINE = /^\s*(?:[❯↑↓]\s*)*(\d+)\.\s+(.*\S)\s*$/;
const QUOTE_LINE = /^\s*│\s?(.*)$/;
const RULE_LINE = /^─+$/;
const PLACEHOLDER = /^Try ".*"$/;

/** The CLI option each restore choice picks on the confirm step. */
const RESTORE_LABELS = {
	conversation: "Restore conversation",
	both: "Restore code and conversation",
} as const;

/** The block under the last "Rewind" header whose next non-empty line passes `subtitle`. */
function rewindBlock(screen: string, subtitle: (line: string) => boolean): string[] | null {
	const lines = screen.split("\n");
	const start = lines.findLastIndex((line) => line.trim() === SELECTOR_TITLE);
	if (start < 0) return null;
	const rest = lines.slice(start + 1);
	const first = rest.findIndex((line) => line.trim() !== "");
	if (first < 0 || !subtitle((rest[first] ?? "").trim())) return null;
	return rest.slice(first + 1);
}

/** The selector's selected row ("(current)" for the end row), or null when the list is not on screen. */
export function parseMessageSelector(screen: string): {selected: string} | null {
	const block = rewindBlock(screen, (line) => SELECTOR_SUBTITLE.test(line));
	if (block === null) return null;
	const footer = block.findIndex((line) => line.includes(SELECTOR_FOOTER));
	if (footer < 0) return null;
	for (const line of block.slice(0, footer)) {
		const match = SELECTED_ROW.exec(line);
		if (match !== null) return {selected: match[1] ?? ""};
	}
	return null;
}

/** The confirm step's quoted prompt and its numbered options by label, or null when it is not on screen. */
export function parseRewindConfirm(screen: string): {quote: string; options: Record<string, number>} | null {
	const block = rewindBlock(screen, (line) => line.startsWith(CONFIRM_SUBTITLE));
	if (block === null) return null;
	const quote = block
		.map((line) => QUOTE_LINE.exec(line))
		.find((match) => match !== null)?.[1]
		?.trim();
	const options: Record<string, number> = {};
	for (const line of block) {
		const match = OPTION_LINE.exec(line);
		if (match !== null) options[match[2] ?? ""] = Number(match[1]);
	}
	if (quote === undefined || Object.keys(options).length === 0) return null;
	return {quote, options};
}

/** The text in the CLI's input box (between its last two rules), "" when empty, or null when no box shows. */
export function readComposerInput(screen: string): string | null {
	const lines = screen.split("\n");
	const rules = lines.flatMap((line, index) => (RULE_LINE.test(line.trim()) ? [index] : []));
	const end = rules.at(-1);
	const start = rules.at(-2);
	if (start === undefined || end === undefined) return null;
	const input = lines
		.slice(start + 1, end)
		.map((line) => line.trim())
		.join(" ")
		.replace(/^❯\s*/, "")
		.trim();
	return PLACEHOLDER.test(input) ? "" : input;
}

// eslint-disable-next-line no-control-regex -- matches terminal escape sequences
const ESCAPE = /\u001b\[([0-9;:?]*)([A-Za-z])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]|\r/g;

/**
 * A pane screen read with its colours as plain text. With `dropDim`, text
 * drawn faint (SGR 2) is left out: the CLI draws its prompt suggestion in an
 * empty input box that way, so a dim-only input box reads as empty.
 */
export function visibleText(screen: string, {dropDim = false}: {dropDim?: boolean} = {}): string {
	let dim = false;
	let text = "";
	let last = 0;
	for (const match of screen.matchAll(ESCAPE)) {
		if (!(dropDim && dim)) text += screen.slice(last, match.index);
		last = match.index + match[0].length;
		if (match[2] !== "m") continue;
		const codes = (match[1] ?? "").split(/[;:]/);
		for (let index = 0; index < codes.length; index++) {
			const code = codes[index];
			// Extended colours carry their own numbers: 38;5;n or 38;2;r;g;b (and 48, 58).
			if (code === "38" || code === "48" || code === "58") index += codes[index + 1] === "5" ? 2 : 4;
			else if (code === "2") dim = true;
			else if (code === "" || code === "0" || code === "22") dim = false;
		}
	}
	if (!(dropDim && dim)) text += screen.slice(last);
	return text;
}

function compact(text: string): string {
	return text.replace(/\s+/g, "");
}

/** Whether a row or quote the CLI drew (perhaps cut short with "…") shows this prompt. */
function showsPrompt(drawn: string, prompt: string): boolean {
	const shown = compact(drawn);
	const full = compact(prompt);
	if (shown.endsWith("…")) {
		const prefix = shown.slice(0, -1);
		return prefix !== "" && full.startsWith(prefix);
	}
	return shown === full;
}

const HerdrRewindSchema = z.strictObject({
	sessionId: z.string().min(1),
	/** Up presses from the "(current)" row: 1 is the newest prompt. */
	stepsBack: z.number().int().min(1).max(500),
	/** The target prompt's text, checked against the selected row before Enter. */
	text: z.string().min(1),
	restore: z.enum(["conversation", "both"]).optional(),
});

export interface HerdrRewindDependencies {
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	/** Whether the session is idle with no question or permission dialog open, per the hook store. */
	ready: (sessionId: string) => boolean;
	resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
	/** The pane's visible screen with its colour escapes, so a dim prompt suggestion can be told from typed text. */
	readScreen: (sessionId: string, paneId: string) => Promise<HerdrResult<string>>;
	request: HerdrRequester;
	createRequestId: () => string;
	/** Waits between keys and screen reads so the TUI reads each key and redraws. */
	pause: () => Promise<void>;
}

const STEP_PAUSE_MS = 80;
/** Screen reads before giving up on the CLI drawing the next step (about 2 s at the step pause). */
const SCREEN_ATTEMPTS = 25;

export const defaultHerdrRewindDependencies: HerdrRewindDependencies = {
	rejectRequest: rejectCrossSite,
	writesEnabled: herdrWritesEnabled,
	ready: (sessionId) => {
		const entry = getActiveSessionEntry(sessionId);
		return (
			entry?.state === "idle" &&
			entry.pendingPermissionRequest === undefined &&
			getPendingQuestion(sessionId) === null
		);
	},
	resolveTarget: async (sessionId) => resolveHerdrPromptTarget(sessionId),
	readScreen: async (_sessionId, paneId) => readHerdrScreen(paneId, herdrRequest, "ansi"),
	request: herdrRequest,
	createRequestId: () => `ccp:rewind:${crypto.randomUUID()}`,
	pause: async () =>
		new Promise((resolve) => {
			setTimeout(resolve, STEP_PAUSE_MS);
		}),
};

const CANT_REWIND = "Can’t rewind to this message.";

function errorResponse(error: string, status: number): Response {
	return Response.json({error}, {status});
}

class RewindAborted extends Error {}

/**
 * POST: rewind the session's conversation to a prompt through the live CLI.
 * Every key follows a screen read that shows the step it expects; a screen
 * that does not match backs out with Escape and answers "Can’t rewind to
 * this message.".
 */
export async function handleHerdrRewind(
	request: Request,
	dependencies: HerdrRewindDependencies = defaultHerdrRewindDependencies,
): Promise<Response> {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;
	if (!dependencies.writesEnabled()) return errorResponse("herdr writes are disabled", 403);
	const parsed = HerdrRewindSchema.safeParse(await request.json());
	if (!parsed.success) return errorResponse("sessionId, text and a positive stepsBack are required", 400);
	const {sessionId, stepsBack, text} = parsed.data;
	const restoreLabel = RESTORE_LABELS[parsed.data.restore ?? "conversation"];

	if (!dependencies.ready(sessionId)) return errorResponse("Rewind is unavailable while Claude is working", 409);
	const target = await dependencies.resolveTarget(sessionId);
	if (!target.ok) {
		return errorResponse("Rewind is unavailable while the computer running this session is offline", 409);
	}
	const {paneId} = target.value;

	/** The screen as plain text, and its input box with any dim prompt suggestion left out. */
	const read = async (): Promise<{text: string; input: string | null}> => {
		const screen = await dependencies.readScreen(sessionId, paneId);
		if (!screen.ok) throw new RewindAborted(screen.message);
		return {text: visibleText(screen.value), input: readComposerInput(visibleText(screen.value, {dropDim: true}))};
	};
	const press = async (key: string): Promise<void> => {
		const response = await dependencies.request({
			id: dependencies.createRequestId(),
			method: "agent.send_keys",
			params: {target: paneId, keys: [key]},
		});
		if (!response.ok) throw new RewindAborted(response.message);
	};
	/** Reads until `accept` takes the screen, for at most SCREEN_ATTEMPTS reads. */
	const waitFor = async <T>(accept: (screen: {text: string; input: string | null}) => T | null): Promise<T> => {
		for (let attempt = 0; attempt < SCREEN_ATTEMPTS; attempt++) {
			if (attempt > 0) await dependencies.pause();
			const value = accept(await read());
			if (value !== null) return value;
		}
		throw new RewindAborted("the terminal did not show the expected rewind step");
	};

	if ((await read()).input !== "") {
		return errorResponse("Clear the terminal's input before rewinding", 409);
	}

	try {
		await press("esc");
		await dependencies.pause();
		await press("esc");
		const opened = await waitFor((screen) => parseMessageSelector(screen.text));
		if (opened.selected !== CURRENT_ROW) throw new RewindAborted("the selector did not open on (current)");
		for (let step = 0; step < stepsBack; step++) {
			if (step > 0 && parseMessageSelector((await read()).text) === null)
				throw new RewindAborted("the selector closed");
			await press("up");
			await dependencies.pause();
		}
		const selected = await waitFor((screen) => parseMessageSelector(screen.text));
		if (!showsPrompt(selected.selected, text)) throw new RewindAborted("the selected row is another prompt");
		await press("enter");

		const next = await waitFor(({text: screen, input}) => {
			const confirm = parseRewindConfirm(screen);
			if (confirm !== null) return {confirm};
			return input !== null && input !== "" && parseMessageSelector(screen) === null ? {confirm: null} : null;
		});
		if (next.confirm !== null) {
			const row = next.confirm.options[restoreLabel];
			if (!showsPrompt(next.confirm.quote, text) || row === undefined || row > 9) {
				throw new RewindAborted("the confirm step does not match");
			}
			await press(String(row));
		}
		await waitFor(({text: screen, input}) =>
			input !== null && parseMessageSelector(screen) === null && showsPrompt(input, text) ? true : null,
		);
		return Response.json({ok: true});
	} catch (error) {
		if (!(error instanceof RewindAborted)) throw error;
		await backOut(read, press, dependencies.pause);
		return errorResponse(CANT_REWIND, 409);
	}
}

/** Escape once, then again while the selector or its confirm step is still drawn (at most twice more). */
async function backOut(
	read: () => Promise<{text: string}>,
	press: (key: string) => Promise<void>,
	pause: () => Promise<void>,
): Promise<void> {
	try {
		await press("esc");
		for (let extra = 0; extra < 2; extra++) {
			await pause();
			const screen = (await read()).text;
			if (parseMessageSelector(screen) === null && parseRewindConfirm(screen) === null) return;
			await press("esc");
		}
	} catch (error) {
		if (!(error instanceof RewindAborted)) throw error;
	}
}
