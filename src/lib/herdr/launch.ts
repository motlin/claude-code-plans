import {homedir} from "node:os";
import {z} from "zod";
import {validateClaudeLaunchArgs} from "../claude-launch-command";
import {herdrWritesEnabled} from "../config";
import {rejectCrossSite} from "../same-origin-guard";
import {herdrRequest, type HerdrResult} from "./client";
import type {HerdrRequester} from "./panes";
import {HerdrAgentStartedResultSchema, HerdrTabCreatedResultSchema} from "./schema";

const AGENT_START_TIMEOUT_MS = 30_000;
const AGENT_START_REQUEST_TIMEOUT_MS = AGENT_START_TIMEOUT_MS + 5_000;
// agent.start can return before herdr registers the named agent, so agent.prompt briefly reports agent_not_ready.
const PROMPT_ATTEMPTS = 20;
const PROMPT_RETRY_DELAY_MS = 250;

const HerdrLaunchRequestSchema = z
	.object({
		/** Absent for launches tied to no project, which start in the home directory. */
		cwd: z.string().startsWith("/").optional(),
		prompt: z
			.string()
			.refine((prompt) => prompt.trim() !== "")
			.optional(),
		args: z
			.array(z.string())
			.superRefine((args, context) => {
				const error = validateClaudeLaunchArgs(args);
				if (error !== null) context.addIssue({code: "custom", message: error});
			})
			.optional(),
	})
	.strict();

type HerdrLaunchRequest = z.infer<typeof HerdrLaunchRequestSchema>;

interface HerdrLaunchResult {
	tabId: string;
	paneId: string;
	sessionId: string | null;
}

export interface HerdrLaunchDependencies {
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	request: HerdrRequester;
	/** Lowercase alphanumeric id shared by the request ids and the herdr agent name. */
	createLaunchId: () => string;
	wait: (ms: number) => Promise<void>;
	homeDir: () => string;
}

const defaultDependencies: HerdrLaunchDependencies = {
	rejectRequest: rejectCrossSite,
	writesEnabled: herdrWritesEnabled,
	request: herdrRequest,
	createLaunchId: () => crypto.randomUUID().replaceAll("-", "").slice(0, 12),
	wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	homeDir: homedir,
};

function failure(code: string, message: string): HerdrResult<never> {
	return {ok: false, code, message};
}

/**
 * Start `claude` in a new herdr tab. Arguments travel as an argv array so no
 * shell ever interprets them; the prompt goes through `agent.prompt` because
 * herdr refuses to encode multi-line argv for the target shell.
 */
async function launchClaudeInHerdr(
	{cwd, prompt, args = []}: HerdrLaunchRequest & {cwd: string},
	{request, createLaunchId, wait}: Pick<HerdrLaunchDependencies, "request" | "createLaunchId" | "wait">,
): Promise<HerdrResult<HerdrLaunchResult>> {
	const launchId = createLaunchId();
	const requestId = (method: string) => `ccp:launch:${launchId}:${method}`;

	const tabResponse = await request({
		id: requestId("tab.create"),
		method: "tab.create",
		params: {cwd, focus: false},
	});
	if (!tabResponse.ok) return tabResponse;
	const tab = HerdrTabCreatedResultSchema.safeParse(tabResponse.value);
	if (!tab.success) return failure("bad-response", "herdr returned an invalid tab.create result");
	const tabId = tab.data.tab.tab_id;

	const startResponse = await request(
		{
			id: requestId("agent.start"),
			method: "agent.start",
			params: {
				name: `ccp-${launchId}`,
				kind: "claude",
				pane_id: tab.data.root_pane.pane_id,
				args,
				timeout_ms: AGENT_START_TIMEOUT_MS,
			},
		},
		AGENT_START_REQUEST_TIMEOUT_MS,
	);
	const started = startResponse.ok ? HerdrAgentStartedResultSchema.safeParse(startResponse.value) : undefined;
	if (!started?.success) {
		await request({id: requestId("tab.close"), method: "tab.close", params: {tab_id: tabId}});
		return startResponse.ok
			? failure("bad-response", "herdr returned an invalid agent.start result")
			: startResponse;
	}

	const {agent} = started.data;
	if (prompt !== undefined) {
		const promptRequest = {
			id: requestId("agent.prompt"),
			method: "agent.prompt",
			params: {target: agent.pane_id, text: prompt},
		};
		let promptResponse = await request(promptRequest);
		for (
			let attempt = 1;
			attempt < PROMPT_ATTEMPTS && !promptResponse.ok && promptResponse.code === "agent_not_ready";
			attempt++
		) {
			await wait(PROMPT_RETRY_DELAY_MS);
			promptResponse = await request(promptRequest);
		}
		if (!promptResponse.ok) return promptResponse;
	}

	return {
		ok: true,
		value: {
			tabId,
			paneId: agent.pane_id,
			sessionId: agent.agent_session?.value ?? null,
		},
	};
}

function errorStatus(code: string): number {
	switch (code) {
		case "agent_not_ready":
		case "agent_prompt_stalled":
			return 409;
		case "invalid_agent_argument":
		case "empty_agent_prompt":
			return 400;
		default:
			return 502;
	}
}

export async function handleHerdrLaunch(
	request: Request,
	dependencies: HerdrLaunchDependencies = defaultDependencies,
): Promise<Response> {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;

	if (!dependencies.writesEnabled()) {
		return Response.json({error: "herdr writes are disabled"}, {status: 403});
	}

	const json: unknown = await request.json();
	const parsed = HerdrLaunchRequestSchema.safeParse(json);
	if (!parsed.success) {
		return Response.json({error: z.prettifyError(parsed.error)}, {status: 400});
	}

	const result = await launchClaudeInHerdr(
		{...parsed.data, cwd: parsed.data.cwd ?? dependencies.homeDir()},
		dependencies,
	);
	if (!result.ok) {
		return Response.json({error: result.message}, {status: errorStatus(result.code)});
	}

	return Response.json({ok: true, ...result.value});
}
