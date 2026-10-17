import {getActiveSessionEntries, type ActiveSessionEntry} from "../active-session-store";
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
});

export interface HerdrPromptTarget {
	terminalId: string;
	paneId: string;
}

export interface HerdrPromptDependencies {
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
	request: HerdrRequester;
	createRequestId: () => string;
}

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

export const defaultHerdrPromptDependencies: HerdrPromptDependencies = {
	rejectRequest: rejectCrossSite,
	writesEnabled: terminalWritesEnabled,
	resolveTarget: async (sessionId) => resolveHerdrPromptTarget(sessionId),
	request: herdrRequest,
	createRequestId: () => `ccp:prompt:${crypto.randomUUID()}`,
};

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

	const target = await dependencies.resolveTarget(parsed.data.sessionId);
	if (!target.ok) return herdrFailure(target.code, target.message);

	const response = await dependencies.request({
		id: dependencies.createRequestId(),
		method: "agent.prompt",
		params: {
			target: target.value.paneId,
			text: parsed.data.prompt,
		},
	});
	if (!response.ok) return herdrFailure(response.code, response.message);

	return Response.json({ok: true});
}
