import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import type {QuestionAnswer} from "../hook-events";
import type {LiveOptionChange} from "../launch-options";
import type {PermissionDialogDecision} from "../permission-suggestions";
import {PlanDialogSchema, type PlanDecision, type PlanDialog} from "../plan-approval";
import {apiFetch} from "./client";
import {SessionViewedStateSchema} from "./viewed-state";

/**
 * Response shape mirroring the `HerdrPaneLink` interface produced by
 * `getHerdrPanes` (`../herdr/panes`). This ccp-owned boundary is strict so
 * drift between the producer and browser consumer fails loudly.
 */
export const HerdrPaneSchema = z
	.object({
		host: z.enum(["herdr", "tmux"]),
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
		via: z.enum(["env", "agent-session", "process", "both"]),
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
	queryFn: async () => apiFetch("/api/herdr-panes", HerdrPaneIndexResponse),
});

export interface SendHerdrPromptOptions {
	/** Sent right after a skipped question: the server may type it while the turn works on. */
	midTurn?: boolean;
	fetcher?: typeof fetch;
}

export async function sendHerdrPrompt(
	sessionId: string,
	prompt: string,
	{midTurn = false, fetcher = fetch}: SendHerdrPromptOptions = {},
): Promise<void> {
	const response = await fetcher("/api/herdr/prompt", {
		method: "POST",
		credentials: "same-origin",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(midTurn ? {sessionId, prompt, midTurn} : {sessionId, prompt}),
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
	launch: {cwd?: string; prompt?: string; args?: string[]},
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
	decision: PermissionDialogDecision,
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

/**
 * Answer the CLI's MCP elicitation in the session's live herdr pane: on a
 * verdict, allow and always pick the verdict and Accept, deny takes Decline as
 * upstream does; on a url ask (`kind` "url"), allow presses Accept, which opens
 * the link on the CLI's machine, and deny presses Decline.
 */
export async function sendHerdrElicitationDecision(
	sessionId: string,
	decision: PermissionDialogDecision,
	fetcher: typeof fetch = fetch,
	kind?: "url",
): Promise<void> {
	const response = await fetcher("/api/herdr/elicitation", {
		method: "POST",
		credentials: "same-origin",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(kind === undefined ? {sessionId, decision} : {sessionId, decision, kind}),
	});
	const json: unknown = await response.json();

	if (!response.ok) {
		throw new Error(HerdrPromptErrorResponse.parse(json).error);
	}

	HerdrPromptSuccessResponse.parse(json);
}

/** Answer the session's pending AskUserQuestion by typing it into its live herdr pane; null skips a question. */
export async function sendHerdrQuestionAnswer(
	sessionId: string,
	toolUseId: string,
	answers: Array<QuestionAnswer | null>,
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const response = await fetcher("/api/herdr/question", {
		method: "POST",
		credentials: "same-origin",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({sessionId, toolUseId, answers}),
	});
	const json: unknown = await response.json();

	if (!response.ok) {
		throw new Error(HerdrPromptErrorResponse.parse(json).error);
	}

	HerdrPromptSuccessResponse.parse(json);
}

const ElicitationFocusSchema = z.discriminatedUnion("stop", [
	z.strictObject({stop: z.literal("field"), index: z.number()}),
	z.strictObject({stop: z.literal("accept")}),
	z.strictObject({stop: z.literal("decline")}),
]);

/** Mirrors `ElicitationDialog` (`../herdr/elicitation-keys`): the elicitation dialog read off a pane. */
const HerdrElicitationDialogResponse = z.strictObject({
	dialog: z.strictObject({
		kind: z.enum(["form", "url"]),
		server: z.string(),
		message: z.string(),
		focus: ElicitationFocusSchema.nullable(),
		expanded: z.boolean(),
		fieldCount: z.number(),
	}),
});
export type HerdrElicitationDialog = z.infer<typeof HerdrElicitationDialogResponse>["dialog"];

/** The session's MCP elicitation dialog as its pane shows it; rejects when the pane is not showing it. */
export async function fetchHerdrElicitationDialog(
	sessionId: string,
	fetcher: typeof fetch = fetch,
): Promise<HerdrElicitationDialog> {
	const response = await fetcher(`/api/herdr/elicitation?sessionId=${encodeURIComponent(sessionId)}`, {
		credentials: "same-origin",
	});
	const json: unknown = await response.json();
	if (!response.ok) throw new Error(HerdrPromptErrorResponse.parse(json).error);
	return HerdrElicitationDialogResponse.parse(json).dialog;
}

const HerdrPlanDialogResponse = z.strictObject({dialog: PlanDialogSchema});

/** What the session's open ExitPlanMode dialog offers; rejects when the pane is not showing it. */
export async function fetchHerdrPlanDialog(sessionId: string, fetcher: typeof fetch = fetch): Promise<PlanDialog> {
	const response = await fetcher(`/api/herdr/plan?sessionId=${encodeURIComponent(sessionId)}`, {
		credentials: "same-origin",
	});
	const json: unknown = await response.json();
	if (!response.ok) throw new Error(HerdrPromptErrorResponse.parse(json).error);
	return HerdrPlanDialogResponse.parse(json).dialog;
}

/** Answer the session's pending ExitPlanMode by typing the choice, and any feedback, into its live pane's dialog. */
export async function sendHerdrPlanDecision(
	sessionId: string,
	decision: PlanDecision,
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const response = await fetcher("/api/herdr/plan", {
		method: "POST",
		credentials: "same-origin",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({sessionId, decision}),
	});
	const json: unknown = await response.json();
	if (!response.ok) throw new Error(HerdrPromptErrorResponse.parse(json).error);
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

/** Rewind the conversation to a prompt through the live CLI's own selector; throws with the server's reason. */
export async function sendHerdrRewind(
	sessionId: string,
	target: {stepsBack: number; text: string},
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const response = await fetcher("/api/herdr/rewind", {
		method: "POST",
		credentials: "same-origin",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({sessionId, ...target}),
	});
	const json: unknown = await response.json();

	if (!response.ok) {
		throw new Error(HerdrPromptErrorResponse.parse(json).error);
	}

	HerdrPromptSuccessResponse.parse(json);
}

/** Turn the session's Remote Control bridge on or off through its live CLI; throws with the server's reason. */
export async function toggleRemoteControl(
	sessionId: string,
	on: boolean,
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const response = await fetcher("/api/herdr/remote-control", {
		method: "POST",
		credentials: "same-origin",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({sessionId, on}),
	});
	const json: unknown = await response.json();
	if (!response.ok) {
		const {error, code} = HerdrPromptErrorResponse.parse(json);
		throw new HerdrRequestError(error, response.status, code);
	}
	HerdrPromptSuccessResponse.parse(json);
}
