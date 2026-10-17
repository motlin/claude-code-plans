import {z} from "zod";

import {getActiveSessionEntry} from "../active-session-store";
import {PlanDecisionSchema, type PlanDecision, type PlanDialog, type PlanForwardMode} from "../plan-approval";
import {rejectCrossSite} from "../same-origin-guard";
import {herdrRequest, type HerdrResult} from "./client";
import type {HerdrRequester} from "./panes";
import {defaultHerdrPermissionDependencies} from "./permission";
import {herdrWritesEnabled, resolveHerdrPromptTarget, type HerdrPromptTarget} from "./prompt";
import type {QuestionAnswerStep} from "./question";
import {asRecord} from "../narrow";

/** The question line the CLI's plan approval dialog asks above its numbered rows. */
const DIALOG_QUESTION = "Would you like to proceed?";
/** The dialog's last row: an inline feedback field that shows this label while empty. */
const FEEDBACK_ROW = "Tell Claude what to change";
const FEEDBACK_HINT = "shift+tab to approve with this feedback";
const MANUAL_ROW = "Yes, manually approve edits";
/** The keep-context rows that carry on in a forward mode (CLI 2.1.302's wording). */
const FORWARD_ROWS: Readonly<Record<string, PlanForwardMode>> = {
	"Yes, and use auto mode": "auto",
	"Yes, auto-accept edits": "acceptEdits",
	"Yes, and auto-accept edits": "acceptEdits",
	"Yes, and bypass permissions": "bypassPermissions",
};
const OPTION_LINE = /^\s*(?:❯\s*)?(\d+)\.\s+(.*\S)\s*$/;

/** The dialog's row numbers for each choice ccp can type; null rows are not on offer. */
export interface PlanDialogRows {
	forward: {mode: PlanForwardMode; row: number} | null;
	manual: number | null;
	feedback: number;
}

/**
 * Read the CLI's plan approval dialog off a pane's visible screen: the last
 * "Would you like to proceed?" and the numbered rows under it. Null unless the
 * rows run 1…n (n ≤ 9, one digit each) and end on the empty feedback field, so
 * a different dialog, or one the user already typed feedback into, is refused.
 */
export function parsePlanDialog(screen: string): PlanDialogRows | null {
	const lines = screen.split("\n");
	const start = lines.findLastIndex((line) => line.includes(DIALOG_QUESTION));
	if (start < 0) return null;
	const labels: string[] = [];
	for (const line of lines.slice(start + 1)) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed === FEEDBACK_HINT) continue;
		const match = OPTION_LINE.exec(line);
		if (match === null) break;
		if (Number(match[1]) !== labels.length + 1) return null;
		labels.push(match[2] ?? "");
	}
	if (labels.length === 0 || labels.length > 9 || labels.at(-1) !== FEEDBACK_ROW) return null;
	const forwardIndex = labels.findIndex((label) => FORWARD_ROWS[label] !== undefined);
	const forwardMode = forwardIndex < 0 ? undefined : FORWARD_ROWS[labels[forwardIndex] ?? ""];
	const manualIndex = labels.indexOf(MANUAL_ROW);
	return {
		forward: forwardMode === undefined ? null : {mode: forwardMode, row: forwardIndex + 1},
		manual: manualIndex < 0 ? null : manualIndex + 1,
		feedback: labels.length,
	};
}

/** What the card may offer for the dialog on screen. */
function planDialogShape(rows: PlanDialogRows): PlanDialog {
	return {forwardMode: rows.forward?.mode ?? null, manual: rows.manual !== null};
}

/**
 * The keys that answer the plan dialog. A row's digit picks it at once; the
 * feedback row's digit only focuses its field, so feedback is typed there (on
 * one line, since a typed newline would submit) and Enter sends it, or sends
 * an empty field as a plain rejection. Null when the dialog lacks the choice.
 */
export function planDecisionSteps(rows: PlanDialogRows, decision: PlanDecision): QuestionAnswerStep[] | null {
	if (decision.kind === "accept") {
		const row =
			decision.mode === "default" ? rows.manual : rows.forward?.mode === decision.mode ? rows.forward.row : null;
		return row === null ? null : [{key: String(row)}];
	}
	const feedback = decision.feedback.replace(/\s+/g, " ").trim();
	const focus = {key: String(rows.feedback)};
	return feedback === "" ? [focus, {key: "enter"}] : [focus, {text: feedback}, {key: "enter"}];
}

const HerdrPlanSchema = z.strictObject({
	sessionId: z.string().min(1),
	decision: PlanDecisionSchema,
});

export interface HerdrPlanDependencies {
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	/** Whether the session's PermissionRequest hook says the ExitPlanMode dialog is open. */
	hasPendingPlan: (sessionId: string) => boolean;
	clearPendingPlan: (sessionId: string) => void;
	resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
	/** The pane's visible screen as text. */
	readScreen: (sessionId: string, paneId: string) => Promise<HerdrResult<string>>;
	request: HerdrRequester;
	createRequestId: () => string;
	/** Waits between steps so the TUI reads each key as its own press. */
	pause: () => Promise<void>;
}

const STEP_PAUSE_MS = 80;

/** herdr's `pane.read` of the visible screen. */
async function readHerdrScreen(paneId: string, request: HerdrRequester = herdrRequest): Promise<HerdrResult<string>> {
	const response = await request({
		id: `ccp:plan-read:${crypto.randomUUID()}`,
		method: "pane.read",
		params: {pane_id: paneId, source: "visible"},
	});
	if (!response.ok) return response;
	const text = asRecord(asRecord(response.value)?.["read"])?.["text"];
	return typeof text === "string"
		? {ok: true, value: text}
		: {ok: false, code: "bad-response", message: "herdr returned no pane text"};
}

export const defaultHerdrPlanDependencies: HerdrPlanDependencies = {
	rejectRequest: rejectCrossSite,
	writesEnabled: herdrWritesEnabled,
	hasPendingPlan: (sessionId) =>
		getActiveSessionEntry(sessionId)?.pendingPermissionRequest?.toolName === "ExitPlanMode",
	clearPendingPlan: defaultHerdrPermissionDependencies.clearPendingPermission,
	resolveTarget: async (sessionId) => resolveHerdrPromptTarget(sessionId),
	readScreen: async (_sessionId, paneId) => readHerdrScreen(paneId),
	request: herdrRequest,
	createRequestId: () => `ccp:plan:${crypto.randomUUID()}`,
	pause: async () =>
		new Promise((resolve) => {
			setTimeout(resolve, STEP_PAUSE_MS);
		}),
};

function errorResponse(error: string, status: number): Response {
	return Response.json({error}, {status});
}

const NOT_PENDING = "No plan approval is pending";
const NOT_SHOWN = "The terminal is not showing the plan approval dialog";

/**
 * The guards both plan endpoints share: same-origin, Live terminal input on,
 * the hook-reported ExitPlanMode still pending, and a freshly resolved pane
 * whose screen shows the plan dialog.
 */
async function readPlanDialog(
	request: Request,
	sessionId: string | null,
	dependencies: HerdrPlanDependencies,
): Promise<{ok: true; paneId: string; rows: PlanDialogRows} | {ok: false; response: Response}> {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return {ok: false, response: rejection};
	if (!dependencies.writesEnabled()) return {ok: false, response: errorResponse("herdr writes are disabled", 403)};
	if (sessionId === null) {
		return {ok: false, response: errorResponse("sessionId and a plan decision are required", 400)};
	}
	if (!dependencies.hasPendingPlan(sessionId)) return {ok: false, response: errorResponse(NOT_PENDING, 409)};
	const target = await dependencies.resolveTarget(sessionId);
	if (!target.ok) return {ok: false, response: errorResponse(target.message, 502)};
	const screen = await dependencies.readScreen(sessionId, target.value.paneId);
	if (!screen.ok) return {ok: false, response: errorResponse(screen.message, 502)};
	const rows = parsePlanDialog(screen.value);
	if (rows === null) return {ok: false, response: errorResponse(NOT_SHOWN, 409)};
	return {ok: true, paneId: target.value.paneId, rows};
}

/** GET: what the session's open plan dialog offers, so the card shows only choices it can type. */
export async function handleHerdrPlanDialog(
	request: Request,
	dependencies: HerdrPlanDependencies = defaultHerdrPlanDependencies,
): Promise<Response> {
	const sessionId = new URL(request.url).searchParams.get("sessionId");
	const dialog = await readPlanDialog(request, sessionId === "" ? null : sessionId, dependencies);
	if (!dialog.ok) return dialog.response;
	return Response.json({dialog: planDialogShape(dialog.rows)});
}

function stepCall(paneId: string, step: QuestionAnswerStep): {method: string; params: Record<string, unknown>} {
	return "key" in step
		? {method: "agent.send_keys", params: {target: paneId, keys: [step.key]}}
		: {method: "pane.send_text", params: {pane_id: paneId, text: step.text}};
}

/**
 * POST: answer the CLI's ExitPlanMode dialog in the session's live pane. The
 * keys come from the dialog read off the screen just before typing, so a stale
 * card, a moved pane or a dialog of another shape gets a refusal, not keys.
 */
export async function handleHerdrPlan(
	request: Request,
	dependencies: HerdrPlanDependencies = defaultHerdrPlanDependencies,
): Promise<Response> {
	const parsed = HerdrPlanSchema.safeParse(await request.json());
	const dialog = await readPlanDialog(request, parsed.success ? parsed.data.sessionId : null, dependencies);
	if (!dialog.ok) return dialog.response;
	if (!parsed.success) return errorResponse("sessionId and a plan decision are required", 400);

	const steps = planDecisionSteps(dialog.rows, parsed.data.decision);
	if (steps === null) return errorResponse("The plan approval dialog does not offer that choice", 409);

	for (const [index, step] of steps.entries()) {
		if (index > 0) await dependencies.pause();
		const response = await dependencies.request({
			id: dependencies.createRequestId(),
			...stepCall(dialog.paneId, step),
		});
		if (!response.ok) {
			return errorResponse(response.message, response.code === "agent_not_ready" ? 409 : 502);
		}
	}
	// A rejection ends the turn with Stop (idle), which never clears the prompt.
	dependencies.clearPendingPlan(parsed.data.sessionId);
	return Response.json({ok: true});
}
