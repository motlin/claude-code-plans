import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import type {LiveOptionChange} from "../launch-options";
import {apiFetch} from "./client";
import {SessionViewedStateSchema} from "./viewed-state";

/**
 * Response shape mirroring the `HerdrPaneLink` interface produced by
 * `getHerdrPanes` (`../herdr/panes`). This ccp-owned boundary is strict so
 * drift between the producer and browser consumer fails loudly.
 */
export const HerdrPaneSchema = z
	.object({
		paneId: z.string(),
		terminalId: z.string(),
		workspaceId: z.string(),
		tabId: z.string(),
		focused: z.boolean(),
		cwd: z.string().nullable(),
		foregroundCwd: z.string().nullable(),
		agentStatus: z.string(),
		agent: z.string().nullable(),
		terminalTitle: z.string().nullable(),
		agentSessionId: z.string().nullable(),
		revision: z.number(),
		sessionId: z.string(),
		via: z.enum(["env", "agent-session", "both"]),
		viewedState: SessionViewedStateSchema,
	})
	.strict();

const HerdrPaneListResponse = z.array(HerdrPaneSchema);

export const HerdrPaneIndexResponse = z
	.object({
		panes: HerdrPaneListResponse,
		writesEnabled: z.boolean(),
	})
	.strict();

export type HerdrPaneIndexData = z.infer<typeof HerdrPaneIndexResponse>;

const HerdrPromptSuccessResponse = z.object({ok: z.literal(true)}).strict();
const HerdrPromptErrorResponse = z.object({error: z.string(), code: z.string().optional()}).strict();

/** A rejected herdr write, with the HTTP status and herdr's error code when it sent one. */
export class HerdrRequestError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string | undefined,
	) {
		super(message);
		this.name = "HerdrRequestError";
	}
}

/** herdr refused the prompt because the agent is still working: queue it instead. */
export function isAgentNotReady(error: unknown): boolean {
	return error instanceof HerdrRequestError && error.status === 409 && error.code === "agent_not_ready";
}

export const herdrPanesQueryOptions = queryOptions({
	queryKey: ["herdr", "panes"] as const,
	queryFn: () => apiFetch("/api/herdr-panes", HerdrPaneIndexResponse),
});

export async function sendHerdrPrompt(sessionId: string, prompt: string, fetcher: typeof fetch = fetch): Promise<void> {
	const response = await fetcher("/api/herdr/prompt", {
		method: "POST",
		credentials: "same-origin",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({sessionId, prompt}),
	});
	const json: unknown = await response.json();

	if (!response.ok) {
		const {error, code} = HerdrPromptErrorResponse.parse(json);
		throw new HerdrRequestError(error, response.status, code);
	}

	HerdrPromptSuccessResponse.parse(json);
}

const HerdrLaunchSuccessResponse = z
	.object({
		ok: z.literal(true),
		tabId: z.string(),
		paneId: z.string(),
		sessionId: z.string().nullable(),
	})
	.strict();

export type HerdrLaunchResponse = z.infer<typeof HerdrLaunchSuccessResponse>;

/** Start `claude` (with `prompt` and/or `args`) in a new herdr tab rooted at `cwd`; throws when herdr cannot. */
export async function launchHerdrSession(
	launch: {cwd: string; prompt?: string; args?: string[]},
	fetcher: typeof fetch = fetch,
): Promise<HerdrLaunchResponse> {
	const response = await fetcher("/api/herdr/launch", {
		method: "POST",
		credentials: "same-origin",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(launch),
	});
	const json: unknown = await response.json();

	if (!response.ok) {
		throw new Error(HerdrPromptErrorResponse.parse(json).error);
	}

	return HerdrLaunchSuccessResponse.parse(json);
}

/** Answer the CLI's pending tool permission prompt in the session's live herdr pane. */
export async function sendHerdrPermissionDecision(
	sessionId: string,
	decision: "allow" | "deny",
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const response = await fetcher("/api/herdr/permission", {
		method: "POST",
		credentials: "same-origin",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({sessionId, decision}),
	});
	const json: unknown = await response.json();

	if (!response.ok) {
		throw new Error(HerdrPromptErrorResponse.parse(json).error);
	}

	HerdrPromptSuccessResponse.parse(json);
}

/** Interrupt the session's live herdr pane: Esc, or ctrl+c when `force`. */
export async function sendHerdrInterrupt(
	sessionId: string,
	force: boolean,
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const response = await fetcher("/api/herdr/interrupt", {
		method: "POST",
		credentials: "same-origin",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({sessionId, force}),
	});
	const json: unknown = await response.json();

	if (!response.ok) {
		throw new Error(HerdrPromptErrorResponse.parse(json).error);
	}

	HerdrPromptSuccessResponse.parse(json);
}

/** Apply a chin mode / model / effort pick to the session's live herdr pane. */
export async function sendHerdrLiveOption(
	sessionId: string,
	change: LiveOptionChange,
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const response = await fetcher("/api/herdr/live-option", {
		method: "POST",
		credentials: "same-origin",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({sessionId, change}),
	});
	const json: unknown = await response.json();

	if (!response.ok) {
		throw new Error(HerdrPromptErrorResponse.parse(json).error);
	}

	HerdrPromptSuccessResponse.parse(json);
}
