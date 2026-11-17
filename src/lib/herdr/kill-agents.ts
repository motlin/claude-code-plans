import {z} from "zod";

import {rejectCrossSite} from "../same-origin-guard";
import {herdrRequest, type HerdrResult} from "./client";
import type {HerdrRequester} from "./panes";
import {showsAnyDialog} from "./permission-screen";
import {herdrWritesEnabled, resolveHerdrPromptTarget, type HerdrPromptTarget} from "./prompt";
import {readHerdrScreen} from "./read-screen";
import {readComposerInput, visibleText} from "./rewind";

/**
 * The CLI's `chat:killAgents` chord (default ctrl+x ctrl+k). The first press raises its
 * `kill-agents-confirm` notification; a second within 3 s stops every background agent.
 */
const CHORD = ["ctrl+x", "ctrl+k"];
/** The confirm notification, as its text ("Press … again to stop background agents") or footer `row1Hint`. */
const CONFIRM = /again to stop (?:background )?agents/;
/** The CLI's `kill-agents-none` notification. */
const NONE = "No background agents running";

const STEP_PAUSE_MS = 80;
/** Screen reads while waiting for the confirm notification (about 1 s, well inside the CLI's 3 s window). */
const CONFIRM_ATTEMPTS = 12;

const HerdrKillAgentsSchema = z.strictObject(
	{
		sessionId: z.string().min(1),
	},
);

export interface HerdrKillAgentsDependencies
{
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
	readScreen: (sessionId: string, paneId: string) => Promise<HerdrResult<string>>;
	request: HerdrRequester;
	createRequestId: () => string;
	/** Waits between the chord and each screen read so the TUI reads the keys and redraws. */
	pause: () => Promise<void>;
}

export const defaultHerdrKillAgentsDependencies: HerdrKillAgentsDependencies =
{
	rejectRequest: rejectCrossSite,
	writesEnabled: herdrWritesEnabled,
	resolveTarget: async (sessionId) => resolveHerdrPromptTarget(sessionId),
	readScreen: async (_sessionId, paneId) => readHerdrScreen(paneId, herdrRequest, "ansi"),
	request: herdrRequest,
	createRequestId: () => `ccp:kill-agents:${crypto.randomUUID()}`,
	pause: async () =>
		new Promise((resolve) =>
		{
			setTimeout(resolve, STEP_PAUSE_MS);
		}),
};

function errorStatus(code: string): number
{
	switch (code)
	{
		case "agent_not_ready":
			return 409;
		case "invalid_key":
			return 400;
		default:
			return 502;
	}
}

function errorResponse(error: string, status: number): Response
{
	return Response.json(
		{
			error,
		},
		{
			status,
		},
	);
}

/**
 * POST: stop the session's background agents with the CLI's own kill-agents chord, pressed twice.
 * The screen is checked first, and nothing is pressed unless the CLI shows its prompt with no dialog
 * up. The second press waits until the CLI asks to confirm, so a chord that never reached it, or a
 * session with nothing to stop, never gets one.
 */
export async function handleHerdrKillAgents(
	request: Request,
	dependencies: HerdrKillAgentsDependencies = defaultHerdrKillAgentsDependencies,
): Promise<Response>
{
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;
	if (!dependencies.writesEnabled()) return errorResponse("herdr writes are disabled", 403);
	const parsed = HerdrKillAgentsSchema.safeParse(await request.json());
	if (!parsed.success) return errorResponse("sessionId is required", 400);
	const {sessionId} = parsed.data;

	const target = await dependencies.resolveTarget(sessionId);
	if (!target.ok) return errorResponse(target.message, errorStatus(target.code));
	const {paneId} = target.value;
	const read = async (): Promise<HerdrResult<string>> =>
	{
		const screen = await dependencies.readScreen(sessionId, paneId);
		return screen.ok
			?
				{
					ok: true,
					value: visibleText(screen.value),
				}
			: screen;
	};
	const press = async (): Promise<HerdrResult<unknown>> =>
		dependencies.request(
			{
				id: dependencies.createRequestId(),
				method: "agent.send_keys",
				params:
				{
					target: paneId,
					keys: CHORD,
				},
			},
		);

	const first = await read();
	if (!first.ok) return errorResponse(first.message, 502);
	if (readComposerInput(first.value) === null || showsAnyDialog(first.value))
		return errorResponse("The terminal is not showing its prompt", 409);
	const armed = CONFIRM.test(first.value);

	const pressed = await press();
	if (!pressed.ok) return errorResponse(pressed.message, errorStatus(pressed.code));
	if (!armed)
	{
		let confirmed = false;
		for (let attempt = 0; attempt < CONFIRM_ATTEMPTS && !confirmed; attempt++)
		{
			await dependencies.pause();
			const screen = await read();
			if (!screen.ok) continue;
			if (CONFIRM.test(screen.value)) confirmed = true;
			else if (screen.value.includes(NONE)) return errorResponse("No background agents are running", 409);
		}
		if (!confirmed) return errorResponse("The terminal did not ask to confirm stopping background agents", 409);
		const again = await press();
		if (!again.ok) return errorResponse(again.message, errorStatus(again.code));
	}
	return Response.json(
		{
			ok: true,
		},
	);
}
