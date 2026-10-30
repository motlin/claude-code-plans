import {z} from "zod";

import {getActiveSessionEntry} from "../active-session-store";
import {getPendingQuestion} from "../pending-question-store";
import {rejectCrossSite} from "../same-origin-guard";
import {registryRemoteControl} from "../session-environment";
import {getRegistrySessionState} from "../session-registry-store";
import type {RemoteControlState} from "../session-state";
import {herdrRequest, type HerdrResult} from "./client";
import type {HerdrRequester} from "./panes";
import {readHerdrScreen} from "./plan";
import {herdrWritesEnabled, resolveHerdrPromptTarget, type HerdrPromptTarget} from "./prompt";
import {readComposerInput, visibleText} from "./rewind";

/**
 * The rail's Remote Control switch, as upstream's no-IPC fallback: it types
 * `/remote-control` into the session. Read off CLI 2.1.314: unbridged, the
 * command connects at once; bridged, it opens a "Remote Control" dialog
 * (Disconnect this session / Show QR code / Continue, opening on Continue,
 * "Enter to select · Esc to continue"), so turning it off walks the selection
 * up to Disconnect, re-reading the screen before every key.
 */

const COMMAND = "/remote-control";
const DIALOG_TITLE = "Remote Control";
const DIALOG_FOOTER = "Enter to select";
const DISCONNECT = "Disconnect this session";
const ROW = /^\s*(❯\s+)?(\S.*\S|\S)\s*$/;

/** The open Remote Control dialog: its selected row, and the arrow presses (negative is up) to Disconnect. */
export interface RemoteControlDialog {
	selected: string;
	movesToDisconnect: number;
}

/** The Remote Control dialog drawn on screen, or null when it is not. */
export function parseRemoteControlDialog(screen: string): RemoteControlDialog | null {
	const lines = screen.split("\n");
	const start = lines.findLastIndex((line) => line.trim() === DIALOG_TITLE);
	if (start < 0) return null;
	const block = lines.slice(start + 1);
	const footer = block.findIndex((line) => line.includes(DIALOG_FOOTER));
	if (footer < 0) return null;
	const rows = block.slice(0, footer).map((line) => ROW.exec(line));
	const selectedIndex = rows.findIndex((match) => match?.[1] !== undefined);
	const disconnectIndex = rows.findIndex((match) => match?.[2] === DISCONNECT);
	if (selectedIndex < 0 || disconnectIndex < 0) return null;
	return {selected: rows[selectedIndex]?.[2] ?? "", movesToDisconnect: disconnectIndex - selectedIndex};
}

const HerdrRemoteControlSchema = z.strictObject({
	sessionId: z.string().min(1),
	/** The state the switch asks for. */
	on: z.boolean(),
});

export interface HerdrRemoteControlDependencies {
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	/** Whether the session is idle with no question or permission dialog open, per the hook store. */
	ready: (sessionId: string) => boolean;
	/** The live CLI's bridge state from its registry entry, null without one. */
	currentState: (sessionId: string) => RemoteControlState | null;
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

export const defaultHerdrRemoteControlDependencies: HerdrRemoteControlDependencies = {
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
	currentState: (sessionId) => registryRemoteControl(getRegistrySessionState(sessionId))?.state ?? null,
	resolveTarget: async (sessionId) => resolveHerdrPromptTarget(sessionId),
	readScreen: async (_sessionId, paneId) => readHerdrScreen(paneId, herdrRequest, "ansi"),
	request: herdrRequest,
	createRequestId: () => `ccp:remote-control:${crypto.randomUUID()}`,
	pause: async () =>
		new Promise((resolve) => {
			setTimeout(resolve, STEP_PAUSE_MS);
		}),
};

const CANT_TOGGLE = "Couldn’t toggle Remote Control. Try again.";

function errorResponse(error: string, status: number): Response {
	return Response.json({error}, {status});
}

function promptFailureStatus(code: string): number {
	return code === "agent_not_ready" || code === "agent_prompt_stalled" ? 409 : 502;
}

class ToggleAborted extends Error {}

/**
 * POST `{sessionId, on}`: turn the session's Remote Control bridge on or off
 * through its live CLI. Nothing is typed when the bridge is already in that
 * state, while Claude works, or while the input holds a draft; a dialog that
 * does not match backs out with Escape.
 */
export async function handleHerdrRemoteControl(
	request: Request,
	dependencies: HerdrRemoteControlDependencies = defaultHerdrRemoteControlDependencies,
): Promise<Response> {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;
	if (!dependencies.writesEnabled()) return errorResponse("herdr writes are disabled", 403);
	const parsed = HerdrRemoteControlSchema.safeParse(await request.json());
	if (!parsed.success) return errorResponse("sessionId and on are required", 400);
	const {sessionId, on} = parsed.data;

	const current = dependencies.currentState(sessionId);
	if (current === null) return errorResponse("Remote Control isn’t available for this session.", 409);
	if ((current === "on") === on) return Response.json({ok: true});
	if (!dependencies.ready(sessionId)) {
		return errorResponse("Remote Control can’t be changed while Claude is working", 409);
	}
	const target = await dependencies.resolveTarget(sessionId);
	if (!target.ok) return Response.json({error: target.message, code: target.code}, {status: 502});
	const {paneId} = target.value;

	const read = async (): Promise<{text: string; input: string | null}> => {
		const screen = await dependencies.readScreen(sessionId, paneId);
		if (!screen.ok) throw new ToggleAborted(screen.message);
		return {text: visibleText(screen.value), input: readComposerInput(visibleText(screen.value, {dropDim: true}))};
	};
	const press = async (key: string): Promise<void> => {
		const response = await dependencies.request({
			id: dependencies.createRequestId(),
			method: "agent.send_keys",
			params: {target: paneId, keys: [key]},
		});
		if (!response.ok) throw new ToggleAborted(response.message);
	};
	const waitFor = async <T>(accept: (screen: string) => T | null): Promise<T> => {
		for (let attempt = 0; attempt < SCREEN_ATTEMPTS; attempt++) {
			if (attempt > 0) await dependencies.pause();
			const value = accept((await read()).text);
			if (value !== null) return value;
		}
		throw new ToggleAborted("the terminal did not show the expected Remote Control step");
	};

	try {
		if ((await read()).input !== "") {
			return errorResponse("Clear the terminal’s input before changing Remote Control", 409);
		}
	} catch (error) {
		if (!(error instanceof ToggleAborted)) throw error;
		return errorResponse(CANT_TOGGLE, 409);
	}

	const prompted = await dependencies.request({
		id: dependencies.createRequestId(),
		method: "agent.prompt",
		params: {target: paneId, text: COMMAND},
	});
	if (!prompted.ok) {
		return Response.json(
			{error: prompted.message, code: prompted.code},
			{status: promptFailureStatus(prompted.code)},
		);
	}
	if (on) return Response.json({ok: true});

	let dialogOpened = false;
	try {
		let dialog = await waitFor(parseRemoteControlDialog);
		dialogOpened = true;
		// One arrow per screen read, so a selection that does not move is caught before Enter.
		for (let step = 0; step < 10 && dialog.movesToDisconnect !== 0; step++) {
			await press(dialog.movesToDisconnect < 0 ? "up" : "down");
			await dependencies.pause();
			dialog = await waitFor(parseRemoteControlDialog);
		}
		if (dialog.selected !== DISCONNECT) throw new ToggleAborted("the selection did not reach Disconnect");
		await press("enter");
		await waitFor((screen) => (parseRemoteControlDialog(screen) === null ? true : null));
	} catch (error) {
		if (!(error instanceof ToggleAborted)) throw error;
		if (dialogOpened) await backOut(read, press, dependencies.pause);
		return errorResponse(CANT_TOGGLE, 409);
	}
	return Response.json({ok: true});
}

/** Escape ("Esc to continue", which keeps the bridge), again while the dialog is still drawn (at most twice more). */
async function backOut(
	read: () => Promise<{text: string}>,
	press: (key: string) => Promise<void>,
	pause: () => Promise<void>,
): Promise<void> {
	try {
		await press("esc");
		for (let extra = 0; extra < 2; extra++) {
			await pause();
			if (parseRemoteControlDialog((await read()).text) === null) return;
			await press("esc");
		}
	} catch (error) {
		if (!(error instanceof ToggleAborted)) throw error;
	}
}
