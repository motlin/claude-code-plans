import {z} from "zod";

import {getActiveSessionEntry, setPendingPermissionRequest} from "../active-session-store";
import {clearNotificationsForSession} from "../notifications-store";
import {outsideReadDialogKind, type PermissionDialogKind} from "../outside-read-prompt";
import {
	permissionDialogKey,
	persistentAllowKind,
	type PermissionDialogDecision,
	type PersistentAllowKind,
} from "../permission-suggestions";
import {rejectCrossSite} from "../same-origin-guard";
import {sessionAwaitingPermission} from "../session-permission-wait";
import {herdrRequest, type HerdrResult} from "./client";
import type {HerdrRequester} from "./panes";
import {
	parsePermissionDialog,
	permissionDialogShape,
	permissionDialogSteps,
	showsPermissionQuestion,
	type PermissionDialogRows,
} from "./permission-screen";
import {herdrWritesEnabled, resolveHerdrPromptTarget, type HerdrPromptTarget} from "./prompt";
import {readHerdrScreen} from "./read-screen";

const HerdrPermissionSchema = z
	.object({
		sessionId: z.string().min(1),
		decision: z.enum(["allow", "always", "deny"]),
	})
	.strict();

export interface HerdrPermissionDependencies {
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	hasPendingPermission: (sessionId: string) => boolean;
	/** The persistent option the session's PermissionRequest hook says its dialog offers. */
	persistentAllow: (sessionId: string) => PersistentAllowKind | null;
	/** Whether the pending dialog is auto mode's first outside-read prompt, whose digits mean something else. */
	dialogKind: (sessionId: string) => Promise<PermissionDialogKind>;
	clearPendingPermission: (sessionId: string) => void;
	resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
	request: HerdrRequester;
	createRequestId: () => string;
	/** The pane's visible screen as text. */
	readScreen: (sessionId: string, paneId: string) => Promise<HerdrResult<string>>;
	/** Waits between keys so the TUI reads each as its own press. */
	pause: () => Promise<void>;
}

const STEP_PAUSE_MS = 80;

function errorStatus(code: string): number {
	switch (code) {
		case "agent_not_ready":
			return 409;
		case "invalid_key":
			return 400;
		default:
			return 502;
	}
}

export const defaultHerdrPermissionDependencies: HerdrPermissionDependencies = {
	rejectRequest: rejectCrossSite,
	writesEnabled: herdrWritesEnabled,
	hasPendingPermission: (sessionId) => sessionAwaitingPermission(sessionId),
	persistentAllow: (sessionId) =>
		persistentAllowKind(getActiveSessionEntry(sessionId)?.pendingPermissionRequest?.suggestions),
	dialogKind: async (sessionId) => {
		const entry = getActiveSessionEntry(sessionId);
		return outsideReadDialogKind(entry?.pendingPermissionRequest, entry?.claudeEnv ?? {});
	},
	clearPendingPermission: (sessionId) => {
		clearNotificationsForSession(sessionId);
		setPendingPermissionRequest(sessionId, null);
	},
	resolveTarget: async (sessionId) => resolveHerdrPromptTarget(sessionId),
	request: herdrRequest,
	createRequestId: () => `ccp:permission:${crypto.randomUUID()}`,
	readScreen: async (_sessionId, paneId) => readHerdrScreen(paneId),
	pause: async () =>
		new Promise((resolve) => {
			setTimeout(resolve, STEP_PAUSE_MS);
		}),
};

const DIALOG_MISMATCH = {
	error: "The terminal\u2019s permission dialog doesn\u2019t match this card",
	code: "dialog_mismatch",
} as const;

const NOT_ACCEPTED = {
	error: "The terminal\u2019s permission dialog didn\u2019t take the answer",
	code: "not_accepted",
} as const;

const NOT_PENDING = {error: "No permission request is pending", code: "not_pending"} as const;

const NO_SESSION_GRANT = {
	error: "The terminal offers no session-only grant for this read",
	code: "dialog_mismatch",
} as const;

/** The keys for `decision`, and the screen they were planned from (none on the hook's legacy path). */
type PlannedSteps = {ok: true; steps: string[][]; dialog: {rows: PermissionDialogRows; screen: string} | null};

/**
 * The keys for `decision`, read from the dialog on screen. A screen that shows
 * no "Do you want to …?" question falls back to the hook's fixed digits; one that
 * can't be read does too, except for the persistent option, which upstream never
 * offers while the ask flags are unknown. A question whose rows don't fit the
 * card, or lack the chosen row, is refused rather than typed into.
 */
async function permissionSteps(
	sessionId: string,
	paneId: string,
	decision: PermissionDialogDecision,
	dependencies: HerdrPermissionDependencies,
): Promise<PlannedSteps | {ok: false; response: Response}> {
	const screen = await dependencies.readScreen(sessionId, paneId);
	if (!screen.ok && decision === "always") {
		return {ok: false, response: Response.json(DIALOG_MISMATCH, {status: 409})};
	}
	if (!screen.ok || !showsPermissionQuestion(screen.value)) {
		const dialogKind = await dependencies.dialogKind(sessionId);
		if (dialogKind === "outsideReadFirstPrompt" && decision === "always") {
			return {ok: false, response: Response.json(NO_SESSION_GRANT, {status: 409})};
		}
		const persistent = dialogKind === "generic" ? dependencies.persistentAllow(sessionId) : null;
		const key = permissionDialogKey(decision, persistent, dialogKind);
		return key === null
			? {
					ok: false,
					response: Response.json(
						{error: "This permission request has no persistent allow option"},
						{status: 409},
					),
				}
			: {ok: true, steps: [[key]], dialog: null};
	}
	const rows = parsePermissionDialog(screen.value);
	const steps = rows === null ? null : permissionDialogSteps(rows, decision);
	return steps === null || rows === null
		? {ok: false, response: Response.json(DIALOG_MISMATCH, {status: 409})}
		: {ok: true, steps, dialog: {rows, screen: screen.value}};
}

/** How many times the screen is re-read for the dialog to go after the last key. */
const ACCEPT_READS = 3;

/** The dialog block: from the last divider above its question to the end of the screen. */
function dialogBlock(screen: string): string {
	const lines = screen.split("\n").map((line) => line.trimEnd());
	const divider = lines.findLastIndex((line) => line.trimStart().startsWith("\u2500\u2500\u2500"));
	return lines.slice(Math.max(divider, 0)).join("\n").trim();
}

/**
 * Whether the CLI took the keys: the same dialog (its rows and the text above
 * them) is gone from the screen. A disabled Yes row ignores its digit, so the
 * dialog stays put. A screen that can't be read counts as taken, as the keys were.
 */
async function dialogTookAnswer(
	sessionId: string,
	paneId: string,
	before: string,
	dependencies: HerdrPermissionDependencies,
): Promise<boolean> {
	const block = dialogBlock(before);
	for (let read = 0; read < ACCEPT_READS; read++) {
		await dependencies.pause();
		const screen = await dependencies.readScreen(sessionId, paneId);
		if (!screen.ok || parsePermissionDialog(screen.value) === null || dialogBlock(screen.value) !== block) {
			return true;
		}
	}
	return false;
}

/** After Down on the hidden form, Enter goes only once the focus sits on Yes; the screen it read, or null. */
async function focusedOnYes(
	sessionId: string,
	paneId: string,
	dependencies: HerdrPermissionDependencies,
): Promise<string | null> {
	const screen = await dependencies.readScreen(sessionId, paneId);
	if (!screen.ok) return null;
	const dialog = parsePermissionDialog(screen.value);
	return dialog?.rows[dialog.focused]?.kind === "yes" ? screen.value : null;
}

/**
 * Answer the CLI's tool permission prompt in the session's live herdr pane.
 * Keys are only sent while the hook state or the CLI registry still shows the prompt, so a stale
 * card can never type "1" into the composer of a pane that moved on. The digits
 * come from the dialog's rows on screen; only when no permission question can be
 * read does the PermissionRequest hook's suggestion pick the persistent "2".
 */
export async function handleHerdrPermission(
	request: Request,
	dependencies: HerdrPermissionDependencies = defaultHerdrPermissionDependencies,
): Promise<Response> {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;

	if (!dependencies.writesEnabled()) {
		return Response.json({error: "herdr writes are disabled"}, {status: 403});
	}

	const parsed = HerdrPermissionSchema.safeParse(await request.json());
	if (!parsed.success) {
		return Response.json(
			{error: 'sessionId is required and decision must be "allow", "always", or "deny"'},
			{status: 400},
		);
	}
	const {sessionId, decision} = parsed.data;

	if (!dependencies.hasPendingPermission(sessionId)) {
		return Response.json(NOT_PENDING, {status: 409});
	}

	const target = await dependencies.resolveTarget(sessionId);
	if (!target.ok) {
		return Response.json({error: target.message}, {status: errorStatus(target.code)});
	}
	const {paneId} = target.value;

	const planned = await permissionSteps(sessionId, paneId, decision, dependencies);
	if (!planned.ok) return planned.response;

	let lastScreen = planned.dialog?.screen ?? null;
	for (const [index, keys] of planned.steps.entries()) {
		if (index > 0) {
			await dependencies.pause();
			if (keys[0] === "enter") {
				lastScreen = await focusedOnYes(sessionId, paneId, dependencies);
				if (lastScreen === null) return Response.json(DIALOG_MISMATCH, {status: 409});
			}
		}
		const response = await dependencies.request({
			id: dependencies.createRequestId(),
			method: "agent.send_keys",
			params: {target: paneId, keys},
		});
		if (!response.ok) {
			return Response.json({error: response.message}, {status: errorStatus(response.code)});
		}
	}

	if (lastScreen !== null && !(await dialogTookAnswer(sessionId, paneId, lastScreen, dependencies))) {
		return Response.json(NOT_ACCEPTED, {status: 409});
	}

	// A denial ends the turn with Stop (idle), which never clears the prompt.
	dependencies.clearPendingPermission(sessionId);
	return Response.json({ok: true});
}

/**
 * GET: the shape of the permission dialog on screen (deny-first, persistent row,
 * auto row), the local analogue of upstream's `can_use_tool` ask flags. Same
 * guards as the answer; 409 `dialog_not_shown` when no dialog this card answers is up.
 */
export async function handleHerdrPermissionDialog(
	request: Request,
	dependencies: HerdrPermissionDependencies = defaultHerdrPermissionDependencies,
): Promise<Response> {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;
	if (!dependencies.writesEnabled()) {
		return Response.json({error: "herdr writes are disabled"}, {status: 403});
	}
	const sessionId = new URL(request.url).searchParams.get("sessionId");
	if (sessionId === null || sessionId === "") {
		return Response.json({error: "sessionId is required"}, {status: 400});
	}
	if (!dependencies.hasPendingPermission(sessionId)) {
		return Response.json(NOT_PENDING, {status: 409});
	}
	const target = await dependencies.resolveTarget(sessionId);
	if (!target.ok) {
		return Response.json({error: target.message}, {status: errorStatus(target.code)});
	}
	const screen = await dependencies.readScreen(sessionId, target.value.paneId);
	if (!screen.ok) return Response.json({error: screen.message}, {status: 502});
	const rows = parsePermissionDialog(screen.value);
	if (rows !== null) return Response.json({dialog: permissionDialogShape(rows)});
	if (
		!showsPermissionQuestion(screen.value) &&
		(await dependencies.dialogKind(sessionId)) === "outsideReadFirstPrompt"
	) {
		// Its rows are one-time or lasting grants, never a session one, so the card offers Allow once only.
		return Response.json({dialog: {denyFirst: false, persistent: false, auto: false}});
	}
	return Response.json(
		{error: "The terminal is not showing the permission dialog", code: "dialog_not_shown"},
		{status: 409},
	);
}
