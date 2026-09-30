import {z} from "zod";

import {clearNotificationsForSession, getNotifications} from "../notifications-store";
import {PERMISSION_DECISION_KEYS, PERMISSION_PROMPT_NOTIFICATION} from "../permission-card";
import {rejectCrossSite} from "../same-origin-guard";
import {herdrRequest, type HerdrResult} from "./client";
import type {HerdrRequester} from "./panes";
import {herdrWritesEnabled, resolveHerdrPromptTarget, type HerdrPromptTarget} from "./prompt";

const HerdrPermissionSchema = z
	.object({
		sessionId: z.string().min(1),
		decision: z.enum(["allow", "deny"]),
	})
	.strict();

export interface HerdrPermissionDependencies {
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	hasPendingPermission: (sessionId: string) => boolean;
	clearPendingPermission: (sessionId: string) => void;
	resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
	request: HerdrRequester;
	createRequestId: () => string;
}

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

const defaultDependencies: HerdrPermissionDependencies = {
	rejectRequest: rejectCrossSite,
	writesEnabled: herdrWritesEnabled,
	hasPendingPermission: (sessionId) =>
		getNotifications().some(
			(entry) => entry.sessionId === sessionId && entry.notificationType === PERMISSION_PROMPT_NOTIFICATION,
		),
	clearPendingPermission: clearNotificationsForSession,
	resolveTarget: (sessionId) => resolveHerdrPromptTarget(sessionId),
	request: herdrRequest,
	createRequestId: () => `ccp:permission:${crypto.randomUUID()}`,
};

/**
 * Answer the CLI's tool permission prompt in the session's live herdr pane.
 * Keys are only sent while the hook state still shows the prompt, so a stale
 * card can never type "1" into the composer of a pane that moved on.
 */
export async function handleHerdrPermission(
	request: Request,
	dependencies: HerdrPermissionDependencies = defaultDependencies,
): Promise<Response> {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;

	if (!dependencies.writesEnabled()) {
		return Response.json({error: "herdr writes are disabled"}, {status: 403});
	}

	const parsed = HerdrPermissionSchema.safeParse(await request.json());
	if (!parsed.success) {
		return Response.json({error: 'sessionId is required and decision must be "allow" or "deny"'}, {status: 400});
	}
	const {sessionId, decision} = parsed.data;

	if (!dependencies.hasPendingPermission(sessionId)) {
		return Response.json({error: "No permission request is pending"}, {status: 409});
	}

	const target = await dependencies.resolveTarget(sessionId);
	if (!target.ok) {
		return Response.json({error: target.message}, {status: errorStatus(target.code)});
	}

	const response = await dependencies.request({
		id: dependencies.createRequestId(),
		method: "agent.send_keys",
		params: {target: target.value.paneId, keys: [PERMISSION_DECISION_KEYS[decision]]},
	});
	if (!response.ok) {
		return Response.json({error: response.message}, {status: errorStatus(response.code)});
	}

	// A denial ends the turn with Stop (idle), which never clears the prompt.
	dependencies.clearPendingPermission(sessionId);
	return Response.json({ok: true});
}
