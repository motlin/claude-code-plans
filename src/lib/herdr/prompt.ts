import {getActiveSessionEntries, getActiveSessionEntry, type ActiveSessionEntry} from "../active-session-store";
import type {PendingQuestion} from "../hook-events";
import {getPendingQuestion} from "../pending-question-store";
import {rejectCrossSite} from "../same-origin-guard";
import {herdrRequest, type HerdrResult} from "./client";
import {herdrPaneTable, type HerdrPaneReader} from "./pane-table";
import {readHerdrPaneState, type HerdrRequester} from "./panes";
import {qualifiedEntryHerdrPane} from "./servers";
import {z} from "zod";
import {terminalWritesEnabled} from "../config";

export {terminalWritesEnabled as herdrWritesEnabled} from "../config";

const HerdrPromptSchema = z.object({
	sessionId: z.string(),
	prompt: z.string(),
	/** Sent right after a skipped question: may type while the turn works on, as long as no dialog is open. */
	midTurn: z.boolean().optional(),
});

export interface HerdrPromptTarget {
	terminalId: string;
	paneId: string;
}

/** How a mid-turn prompt types into a working pane, whose own prompt call refuses anything but idle. */
export interface HerdrMidTurnDependencies {
	/** Whether the session works with no question or permission dialog open, per the hook store. */
	ready: (sessionId: string) => boolean;
	resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
	request: HerdrRequester;
	createRequestId: () => string;
	/** Waits before Enter so the TUI does not read it as part of the typed text. */
	pause: () => Promise<void>;
}

export interface HerdrPromptDependencies {
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
	request: HerdrRequester;
	createRequestId: () => string;
	midTurn: HerdrMidTurnDependencies;
}

/**
 * The narrow exception to typing only into an idle composer: the CLI accepts
 * typed input mid-turn and queues it itself, so a prompt may go in while the
 * hook says working, but never while a question or permission dialog is open
 * (keys would answer it) or while the state is anything else.
 */
export function midTurnPromptReady(
	entry: Pick<ActiveSessionEntry, "state" | "pendingPermissionRequest"> | null | undefined,
	pendingQuestion: PendingQuestion | null,
): boolean {
	return entry?.state === "working" && entry.pendingPermissionRequest === undefined && pendingQuestion === null;
}

const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";

function failure(code: string, message: string): HerdrResult<never> {
	return {ok: false, code, message};
}

/**
 * Resolve the session to its terminal's current pane on every write so moved panes cannot leave a stale target.
 * The event-maintained pane table is that current state; herdr is asked directly only while the table is not tracking.
 */
export async function resolveHerdrPromptTarget(
	sessionId: string,
	entries: ActiveSessionEntry[] = getActiveSessionEntries(),
	request: HerdrRequester = herdrRequest,
	table: HerdrPaneReader = herdrPaneTable,
): Promise<HerdrResult<HerdrPromptTarget>> {
	const state = await readHerdrPaneState(request, table);
	if (!state.ok) return state;

	const {panes} = state.value;
	const capturedEntry = entries.find((entry) => entry.sessionId === sessionId);
	const capturedPaneId = capturedEntry === undefined ? "" : qualifiedEntryHerdrPane(capturedEntry);
	const sessionPane =
		panes.find((pane) => pane.agent_session?.value === sessionId) ??
		panes.find((pane) => capturedPaneId !== "" && pane.pane_id === capturedPaneId);
	if (!sessionPane) {
		return failure("session-not-found", "session is not attached to a live herdr terminal");
	}

	const terminalId = sessionPane.terminal_id;
	const currentPane = panes.find((pane) => pane.terminal_id === terminalId);
	if (!currentPane) {
		return failure("pane-not-found", "herdr terminal has no current pane");
	}

	return {
		ok: true,
		value: {
			terminalId,
			paneId: currentPane.pane_id,
		},
	};
}

function errorStatus(code: string): number {
	switch (code) {
		case "agent_not_ready":
		case "agent_prompt_stalled":
			return 409;
		case "empty_agent_prompt":
			return 400;
		default:
			return 502;
	}
}

/** herdr's code rides along so the composer can queue an `agent_not_ready` prompt. */
function herdrFailure(code: string, message: string): Response {
	return Response.json({error: message, code}, {status: errorStatus(code)});
}

const MID_TURN_ENTER_PAUSE_MS = 80;

export const defaultHerdrPromptDependencies: HerdrPromptDependencies = {
	rejectRequest: rejectCrossSite,
	writesEnabled: terminalWritesEnabled,
	resolveTarget: async (sessionId) => resolveHerdrPromptTarget(sessionId),
	request: herdrRequest,
	createRequestId: () => `ccp:prompt:${crypto.randomUUID()}`,
	midTurn: {
		ready: (sessionId) => midTurnPromptReady(getActiveSessionEntry(sessionId), getPendingQuestion(sessionId)),
		resolveTarget: async (sessionId) => resolveHerdrPromptTarget(sessionId),
		request: herdrRequest,
		createRequestId: () => `ccp:prompt:${crypto.randomUUID()}`,
		pause: async () =>
			new Promise((resolve) => {
				setTimeout(resolve, MID_TURN_ENTER_PAUSE_MS);
			}),
	},
};

const MID_TURN_NOT_READY = failure("agent_not_ready", "The session opened a dialog or stopped working");

/**
 * Type the prompt as text, then Enter, into the pane re-resolved just now,
 * re-checking before every keystroke that no dialog opened in the meantime.
 */
async function typeMidTurnPrompt(
	sessionId: string,
	prompt: string,
	midTurn: HerdrMidTurnDependencies,
): Promise<HerdrResult<null>> {
	const target = await midTurn.resolveTarget(sessionId);
	if (!target.ok) return target;
	if (!midTurn.ready(sessionId)) return MID_TURN_NOT_READY;
	const {paneId} = target.value;
	const text = prompt.includes("\n") ? `${BRACKETED_PASTE_START}${prompt}${BRACKETED_PASTE_END}` : prompt;
	const typed = await midTurn.request({
		id: midTurn.createRequestId(),
		method: "pane.send_text",
		params: {pane_id: paneId, text},
	});
	if (!typed.ok) return typed;
	await midTurn.pause();
	if (!midTurn.ready(sessionId)) return MID_TURN_NOT_READY;
	const entered = await midTurn.request({
		id: midTurn.createRequestId(),
		method: "agent.send_keys",
		params: {target: paneId, keys: ["enter"]},
	});
	return entered.ok ? {ok: true, value: null} : entered;
}

export async function handleHerdrPrompt(
	request: Request,
	dependencies: HerdrPromptDependencies = defaultHerdrPromptDependencies,
): Promise<Response> {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;

	if (!dependencies.writesEnabled()) {
		return Response.json({error: "herdr writes are disabled"}, {status: 403});
	}

	const json: unknown = await request.json();
	const parsed = HerdrPromptSchema.safeParse(json);
	if (!parsed.success) {
		return Response.json({error: "sessionId and prompt are required"}, {status: 400});
	}

	const {sessionId, prompt, midTurn} = parsed.data;
	if (midTurn === true && prompt.trim() !== "" && dependencies.midTurn.ready(sessionId)) {
		const typed = await typeMidTurnPrompt(sessionId, prompt, dependencies.midTurn);
		return typed.ok ? Response.json({ok: true}) : herdrFailure(typed.code, typed.message);
	}

	const target = await dependencies.resolveTarget(sessionId);
	if (!target.ok) return herdrFailure(target.code, target.message);

	const response = await dependencies.request({
		id: dependencies.createRequestId(),
		method: "agent.prompt",
		params: {
			target: target.value.paneId,
			text: prompt,
		},
	});
	if (!response.ok) return herdrFailure(response.code, response.message);

	return Response.json({ok: true});
}
