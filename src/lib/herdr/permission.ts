import {z} from "zod";

import {getActiveSessionEntry, setPendingPermissionRequest} from "../active-session-store";
import {clearNotificationsForSession} from "../notifications-store";
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
import {parsePermissionDialog, permissionDialogSteps, showsPermissionQuestion} from "./permission-screen";
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

/**
 * The keys for `decision`, read from the dialog on screen. A screen that can't
 * be read, or shows no "Do you want to …?" question, falls back to the hook's
 * fixed digits; a question whose rows don't fit the card, or lack the chosen
 * row, is refused rather than typed into.
 */
async function permissionSteps(
	sessionId: string,
	paneId: string,
	decision: PermissionDialogDecision,
	dependencies: HerdrPermissionDependencies,
): Promise<{ok: true; steps: string[][]} | {ok: false; response: Response}> {
	const screen = await dependencies.readScreen(sessionId, paneId);
	if (!screen.ok || !showsPermissionQuestion(screen.value)) {
		const key = permissionDialogKey(decision, dependencies.persistentAllow(sessionId));
		return key === null
			? {
					ok: false,
					response: Response.json(
						{error: "This permission request has no persistent allow option"},
						{status: 409},
					),
				}
			: {ok: true, steps: [[key]]};
	}
	const dialog = parsePermissionDialog(screen.value);
	const steps = dialog === null ? null : permissionDialogSteps(dialog, decision);
	return steps === null ? {ok: false, response: Response.json(DIALOG_MISMATCH, {status: 409})} : {ok: true, steps};
}

/** After Down on the hidden form, Enter goes only once the focus sits on Yes. */
async function focusedOnYes(
	sessionId: string,
	paneId: string,
	dependencies: HerdrPermissionDependencies,
): Promise<boolean> {
	const screen = await dependencies.readScreen(sessionId, paneId);
	if (!screen.ok) return false;
	const dialog = parsePermissionDialog(screen.value);
	return dialog?.rows[dialog.focused]?.kind === "yes";
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
		return Response.json({error: "No permission request is pending", code: "not_pending"}, {status: 409});
	}

	const target = await dependencies.resolveTarget(sessionId);
	if (!target.ok) {
		return Response.json({error: target.message}, {status: errorStatus(target.code)});
	}
	const {paneId} = target.value;

	const planned = await permissionSteps(sessionId, paneId, decision, dependencies);
	if (!planned.ok) return planned.response;

	for (const [index, keys] of planned.steps.entries()) {
		if (index > 0) {
			await dependencies.pause();
			if (keys[0] === "enter" && !(await focusedOnYes(sessionId, paneId, dependencies))) {
				return Response.json(DIALOG_MISMATCH, {status: 409});
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

	// A denial ends the turn with Stop (idle), which never clears the prompt.
	dependencies.clearPendingPermission(sessionId);
	return Response.json({ok: true});
}
