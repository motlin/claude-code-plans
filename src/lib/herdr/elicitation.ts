import {z} from "zod";

import type {PendingElicitation} from "../domain-event-payload-schemas";
import {getPendingElicitations} from "../pending-elicitations";
import {rejectCrossSite} from "../same-origin-guard";
import {herdrRequest, type HerdrResult} from "./client";
import {
	elicitationSteps,
	parseElicitationDialog,
	type ElicitationDialog,
	type ElicitationStep,
} from "./elicitation-keys";
import type {HerdrRequester} from "./panes";
import {readHerdrScreen} from "./plan";
import {herdrWritesEnabled, resolveHerdrPromptTarget, type HerdrPromptTarget} from "./prompt";

const HerdrElicitationSchema = z.strictObject({
	sessionId: z.string().min(1),
	decision: z.enum(["allow", "always", "deny", "cancel"]),
	/** The card's elicitation kind; the answer is refused when the pending elicitation is another kind. */
	kind: z.enum(["form", "url"]).optional(),
});

export interface HerdrElicitationDependencies {
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	/** The elicitation the CLI shows now: the session's oldest pending one, from the `Elicitation` hook. */
	pendingElicitation: (sessionId: string) => PendingElicitation | null;
	resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
	/** The pane's visible screen as text. */
	readScreen: (sessionId: string, paneId: string) => Promise<HerdrResult<string>>;
	request: HerdrRequester;
	createRequestId: () => string;
	pause: (ms: number) => Promise<void>;
}

/** The gap between keys that carry no pause of their own, so the TUI reads each as its own press. */
const STEP_PAUSE_MS = 80;

export const defaultHerdrElicitationDependencies: HerdrElicitationDependencies = {
	rejectRequest: rejectCrossSite,
	writesEnabled: herdrWritesEnabled,
	pendingElicitation: (sessionId) => getPendingElicitations(sessionId)[0] ?? null,
	resolveTarget: async (sessionId) => resolveHerdrPromptTarget(sessionId),
	readScreen: async (_sessionId, paneId) => readHerdrScreen(paneId),
	request: herdrRequest,
	createRequestId: () => `ccp:elicitation:${crypto.randomUUID()}`,
	pause: async (ms) =>
		new Promise((resolve) => {
			setTimeout(resolve, ms);
		}),
};

function errorResponse(error: string, status: number): Response {
	return Response.json({error}, {status});
}

const BAD_REQUEST = "sessionId and an elicitation decision are required";
const NOT_SHOWN = "The terminal is not showing this elicitation";
const NO_STEPS = "The elicitation dialog can't be answered that way from where it stands";

function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Whether the dialog on screen is the stored elicitation: same kind, server and (unwrapped) message. */
function showsElicitation(dialog: ElicitationDialog, pending: PendingElicitation): boolean {
	return (
		dialog.kind === pending.mode &&
		dialog.server === pending.serverName &&
		collapseWhitespace(dialog.message) === collapseWhitespace(pending.message)
	);
}

/** The dialog on a screen when it shows the stored elicitation, else null. */
function shownDialog(screen: string, pending: PendingElicitation): ElicitationDialog | null {
	const dialog = parseElicitationDialog(screen);
	return dialog !== null && showsElicitation(dialog, pending) ? dialog : null;
}

function stepCall(
	paneId: string,
	step: {key: string} | {text: string},
): {method: string; params: Record<string, unknown>} {
	return "key" in step
		? {method: "agent.send_keys", params: {target: paneId, keys: [step.key]}}
		: {method: "pane.send_text", params: {pane_id: paneId, text: step.text}};
}

type DialogRead = {ok: true; paneId: string; dialog: ElicitationDialog} | {ok: false; response: Response};

/** Read the pane's dialog, refusing unless it shows the pending elicitation. */
async function readPendingDialog(
	sessionId: string,
	pending: PendingElicitation,
	paneId: string,
	dependencies: HerdrElicitationDependencies,
): Promise<DialogRead> {
	const screen = await dependencies.readScreen(sessionId, paneId);
	if (!screen.ok) return {ok: false, response: errorResponse(screen.message, 502)};
	const dialog = shownDialog(screen.value, pending);
	if (dialog === null) return {ok: false, response: errorResponse(NOT_SHOWN, 409)};
	return {ok: true, paneId, dialog};
}

/** The pending elicitation's pane, after the guards both endpoints share. */
async function resolvePending(
	sessionId: string,
	dependencies: HerdrElicitationDependencies,
): Promise<{ok: true; pending: PendingElicitation; paneId: string} | {ok: false; response: Response}> {
	const pending = dependencies.pendingElicitation(sessionId);
	if (pending === null) return {ok: false, response: errorResponse("No elicitation is pending", 409)};
	const target = await dependencies.resolveTarget(sessionId);
	if (!target.ok) return {ok: false, response: errorResponse(target.message, 502)};
	return {ok: true, pending, paneId: target.value.paneId};
}

function rejectEarly(request: Request, dependencies: HerdrElicitationDependencies): Response | null {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;
	if (!dependencies.writesEnabled()) return errorResponse("herdr writes are disabled", 403);
	return null;
}

/**
 * GET: the session's elicitation dialog as the pane shows it, so a card offers
 * only what the dialog can do from where it stands (a URL the CLI won't open
 * starts on Decline).
 */
export async function handleHerdrElicitationDialog(
	request: Request,
	dependencies: HerdrElicitationDependencies = defaultHerdrElicitationDependencies,
): Promise<Response> {
	const rejection = rejectEarly(request, dependencies);
	if (rejection) return rejection;
	const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
	if (sessionId === "") return errorResponse("sessionId is required", 400);
	const resolved = await resolvePending(sessionId, dependencies);
	if (!resolved.ok) return resolved.response;
	const read = await readPendingDialog(sessionId, resolved.pending, resolved.paneId, dependencies);
	if (!read.ok) return read.response;
	return Response.json({dialog: read.dialog});
}

/**
 * POST: answer the CLI's MCP elicitation dialog in the session's live pane.
 * The dialog is read off the screen and matched to the session's pending
 * elicitation before any key, and read again before a final Enter that
 * follows other keys, since the CLI silently refuses an Enter that lands too
 * soon or on the wrong stop. The pending entry is left for the
 * `ElicitationResult` hook to clear.
 */
export async function handleHerdrElicitation(
	request: Request,
	dependencies: HerdrElicitationDependencies = defaultHerdrElicitationDependencies,
): Promise<Response> {
	const rejection = rejectEarly(request, dependencies);
	if (rejection) return rejection;
	const parsed = HerdrElicitationSchema.safeParse(await request.json());
	if (!parsed.success) return errorResponse(BAD_REQUEST, 400);
	const {sessionId, decision, kind} = parsed.data;

	const resolved = await resolvePending(sessionId, dependencies);
	if (!resolved.ok) return resolved.response;
	const {pending, paneId} = resolved;
	if (kind !== undefined && pending.mode !== kind) return errorResponse(`No ${kind} elicitation is pending`, 409);

	const first = await readPendingDialog(sessionId, pending, paneId, dependencies);
	if (!first.ok) return first.response;
	const steps = elicitationSteps(pending.requestedSchema, decision, first.dialog);
	if (steps === null) return errorResponse(NO_STEPS, 409);

	const expected = decision === "deny" ? "decline" : "accept";
	let previous: ElicitationStep | null = null;
	for (const [index, step] of steps.entries()) {
		if ("pause" in step) {
			await dependencies.pause(step.pause);
			previous = step;
			continue;
		}
		if (previous !== null && !("pause" in previous)) await dependencies.pause(STEP_PAUSE_MS);
		previous = step;
		const guardedEnter = index > 0 && index === steps.length - 1 && "key" in step && step.key === "enter";
		if (guardedEnter) {
			const again = await dependencies.readScreen(sessionId, paneId);
			if (!again.ok) return errorResponse(again.message, 502);
			if (shownDialog(again.value, pending)?.focus?.stop !== expected) {
				const stop = expected === "accept" ? "Accept" : "Decline";
				return errorResponse(`The terminal dialog did not reach ${stop}; nothing more was sent`, 409);
			}
		}
		const response = await dependencies.request({id: dependencies.createRequestId(), ...stepCall(paneId, step)});
		if (!response.ok) return errorResponse(response.message, response.code === "agent_not_ready" ? 409 : 502);
	}
	return Response.json({ok: true});
}
