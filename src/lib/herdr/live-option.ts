import {z} from "zod";

import {LiveOptionChangeSchema, type LiveOptionChange} from "../launch-options";
import {rejectCrossSite} from "../same-origin-guard";
import {herdrRequest, type HerdrResult} from "./client";
import type {HerdrRequester} from "./panes";
import {herdrWritesEnabled, resolveHerdrPromptTarget, type HerdrPromptTarget} from "./prompt";

const HerdrLiveOptionSchema = z.strictObject({
	sessionId: z.string().min(1),
	change: LiveOptionChangeSchema,
});

export interface HerdrLiveOptionDependencies {
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
	request: HerdrRequester;
	createRequestId: () => string;
}

function errorStatus(code: string): number {
	switch (code) {
		case "agent_not_ready":
		case "agent_prompt_stalled":
			return 409;
		case "invalid_key":
		case "empty_agent_prompt":
			return 400;
		default:
			return 502;
	}
}

/** The herdr call for one chin pick: `/model` and `/effort` prompts, or shift+tab presses. */
function liveOptionCall(paneId: string, change: LiveOptionChange): {method: string; params: Record<string, unknown>} {
	switch (change.kind) {
		case "model":
			return {method: "agent.prompt", params: {target: paneId, text: `/model ${change.model}`}};
		case "effort":
			return {
				method: "agent.prompt",
				params: {target: paneId, text: `/effort ${change.effort}`},
			};
		case "mode":
			return {
				method: "agent.send_keys",
				params: {target: paneId, keys: Array.from({length: change.presses}, () => "shift+tab")},
			};
	}
}

const defaultDependencies: HerdrLiveOptionDependencies = {
	rejectRequest: rejectCrossSite,
	writesEnabled: herdrWritesEnabled,
	resolveTarget: (sessionId) => resolveHerdrPromptTarget(sessionId),
	request: herdrRequest,
	createRequestId: () => `ccp:live-option:${crypto.randomUUID()}`,
};

/** Apply a composer mode / model / effort pick to the session's live herdr pane. */
export async function handleHerdrLiveOption(
	request: Request,
	dependencies: HerdrLiveOptionDependencies = defaultDependencies,
): Promise<Response> {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;

	if (!dependencies.writesEnabled()) {
		return Response.json({error: "herdr writes are disabled"}, {status: 403});
	}

	const json: unknown = await request.json();
	const parsed = HerdrLiveOptionSchema.safeParse(json);
	if (!parsed.success) {
		return Response.json({error: "sessionId and a model, effort or mode change are required"}, {status: 400});
	}

	const target = await dependencies.resolveTarget(parsed.data.sessionId);
	if (!target.ok) {
		return Response.json({error: target.message}, {status: errorStatus(target.code)});
	}

	const response = await dependencies.request({
		id: dependencies.createRequestId(),
		...liveOptionCall(target.value.paneId, parsed.data.change),
	});
	if (!response.ok) {
		return Response.json({error: response.message}, {status: errorStatus(response.code)});
	}

	return Response.json({ok: true});
}
