import {z} from "zod";

import type {HerdrPaneLink} from "../herdr/panes";
import {QuestionAnswerSchema, type PendingQuestionItem, type QuestionAnswer} from "../pending-calls";
import type {TerminalHost} from "../terminal-host";
import {headlessPaneId, type HeadlessRegistry} from "./registry";
import type {CanUseToolRequest} from "./protocol";
import {HeadlessRequestError, type HeadlessSession} from "./session";

/** The guards every write shares with the pane path: same-origin, and the Live terminal input setting. */
export interface HeadlessHostDependencies
{
	registry: () => HeadlessRegistry;
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	/** Forget the hook store's pending permission once the CLI has its answer. */
	clearPendingPermission: (sessionId: string) => void;
}

/** Tools whose asks have their own cards and routes, never the generic permission answer. */
const OWN_CARD_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

const DENY_MESSAGE = "The user doesn't want to proceed with this tool use. The tool use was rejected.";

const UNSUPPORTED =
{
	error: "Not available in a headless session",
	code: "headless_unsupported",
} as const;

function ok(extra: Record<string, unknown> = {}): Response
{
	return Response.json(
		{
			ok: true,
			...extra,
		},
	);
}

function fail(status: number, error: string, code?: string): Response
{
	return Response.json(
		code === undefined
			?
				{
					error,
				}
			:
				{
					error,
					code,
				},
		{
			status,
		},
	);
}

/** A request the CLI refused or never answered, or a session that ended under it. */
function failed(error: unknown): Response
{
	if (error instanceof HeadlessRequestError) return fail(409, error.message, "headless_request_failed");
	throw error;
}

/** The session id a write names: in the query for GETs, else in the JSON body (read from a clone). */
async function requestSessionId(request: Request): Promise<string | null>
{
	if (request.method === "GET") return new URL(request.url).searchParams.get("sessionId");
	try
	{
		const body: unknown = await request.clone().json();
		const parsed = z
			.looseObject(
				{
					sessionId: z.string(),
				},
			)
			.safeParse(body);
		return parsed.success ? parsed.data.sessionId : null;
	}
	catch
	{
		return null;
	}
}

type HeadlessHandler = (request: Request, session: HeadlessSession) => Promise<Response>;

const PromptSchema = z.object(
	{
		sessionId: z.string(),
		prompt: z.string(),
		midTurn: z.boolean().optional(),
	},
);

const InterruptSchema = z.object(
	{
		sessionId: z.string(),
		force: z.boolean().optional(),
	},
);

const StopTaskSchema = z.object(
	{
		sessionId: z.string(),
		kind: z.string(),
		description: z.string(),
		command: z.string().nullable(),
		id: z.string().optional(),
	},
);

const PermissionSchema = z.object(
	{
		sessionId: z.string(),
		decision: z.enum(["allow", "always", "deny", "allowAuto"]),
		presses: z.number().optional(),
	},
);

const QuestionSchema = z.object(
	{
		sessionId: z.string(),
		toolUseId: z.string().min(1),
		answers: z.array(QuestionAnswerSchema.nullable()).min(1),
	},
);

const RefusalChoiceSchema = z.object(
	{
		sessionId: z.string(),
		choice: z.enum(["retry_fallback", "edit_prompt", "cancelled"]),
	},
);

const PendingQuestionsSchema = z.array(
	z.looseObject(
		{
			question: z.string(),
			options: z.array(
				z.looseObject(
					{
						label: z.string(),
					},
				),
			),
			multiSelect: z.boolean().optional(),
		},
	),
);

function oneLine(text: string): string
{
	return text.replace(/\s+/gu, " ").trim();
}

/** The open ask the permission card answers: the CLI's oldest, as the pane shows one dialog at a time. */
function headPermission(session: HeadlessSession): CanUseToolRequest | undefined
{
	return session.pendingToolRequests().find((pending) => !OWN_CARD_TOOLS.has(pending.toolName));
}

/**
 * The AskUserQuestion answer the SDK expects: question text to the chosen
 * label (several joined with ", "), Other text as its own answer. A skipped
 * question is left out. Null when the answers do not fit the questions.
 */
function questionAnswers(
	questions: ReadonlyArray<Pick<PendingQuestionItem, "question" | "options" | "multiSelect">>,
	answers: ReadonlyArray<QuestionAnswer | null>,
): Record<string, string> | null
{
	if (answers.length !== questions.length) return null;
	const result: Record<string, string> = {};
	for (const [index, question] of questions.entries())
	{
		const answer = answers[index];
		if (answer === null || answer === undefined) continue;
		const labels: string[] = [];
		for (const selected of answer.selected)
		{
			const option = question.options[selected];
			if (option === undefined) return null;
			labels.push(option.label);
		}
		const other = oneLine(answer.other ?? "");
		if (other !== "") labels.push(other);
		if (question.multiSelect !== true && labels.length > 1) return null;
		if (labels.length > 0) result[question.question] = labels.join(", ");
	}
	return result;
}

function payloadString(payload: Record<string, unknown>, key: string): string | null
{
	const value = payload[key];
	return typeof value === "string" ? value : null;
}

/** The permission card's dialog shape, from the oldest open ask. */
function permissionDialog(session: HeadlessSession): Response
{
	const pending = headPermission(session);
	if (pending === undefined) return fail(409, "No permission request is pending", "not_pending");
	return Response.json(
		{
			dialog:
			{
				denyFirst: false,
				persistent: (pending.suggestions?.length ?? 0) > 0,
				auto: true,
			},
		},
	);
}

/** The refusal-fallback dialog as the pane path reads it, from the CLI's request payload. */
function refusalFallbackDialog(session: HeadlessSession): Response
{
	const pending = session.pendingDialogs().find((dialog) => dialog.kind === "refusal_fallback_prompt");
	if (pending === undefined)
		return Response.json(
			{
				dialog: null,
			},
		);
	const originalModel = payloadString(pending.payload, "originalModel");
	const fallbackModel = payloadString(pending.payload, "fallbackModel");
	return Response.json(
		{
			dialog:
			{
				body: `${originalModel ?? "The model"} declined this request.`,
				guidance: payloadString(pending.payload, "guidanceText"),
				category: payloadString(pending.payload, "apiRefusalCategory"),
				switchLabel: fallbackModel === null ? "Switch to the fallback model" : `Switch to ${fallbackModel}`,
				switchRow: 1,
				editLabel:
					originalModel === null ? "Edit prompt and retry" : `Edit prompt and retry with ${originalModel}`,
				editRow: 2,
				focus: "switch",
			},
		},
	);
}

const handlers =
{
	prompt: async (request: Request, session: HeadlessSession) =>
	{
		const parsed = PromptSchema.safeParse(await request.json());
		if (!parsed.success) return fail(400, "sessionId and prompt are required");
		try
		{
			session.sendPrompt(parsed.data.prompt);
		}
		catch (error)
		{
			return failed(error);
		}
		return ok();
	},
	interrupt: async (request: Request, session: HeadlessSession) =>
	{
		if (!InterruptSchema.safeParse(await request.json()).success) return fail(400, "sessionId is required");
		try
		{
			await session.interrupt();
		}
		catch (error)
		{
			return failed(error);
		}
		return ok();
	},
	stopBackgroundAgents: async (_request: Request, session: HeadlessSession) =>
	{
		try
		{
			await session.stopAllTasks();
		}
		catch (error)
		{
			return failed(error);
		}
		return ok();
	},
	stopBackgroundTask: async (request: Request, session: HeadlessSession) =>
	{
		const parsed = StopTaskSchema.safeParse(await request.json());
		if (!parsed.success) return fail(400, "sessionId, kind, description and command are required");
		const {id, description, command} = parsed.data;
		const labels = new Set([oneLine(description), ...(command === null ? [] : [oneLine(command)])]);
		const running = session.runningTasks();
		const task =
			running.find((candidate) => id !== undefined && (candidate.taskId === id || candidate.toolUseId === id)) ??
			running.find((candidate) => labels.has(oneLine(candidate.description)));
		if (task === undefined) return fail(409, "That task is not running", "task_not_running");
		try
		{
			await session.stopTask(task.taskId);
		}
		catch (error)
		{
			return failed(error);
		}
		return ok();
	},
	answerPermission: async (request: Request, session: HeadlessSession) =>
	{
		const parsed = PermissionSchema.safeParse(await request.json());
		if (!parsed.success)
			return fail(400, 'sessionId is required and decision must be "allow", "always", "deny", or "allowAuto"');
		const pending = headPermission(session);
		if (pending === undefined) return fail(409, "No permission request is pending", "not_pending");
		const {decision} = parsed.data;
		if (decision === "always" && (pending.suggestions === null || pending.suggestions.length === 0))
			return fail(409, "This permission request offers no lasting rule", "no_session_grant");
		try
		{
			if (decision === "allowAuto") await session.setPermissionMode("auto");
			session.answerToolRequest(
				pending.requestId,
				decision === "deny"
					?
						{
							behavior: "deny",
							message: DENY_MESSAGE,
						}
					: decision === "always"
						?
							{
								behavior: "allow",
								updatedInput: pending.input,
								updatedPermissions: pending.suggestions ?? [],
							}
						:
							{
								behavior: "allow",
								updatedInput: pending.input,
							},
			);
		}
		catch (error)
		{
			return failed(error);
		}
		return decision === "allowAuto"
			? ok(
					{
						via: "row",
					},
				)
			: ok();
	},
	readPermissionDialog: async (_request: Request, session: HeadlessSession) =>
		Promise.resolve(permissionDialog(session)),
	answerQuestion: async (request: Request, session: HeadlessSession) =>
	{
		const parsed = QuestionSchema.safeParse(await request.json());
		if (!parsed.success) return fail(400, "sessionId, toolUseId and answers are required");
		const asks = session.pendingToolRequests().filter((pending) => pending.toolName === "AskUserQuestion");
		const pending =
			asks.find((candidate) => candidate.toolUseId === parsed.data.toolUseId) ??
			(asks.length === 1 && asks[0]?.toolUseId === null ? asks[0] : undefined);
		if (pending === undefined) return fail(409, "That question is no longer pending");
		const questions = PendingQuestionsSchema.safeParse(pending.input["questions"]);
		const answers = questions.success ? questionAnswers(questions.data, parsed.data.answers) : null;
		if (answers === null) return fail(400, "The answers do not fit the pending question");
		try
		{
			session.answerToolRequest(
				pending.requestId,
				Object.keys(answers).length === 0
					?
						{
							behavior: "deny",
							message: "The user skipped the question.",
						}
					:
						{
							behavior: "allow",
							updatedInput:
							{
								...pending.input,
								answers,
							},
						},
			);
		}
		catch (error)
		{
			return failed(error);
		}
		return ok();
	},
	readRefusalFallbackDialog: async (_request: Request, session: HeadlessSession) =>
		Promise.resolve(refusalFallbackDialog(session)),
	answerRefusalFallback: async (request: Request, session: HeadlessSession) =>
	{
		const parsed = RefusalChoiceSchema.safeParse(await request.json());
		if (!parsed.success)
			return fail(
				400,
				'sessionId is required and choice must be "retry_fallback", "edit_prompt", or "cancelled"',
			);
		const pending = session.pendingDialogs().find((dialog) => dialog.kind === "refusal_fallback_prompt");
		if (pending === undefined) return fail(409, "The refusal dialog is no longer pending", "not_pending");
		const {choice} = parsed.data;
		try
		{
			session.answerDialog(
				pending.requestId,
				choice === "cancelled"
					?
						{
							behavior: "cancelled",
						}
					:
						{
							behavior: "completed",
							result: choice,
						},
			);
		}
		catch (error)
		{
			return failed(error);
		}
		// Edit hands the refused prompt back to the browser composer, as the pane path does.
		return ok(
			{
				text: choice === "edit_prompt" ? session.lastPrompt : null,
			},
		);
	},
} satisfies Partial<Record<keyof TerminalHost, HeadlessHandler>>;

async function unsupported(): Promise<Response>
{
	return Promise.resolve(fail(409, UNSUPPORTED.error, UNSUPPORTED.code));
}

/** A headless session as a pane link, so every pane-gated control lights up for it. */
function headlessPaneLink(session: HeadlessSession): HerdrPaneLink
{
	const paneId = headlessPaneId(session.sessionId);
	return {
		host: "headless",
		paneId,
		terminalId: paneId,
		workspaceId: "headless",
		tabId: paneId,
		focused: false,
		cwd: session.cwd,
		foregroundCwd: session.cwd,
		agentStatus: session.status === "starting" ? "working" : session.status,
		agent: "claude",
		terminalTitle: null,
		agentSessionId: session.sessionId,
		revision: 0,
		sessionId: session.sessionId,
		via: "env",
	};
}

/**
 * The terminal host with app-owned headless sessions layered on: their pane
 * links join the host's, and every write naming a headless session goes over
 * its control protocol instead of keystrokes. Writes for any other session,
 * and everything else, fall through to the host.
 */
export function withHeadlessSessions(host: TerminalHost, dependencies: HeadlessHostDependencies): TerminalHost
{
	const route =
		(handler: HeadlessHandler, fallback: (request: Request) => Promise<Response>) =>
		async (request: Request): Promise<Response> =>
		{
			const sessionId = await requestSessionId(request);
			const session = sessionId === null ? undefined : dependencies.registry().get(sessionId);
			if (session === undefined) return fallback(request);
			const rejection = dependencies.rejectRequest(request);
			if (rejection !== null) return rejection;
			if (!dependencies.writesEnabled()) return fail(403, "Live terminal input is off");
			const response = await handler(request, session);
			if (handler === handlers.answerPermission && response.ok)
				dependencies.clearPendingPermission(session.sessionId);
			return response;
		};
	const refuse = (fallback: (request: Request) => Promise<Response>) => route(unsupported, fallback);
	/** A rejection for a headless session, which has no terminal to stream; null for any other session. */
	const refusedStream = (sessionId: string): Promise<never> | null =>
		dependencies.registry().get(sessionId) === undefined
			? null
			: Promise.reject(new Error("A headless session has no terminal to stream"));
	return {
		...host,
		canWrite: host.canWrite || dependencies.registry().list().length > 0,
		listPanes: async () => [...(await host.listPanes()), ...dependencies.registry().list().map(headlessPaneLink)],
		prompt: route(handlers.prompt, host.prompt),
		interrupt: route(handlers.interrupt, host.interrupt),
		stopBackgroundAgents: route(handlers.stopBackgroundAgents, host.stopBackgroundAgents),
		stopBackgroundTask: route(handlers.stopBackgroundTask, host.stopBackgroundTask),
		answerQuestion: route(handlers.answerQuestion, host.answerQuestion),
		answerPermission: route(handlers.answerPermission, host.answerPermission),
		readPermissionDialog: route(handlers.readPermissionDialog, host.readPermissionDialog),
		readRefusalFallbackDialog: route(handlers.readRefusalFallbackDialog, host.readRefusalFallbackDialog),
		answerRefusalFallback: route(handlers.answerRefusalFallback, host.answerRefusalFallback),
		readPlanDialog: refuse(host.readPlanDialog),
		answerPlan: refuse(host.answerPlan),
		readElicitationDialog: refuse(host.readElicitationDialog),
		answerElicitation: refuse(host.answerElicitation),
		rewind: refuse(host.rewind),
		toggleRemoteControl: refuse(host.toggleRemoteControl),
		applyLiveOption: refuse(host.applyLiveOption),
		observe: async (sessionId, columns, rows, socket) =>
			await (refusedStream(sessionId) ?? host.observe(sessionId, columns, rows, socket)),
		control: async (sessionId, columns, rows, socket) =>
			await (refusedStream(sessionId) ?? host.control(sessionId, columns, rows, socket)),
	};
}
