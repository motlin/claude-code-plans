/**
 * Shared transcript processing library.
 *
 * Processes raw JSONL records into rendering data. Works identically in
 * Node (for indexing) and browser (for rendering) -- no Node-specific imports.
 *
 * Core function: processTranscript(records) returns ProcessedTranscript.
 * Incremental function: processNewRecords(records, startIndex) for SSE appends.
 */

import {z} from "zod";
import type {ToolResultInfo} from "./sessions";
import type {TranscriptCut} from "./api/sessions";
import {toolResultMetaFrom} from "./tool-labels";
import {formatModelName} from "./model-name";
import {isRecord} from "./narrow";
import {UsageLimitSchema} from "./usage-limit-notice";
import {normalizeArtifactUrl, parseArtifactOutput} from "./artifact-output";
import {ArtifactToolResultSchema} from "./artifact-schemas";
import {parseAgentMessage} from "./agent-message";
import {
	CompactMetadataSchema,
	ContentBlockSchema,
	JsonValueSchema,
	type JsonlRecord,
	PromptSourceSchema,
	RenderedRoleSchema,
	TurnOriginSchema,
	WakeupSourceSchema,
} from "./schemas";
import {autoModeDenial} from "./auto-mode-denial";
import {stripAnsi} from "./ansi-codes";
import {recapText} from "./recap-text";
import {isInterruptedToolResult} from "./tool-interruption";
import {capDetails, parseHookMessage} from "./hook-prompt-block";
import {JsonlRecordSchema} from "./runtime-schemas";
import {
	extractSessionTitle,
	extractToolResultContent,
	extractToolResultImages,
	stripCommandTags,
	stripResultTags,
	truncateResult,
} from "./session-utils";

// ---------------------------------------------------------------------------
// Rendered line schemas -- Zod definitions for processed JSONL output.
// Types are inferred via z.infer<> instead of manually declared interfaces.
// ---------------------------------------------------------------------------

const MessageLineSchema = z.object({
	type: z.enum(["user", "assistant"]),
	uuid: z.string().optional(),
	parentUuid: z.string().optional(),
	timestamp: z.string().optional(),
	userType: z.string().optional(),
	isMeta: z.boolean().optional(),
	isCompactSummary: z.boolean().optional(),
	isVisibleInTranscriptOnly: z.boolean().optional(),
	message: z
		.object({
			role: z.string().optional(),
			content: z.union([z.string(), z.array(ContentBlockSchema)]).optional(),
			input_transformations: z
				.array(
					z.object({
						type: z.string(),
						path: z.string().optional(),
						reason: z.string().optional(),
					}),
				)
				.optional(),
			safeguard_results: z
				.array(
					z.object({
						type: z.string(),
						status: z
							.object({
								type: z.string(),
								tool_uses: z
									.record(z.string(), z.object({type: z.string(), outcome: z.string().optional()}))
									.optional(),
							})
							.optional(),
					}),
				)
				.optional(),
		})
		.optional(),
	customTitle: z.string().optional(),
	sessionId: z.string().optional(),
	lineIndex: z.number(),
	/** tool_use ids whose input failed its tool's schema; those calls render raw. */
	invalidToolInputIds: z.array(z.string()).optional(),
	promptSource: PromptSourceSchema.optional(),
	turnOrigin: TurnOriginSchema.optional(),
	scheduledTaskId: z.string().optional(),
	wakeupSource: WakeupSourceSchema.optional(),
	queuePriority: z.literal("later").optional(),
	/** The `queueOrigin.displayName` of an Artifact watch whose end this task-notification announces. */
	artifactWatchEnded: z.string().optional(),
	isApiErrorMessage: z.boolean().optional(),
	/** The `api-request` this line's run of records came from; only the run's first line carries it. */
	requestRef: z.string().optional(),
	apiErrorStatus: z.union([z.number(), z.string()]).optional(),
	/** An API error or refusal line's `requestId`, for the error card's details. */
	requestId: z.string().optional(),
	/** An API error line's `message.id` (a refusal's withheld message id), for the error card's Message ID line. */
	messageId: z.string().optional(),
	/** An API error line's string `error` code, e.g. `server_error`, for classifying it. */
	apiErrorCode: z.string().optional(),
	/** The rate-limit window of a synthetic usage-limit message. */
	usageLimit: UsageLimitSchema.optional(),
	errorDetails: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
	/** `max_tokens` (truncated) or `refusal` (Claude's safeguards stopped the response). */
	stopReason: z.enum(["max_tokens", "refusal"]).optional(),
	usage: z.record(z.string(), JsonValueSchema).optional(),
	attributionSkill: z.string().optional(),
	attributionPlugin: z.string().optional(),
	attributionMcpServer: z.string().optional(),
	attributionMcpTool: z.string().optional(),
	perTurnEffort: z.string().optional(),
	advisorModel: z.string().optional(),
	/** The model the turn asked for and the one that answered, kept only when they differ. */
	modelMismatch: z.object({requested: z.string(), actual: z.string()}).optional(),
	/** Whole milliseconds the model spent thinking on this assistant turn. */
	thinkingDurationMs: z.number().optional(),
	/** The CLI withheld this turn's thinking text (`thinkingDisplay: "omitted"`), leaving empty thinking blocks. */
	thinkingOmitted: z.literal(true).optional(),
	/** A user line drawn from a prompt typed while the turn ran and absorbed into it, which can't be rewound to. */
	absorbedPrompt: z.literal(true).optional(),
	/** The key upstream gives this user row when it differs from `uuid` (an absorbed prompt's CLI command uuid). */
	turnKey: z.string().optional(),
	/** What the server-side permission classifier saw for this user turn. */
	classifierContext: z
		.object({
			liveCwd: z.string().optional(),
			branch: z.string().optional(),
			platform: z.string().optional(),
		})
		.optional(),
});

const AgentNameLineSchema = z.object({
	type: z.literal("agent-name"),
	agentName: z.string(),
	lineIndex: z.number(),
});

const AgentColorLineSchema = z.object({
	type: z.literal("agent-color"),
	agentColor: z.string(),
	lineIndex: z.number(),
});

const PermissionModeLineSchema = z.object({
	type: z.literal("permission-mode"),
	permissionMode: z.string(),
	lineIndex: z.number(),
});

/** An artifact the session published, from a `frame-link` record that names one. */
const ArtifactLinkLineSchema = z.object({
	type: z.literal("artifact-link"),
	frameUrl: z.string(),
	title: z.string().optional(),
	path: z.string().optional(),
	timestamp: z.string().optional(),
	lineIndex: z.number(),
});

/**
 * The artifacts the session watches for comments, from the latest
 * `artifact-comment-monitor` record, with thread counts from the latest
 * `artifact-autoreact-ledger`.
 */
const ArtifactWatchLineSchema = z.object({
	type: z.literal("artifact-watch"),
	artifacts: z.array(
		z.object({
			url: z.string(),
			title: z.string().optional(),
			state: z.string().optional(),
			commentThreads: z.number().optional(),
		}),
	),
	lineIndex: z.number(),
});

const AttachmentLineSchema = z.object({
	type: z.literal("attachment"),
	attachmentJson: z.string(),
	// The exact context text the attachment rendered into the model's turn.
	rendered: z.array(z.string()).optional(),
	renderedInHumanTurn: z.array(z.string()).optional(),
	renderedRole: RenderedRoleSchema.optional(),
	// A queued_command whose prompt was absorbed into the running turn, linked by
	// a `queue-operation` removal's commandUuid matching the attachment's source_uuid,
	// or its deliveryId matching the attachment's delivery_id.
	absorbedMidTurn: z.literal(true).optional(),
	// A queued_command holding a prompt a person typed while the turn ran: its
	// content and the time it was enqueued, for drawing as an ordinary user row.
	humanPrompt: z
		.object({
			content: z.union([z.string(), z.array(ContentBlockSchema)]),
			timestamp: z.string().optional(),
			// The CLI command's uuid, which upstream keys the prompt's row by.
			sourceUuid: z.string().optional(),
		})
		.optional(),
	// Descriptions of deferred tools a deferred_tools_delta surfaced only by a
	// `sameAs` pointer, resolved from the earlier record that carried the definition.
	sameAsDescriptions: z.record(z.string(), z.string()).optional(),
	// An instructions or session_context attachment the CLI re-announced (`changed`), with its `reason`.
	contextRefresh: z
		.object({subject: z.enum(["instructions", "session_context"]), reason: z.string().optional()})
		.optional(),
	uuid: z.string().optional(),
	timestamp: z.string().optional(),
	sessionId: z.string().optional(),
	lineIndex: z.number(),
});

/** System-record subtypes the viewer renders; all others are skipped. */
const RenderedSystemSubtypeSchema = z.enum([
	"compact_boundary",
	"stop_hook_summary",
	"api_error",
	"turn_duration",
	"scheduled_task_fire",
	"local_command",
	"bridge_status",
	"model_refusal_no_fallback",
]);

const SystemLineSchema = z.object({
	type: z.literal("system"),
	subtype: RenderedSystemSubtypeSchema,
	content: z.string().optional(),
	compactMetadata: CompactMetadataSchema.optional(),
	hookCount: z.number().optional(),
	hookInfos: z.array(JsonValueSchema).optional(),
	hookErrors: z.array(JsonValueSchema).optional(),
	hookAdditionalContext: z.array(JsonValueSchema).optional(),
	preventedContinuation: z.boolean().optional(),
	retryAttempt: z.number().optional(),
	retryInMs: z.number().optional(),
	maxRetries: z.number().optional(),
	pendingBackgroundAgentCount: z.number().optional(),
	durationMs: z.number().optional(),
	error: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
	taskId: z.string().optional(),
	cron: z.string().optional(),
	prompt: z.string().optional(),
	taskKind: z.string().optional(),
	cronKind: z.string().optional(),
	noOpStreak: z.number().optional(),
	commandRun: z.object({command: z.string(), args: z.string().optional()}).optional(),
	url: z.string().optional(),
	originalModel: z.string().optional(),
	requestId: z.string().optional(),
	apiRefusalCategory: z.string().optional(),
	apiRefusalExplanation: z.string().optional(),
	uuid: z.string().optional(),
	timestamp: z.string().optional(),
	sessionId: z.string().optional(),
	lineIndex: z.number(),
});

const WorktreeLineSchema = z.object({
	type: z.literal("worktree"),
	worktreeName: z.string(),
	worktreeBranch: z.string(),
	originalCwd: z.string(),
	originalBranch: z.string().optional(),
	originalHeadCommit: z.string().optional(),
	enteredExisting: z.boolean().optional(),
	lineIndex: z.number(),
});

/**
 * A `<task-notification>` the queue took in but never delivered: no later
 * dequeue, removal or popAll took it off. Upstream still draws it as a row.
 */
const QueuedTaskNotificationLineSchema = z.object({
	type: z.literal("queued-task-notification"),
	content: z.string(),
	timestamp: z.string().optional(),
	lineIndex: z.number(),
});

/**
 * A typed-ahead human prompt the queue took in and has not handed over yet:
 * no later dequeue, removal or popAll took it off.
 */
const QueuedPromptLineSchema = z.object({
	type: z.literal("queued-prompt"),
	content: z.string(),
	timestamp: z.string().optional(),
	lineIndex: z.number(),
});

/**
 * A prompt a UserPromptSubmit/UserPromptExpansion hook blocked (a
 * `system/informational` record with preventContinuation). Upstream's
 * `prompt_blocked` entry: a card when last, a marker otherwise.
 */
const PromptBlockedLineSchema = z.object({
	type: z.literal("prompt-blocked"),
	reason: z.string(),
	originalPrompt: z.string().optional(),
	uuid: z.string().optional(),
	timestamp: z.string().optional(),
	lineIndex: z.number(),
});

/**
 * One or more adjacent `system/informational` records that are not a hook
 * block or stop (upstream `hook_notice` item): a "Claude Code notice" row.
 */
/**
 * A notice's message: an informational record's text, or a structured notice from one of the `system`
 * subtypes upstream maps through `hf` (adapter c06cf64bb), worded by `hookNoticeText`.
 */
const HookNoticeMessageSchema = z.union([
	z.string(),
	z.discriminatedUnion("notice", [
		z.object({notice: z.literal("away_summary"), recap: z.string()}),
		z.object({notice: z.literal("agents_killed")}),
		z.object({notice: z.literal("prompt_stopped"), reason: z.string().optional()}),
		z.object({
			notice: z.literal("memory_saved"),
			count: z.number(),
			teamCount: z.number(),
			verb: z.string().optional(),
		}),
	]),
]);

export type HookNoticeMessage = z.infer<typeof HookNoticeMessageSchema>;

const HookNoticeSchema = z.object({
	message: HookNoticeMessageSchema,
	level: z.enum(["warning", "notice"]),
	uuid: z.string().optional(),
});

const HookNoticeLineSchema = z.object({
	type: z.literal("hook-notice"),
	notices: z.array(HookNoticeSchema),
	uuid: z.string().optional(),
	timestamp: z.string().optional(),
	lineIndex: z.number(),
});

export type HookNotice = z.infer<typeof HookNoticeSchema>;

/**
 * A record the schema rejected. Rendered as a visible gap so schema drift
 * surfaces in the transcript instead of silently deleting messages.
 */
const UnparsedLineSchema = z.object({
	type: z.literal("unparsed"),
	recordType: z.string().optional(),
	issues: z.array(z.string()),
	uuid: z.string().optional(),
	timestamp: z.string().optional(),
	lineIndex: z.number(),
});

/**
 * Discriminated union of all rendered line types.
 * Each variant corresponds to a JSONL record type that produces visible output.
 */
export const RenderedLineSchema = z.discriminatedUnion("type", [
	MessageLineSchema,
	AgentNameLineSchema,
	AgentColorLineSchema,
	PermissionModeLineSchema,
	ArtifactLinkLineSchema,
	ArtifactWatchLineSchema,
	QueuedTaskNotificationLineSchema,
	QueuedPromptLineSchema,
	AttachmentLineSchema,
	SystemLineSchema,
	PromptBlockedLineSchema,
	HookNoticeLineSchema,
	WorktreeLineSchema,
	UnparsedLineSchema,
]);

// ---------------------------------------------------------------------------
// Exported types -- all inferred from schemas above
// ---------------------------------------------------------------------------

export type MessageProcessedLine = z.infer<typeof MessageLineSchema>;
export type ProcessedLine = z.infer<typeof RenderedLineSchema>;

// Convenience aliases used by consumers
export type SessionLine = ProcessedLine;
export type MessageSessionLine = MessageProcessedLine;
export type SessionContentBlock = z.infer<typeof ContentBlockSchema>;

// ---------------------------------------------------------------------------
// Transcript result types
// ---------------------------------------------------------------------------

export interface ProcessedTranscript {
	lines: ProcessedLine[];
	toolResultMap: Map<string, ToolResultInfo>;
	uuidToLine: Map<string, number>;
	title: string;
	customTitle: string | undefined;
	/** The account and organization owning the session, from its latest `session-owner` record. */
	sessionOwner: SessionOwner | undefined;
	/** The served cuts keyed by the on-chain prompt that replaced each abandoned branch, in served order. */
	cutsByReplacement: ReadonlyMap<string, readonly TranscriptCut[]>;
}

/** The active chain the server computed over the whole file (transcript-chain.ts). */
export interface ServedChain {
	/** Records on abandoned branches; they render nothing but keep their raw index. */
	hidden: ReadonlySet<string>;
	cuts: readonly TranscriptCut[];
}

interface IncrementalResult {
	newSessionLines: ProcessedLine[];
	newToolResults: Map<string, ToolResultInfo>;
}

/**
 * Describe a schema-rejected record well enough to render a placeholder and
 * diagnose the drift, reading only fields we cannot trust to be present.
 */
/**
 * The prompt-blocked line for an informational record (upstream adapter
 * c06cf64bb): a parsed hook block, or any preventContinuation text that isn't
 * a "stopped" notice (the caller routes those to the prompt_stopped notice).
 */
function promptBlockedLine(content: string, lineIndex: number): z.infer<typeof PromptBlockedLineSchema> {
	const parsed = parseHookMessage(content);
	if (parsed?.kind === "blocked") {
		return parsed.originalPrompt === undefined
			? {type: "prompt-blocked", reason: parsed.reason, lineIndex}
			: {type: "prompt-blocked", reason: parsed.reason, originalPrompt: parsed.originalPrompt, lineIndex};
	}
	return {type: "prompt-blocked", reason: content, lineIndex};
}

/** A line upstream keeps as a transcript entry: an assistant line, or a user line that is neither meta nor only tool results. */
function isEntryLine(line: ProcessedLine): line is MessageProcessedLine {
	if (line.type === "assistant") return true;
	if (line.type !== "user" || line.isMeta === true) return false;
	const content = line.message?.content;
	return !(Array.isArray(content) && content.length > 0 && content.every((block) => block.type === "tool_result"));
}

/**
 * Whether the previous entry is a user bubble already reading `text` (upstream `fd`): a forked slash
 * dispatch echoes the stop as a visible user message, so the notice would repeat it.
 */
function repeatsUserText(previous: MessageProcessedLine | undefined, text: string): boolean {
	if (previous?.type !== "user") return false;
	const content = previous.message?.content;
	if (typeof content === "string") return stripAnsi(content) === text;
	return (content ?? []).some((block) => block.type === "text" && stripAnsi(block.text) === text);
}

/**
 * One notice from a plain informational record's ANSI-stripped text (upstream
 * adapter c06cf64bb): trimmed with one trailing colon dropped, `info` level
 * skipped, any other level but `warning` read as `notice`. Null when skipped.
 */
function hookNotice(text: string, level: string | undefined, uuid: string | undefined): HookNotice | null {
	const message = text.trim().replace(/:$/, "").trimEnd();
	if (message === "" || level === "info") return null;
	const notice: HookNotice = {message: capDetails(message), level: level === "warning" ? "warning" : "notice"};
	if (uuid !== undefined) notice.uuid = uuid;
	return notice;
}

/**
 * A notice from one of the `system` subtypes upstream draws as a "Claude Code notice" (adapter `hf`).
 * Null when the record carries nothing to show.
 */
const NOTICE_SUBTYPES: ReadonlySet<string> = new Set([
	"agents_killed",
	"away_summary",
	"memory_saved",
	"model_consent_fallback",
]);

function subtypeNotice(record: Extract<JsonlRecord, {type: "system"}>): HookNotice | null {
	const raw: Record<string, unknown> = record;
	const {content} = record;
	let notice: HookNotice;
	switch (record.subtype) {
		case "agents_killed":
			notice = {message: {notice: "agents_killed"}, level: "notice"};
			break;
		case "away_summary": {
			const recap = typeof content === "string" ? recapText(stripAnsi(content)) : undefined;
			if (recap === undefined) return null;
			notice = {message: {notice: "away_summary", recap}, level: "notice"};
			break;
		}
		case "memory_saved": {
			const paths = record.writtenPaths ?? raw["written_paths"];
			const pathCount = Array.isArray(paths) ? paths.length : 0;
			if (pathCount === 0) return null;
			const team = record.teamCount ?? raw["team_count"];
			const teamCount = typeof team === "number" && team > 0 ? Math.min(Math.floor(team), pathCount) : 0;
			const verb = typeof record.verb === "string" ? stripAnsi(record.verb).trim() : "";
			const message: Extract<HookNoticeMessage, {notice: "memory_saved"}> = {
				notice: "memory_saved",
				count: pathCount - teamCount,
				teamCount,
			};
			if (verb !== "") message.verb = verb;
			notice = {message, level: "notice"};
			break;
		}
		case "model_consent_fallback": {
			const message = typeof content === "string" ? stripAnsi(content).trim() : "";
			if (message === "") return null;
			notice = {message, level: "warning"};
			break;
		}
		default:
			return null;
	}
	if (record.uuid !== undefined) notice.uuid = record.uuid;
	return notice;
}

function buildUnparsedLine(
	obj: unknown,
	lineIndex: number,
	error: z.ZodError,
): Extract<ProcessedLine, {type: "unparsed"}> {
	const raw = isRecord(obj) ? obj : {};
	const line: Extract<ProcessedLine, {type: "unparsed"}> = {
		type: "unparsed",
		lineIndex,
		issues: error.issues.map((issue) =>
			issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
		),
	};
	if (typeof raw["type"] === "string") line.recordType = raw["type"];
	if (typeof raw["uuid"] === "string") line.uuid = raw["uuid"];
	if (typeof raw["timestamp"] === "string") line.timestamp = raw["timestamp"];
	return line;
}

/** Stands in for a tool name while re-parsing, so no tool input schema applies. */
const INVALID_INPUT_TOOL_NAME = "__invalid_tool_input__";

/**
 * Re-parse an assistant record whose only failures are tool inputs that miss
 * their tool's schema. claude.ai/code shows such calls anyway, so the record
 * keeps its text and other calls, and the failed calls come back flagged for a
 * raw rendering. Any other failure, or an input that is not even an object,
 * leaves the record rejected.
 */
function parseWithInvalidToolInputs(
	obj: unknown,
	error: z.ZodError,
): {record: JsonlRecord; invalidToolInputIds: string[]} | undefined {
	if (!isRecord(obj)) return undefined;
	const raw = obj;
	const message = raw["message"];
	if (raw["type"] !== "assistant" || !isRecord(message)) return undefined;
	const content = message["content"];
	if (!Array.isArray(content)) return undefined;

	const invalid = new Map<number, {id: string; name: string}>();
	for (const issue of error.issues) {
		const [messageKey, contentKey, index, inputKey] = issue.path;
		if (messageKey !== "message" || contentKey !== "content" || inputKey !== "input") return undefined;
		if (typeof index !== "number") return undefined;
		const block: unknown = content[index];
		if (!isRecord(block)) return undefined;
		const {type, id, name, input} = block;
		if (type !== "tool_use" || typeof id !== "string" || typeof name !== "string") return undefined;
		if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
		invalid.set(index, {id, name});
	}

	const renamed = content.map((block: unknown, index) =>
		invalid.has(index) && isRecord(block) ? {...block, name: INVALID_INPUT_TOOL_NAME} : block,
	);
	const reparsed = JsonlRecordSchema.safeParse({
		...raw,
		message: {...message, content: renamed},
	});
	if (!reparsed.success || reparsed.data.type !== "assistant") return undefined;
	const parsedContent = reparsed.data.message.content;
	for (const [index, {name}] of invalid) {
		const block = Array.isArray(parsedContent) ? parsedContent[index] : undefined;
		if (block?.type === "tool_use") block.name = name;
	}
	return {record: reparsed.data, invalidToolInputIds: [...invalid.values()].map(({id}) => id)};
}

/** Keys a queued command and its queue-operation share: the command uuid, the delivery id, or both. */
const USER_REJECTED_TOOL_USE = "User rejected tool use";
const REJECTION_WITH_FEEDBACK_PREFIX = "The user doesn't want to proceed with this tool use. The tool use was rejected";

/**
 * How upstream labels a call the user turned down: "Stopped" when they rejected
 * or interrupted it outright, "Denied" when they rejected it with a typed reply.
 * Auto-mode denials read "Blocked" (see `autoModeDenial`); rule denials and plain
 * tool errors read "Failed".
 */
function userDenial(kind: string | undefined, toolUseResult: unknown, resultText: string): "stopped" | "denied" | null {
	// Upstream's adapter (c06cf64bb `Ll`) reads a cancelled call as interrupted.
	if (kind !== "user-rejected" && kind !== "interrupted" && kind !== "cancelled") return null;
	const interrupted =
		toolUseResult === USER_REJECTED_TOOL_USE ||
		resultText === "Tool execution was interrupted." ||
		resultText.startsWith("[Request interrupted by user");
	if (!interrupted && resultText.startsWith(REJECTION_WITH_FEEDBACK_PREFIX)) return "denied";
	return "stopped";
}

/** Upstream `vl`'s interrupted test for one errored result; the record's denial kind and toolUseResult count only for its lone result. */
function interruptedResult(
	content: readonly {type: string}[],
	record: {toolUseResult?: unknown; toolDenialKind?: string | undefined},
	text: string,
): boolean {
	const lone = content.filter((part) => part.type === "tool_result").length === 1;
	return isInterruptedToolResult(
		lone ? {text, toolUseResult: record.toolUseResult, toolDenialKind: record.toolDenialKind} : {text},
	);
}

function queuePairingKeys(commandUuid: string | undefined, deliveryId: string | undefined): string[] {
	const keys: string[] = [];
	if (commandUuid) keys.push(`command:${commandUuid}`);
	if (deliveryId) keys.push(`delivery:${deliveryId}`);
	return keys;
}

function getRecordSessionId(record: z.infer<typeof JsonlRecordSchema>): string | undefined {
	if ("sessionId" in record && typeof record.sessionId === "string") {
		return record.sessionId;
	}
	if ("session_id" in record && typeof record.session_id === "string") {
		return record.session_id;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Command group deduplication
// ---------------------------------------------------------------------------

/**
 * Get the string content of a user message line, if it has string content.
 */
function getUserStringContent(line: ProcessedLine): string | undefined {
	if (line.type !== "user") return undefined;
	const content = line.message?.content;
	if (typeof content === "string") return content;
	return undefined;
}

/**
 * Check whether a user message line is a slash command (contains `<command-name>`).
 */
export function isCommandLine(line: ProcessedLine): boolean {
	const text = getUserStringContent(line);
	return text?.includes("<command-name>") === true;
}

/**
 * Check whether a user message line is a local-command-caveat.
 */
export function isCaveatLine(line: ProcessedLine): boolean {
	const text = getUserStringContent(line);
	return text?.startsWith("<local-command-caveat>") === true;
}

/**
 * Check whether a user message line is a local-command-stdout.
 */
export function isStdoutLine(line: ProcessedLine): boolean {
	const text = getUserStringContent(line);
	return text?.startsWith("<local-command-stdout>") === true;
}

/**
 * Check whether a line is a blank assistant message with no visible content.
 * These are transparent for command group dedup -- they don't break adjacency.
 */
function isBlankAssistantLine(line: ProcessedLine): boolean {
	if (line.type !== "assistant") return false;
	const content = line.message?.content;
	if (content === undefined) return true;
	if (typeof content === "string") return content.trim() === "";
	if (Array.isArray(content)) {
		if (content.length === 0) return true;
		return content.every(
			(block) => block.type === "text" && (typeof block.text !== "string" || block.text.trim() === ""),
		);
	}
	return false;
}

/**
 * Remove duplicate consecutive command groups from processed lines.
 *
 * A "command group" is an optional caveat line, followed by a command line,
 * followed by an optional stdout line. When two adjacent command groups have
 * identical command content, the second group is removed.
 *
 * Blank assistant messages between groups are treated as transparent and
 * removed along with the duplicate group.
 */
/**
 * Told about every command group `deduplicateCommandGroups` folds away. The
 * fold depends only on the lines from the previous group's first line through
 * the folded group's last, so `fromLineIndex`..`toLineIndex` bounds the records
 * that could have changed the decision (see session-resource-scan).
 */
export type CommandGroupFoldObserver = (fromLineIndex: number, toLineIndex: number) => void;

function deduplicateCommandGroups(lines: ProcessedLine[], onFold?: CommandGroupFoldObserver): ProcessedLine[] {
	const indicesToRemove = new Set<number>();
	let lastCommandContent: string | undefined;
	let lastCommandGroupStart = -1;
	let lastCommandGroupEnd = -1;

	for (const [i, line] of lines.entries()) {
		const commandContent = getUserStringContent(line);
		if (commandContent?.includes("<command-name>") !== true) {
			// Non-command lines that aren't part of a command group reset tracking,
			// unless they're caveats, stdouts, or blank assistant messages.
			if (!isCaveatLine(line) && !isStdoutLine(line) && !isBlankAssistantLine(line)) {
				lastCommandContent = undefined;
				lastCommandGroupEnd = -1;
			}
			continue;
		}

		// Determine the boundaries of this command group
		const previous = lines[i - 1];
		const following = lines[i + 1];
		const groupStart = previous !== undefined && isCaveatLine(previous) ? i - 1 : i;
		const groupEnd = following !== undefined && isStdoutLine(following) ? i + 1 : i;

		// Check adjacency: all lines between the previous group end and this group start
		// must be blank assistants (transparent lines) for the groups to be "adjacent".
		const gapStart = lastCommandGroupEnd + 1;
		const gap = lines.slice(gapStart, groupStart);
		const adjacentToPrevious = gap.every(isBlankAssistantLine);

		if (commandContent === lastCommandContent && adjacentToPrevious) {
			const previousStart = lines[lastCommandGroupStart];
			const end = lines[groupEnd];
			if (onFold !== undefined && previousStart !== undefined && end !== undefined) {
				onFold(previousStart.lineIndex, end.lineIndex);
			}
			// Duplicate command group -- mark for removal
			for (let j = groupStart; j <= groupEnd; j++) {
				indicesToRemove.add(j);
			}
			// Also remove blank assistant messages in the gap
			for (const [offset, gapLine] of gap.entries()) {
				if (isBlankAssistantLine(gapLine)) {
					indicesToRemove.add(gapStart + offset);
				}
			}
		} else {
			lastCommandContent = commandContent;
		}
		lastCommandGroupStart = groupStart;
		lastCommandGroupEnd = groupEnd;
	}

	if (indicesToRemove.size === 0) return lines;
	return lines.filter((_, index) => !indicesToRemove.has(index));
}

/**
 * Decorates a successful `Artifact` result with the artifact it points at, or
 * the artifacts a `list` returned. A result is an Artifact one when its
 * tool_use was seen in this batch, or when its structured `toolUseResult`
 * matches the strict Artifact result schemas (the tool_use arrived earlier).
 */
function addArtifactDecoration(
	info: ToolResultInfo,
	resultText: string,
	toolUseResult: unknown,
	toolName: string | undefined,
): void {
	const structured = ArtifactToolResultSchema.safeParse(toolUseResult);
	const structuredObject = structured.success && typeof structured.data === "object" ? structured.data : undefined;
	if (toolName !== "Artifact" && structuredObject === undefined) return;
	if (structuredObject !== undefined && "artifacts" in structuredObject) {
		info.artifactList = structuredObject.artifacts;
		return;
	}
	const artifact = parseArtifactOutput(resultText, toolUseResult);
	if (artifact !== undefined) info.artifact = artifact;
}

type ArtifactWatchEntry = z.infer<typeof ArtifactWatchLineSchema>["artifacts"][number];

/**
 * The page URL for an artifact-monitor key, which is an artifact id (a code
 * artifact's uuid or a published slug) or, occasionally, the full URL.
 */
function artifactKeyUrl(key: string): string {
	const direct = normalizeArtifactUrl(key);
	if (direct !== undefined) return direct.url;
	const fromId = normalizeArtifactUrl(`https://claude.ai/code/artifact/${key}`);
	if (fromId === undefined) return key;
	return fromId.kind === "slug" ? `https://claude.ai/artifact/${fromId.id}` : fromId.url;
}

/** Combines the latest monitor and ledger records into the watched-artifact list. */
function artifactWatchEntries(
	monitor: Extract<z.infer<typeof JsonlRecordSchema>, {type: "artifact-comment-monitor"}>,
	ledger: Extract<z.infer<typeof JsonlRecordSchema>, {type: "artifact-autoreact-ledger"}> | undefined,
): ArtifactWatchEntry[] {
	return Object.entries(monitor.artifacts ?? {}).map(([key, watched]) => {
		const entry: ArtifactWatchEntry = {url: artifactKeyUrl(key)};
		if (watched.title !== undefined) entry.title = watched.title;
		if (watched.state !== undefined) entry.state = watched.state;
		const threads = ledger?.artifacts?.[key]?.threads?.length ?? 0;
		if (threads > 0) entry.commentThreads = threads;
		return entry;
	});
}

type QueueOperationRecord = Extract<z.infer<typeof JsonlRecordSchema>, {type: "queue-operation"}>;

/** The CLI's dequeue ranks: the first entry with the lowest rank goes next. */
const QUEUE_PRIORITY_RANK = {now: 0, next: 1, later: 2} as const;

/** A waiting queue entry, with its priority and the line it draws while it waits. */
type QueuedEntry = {
	content: string | undefined;
	priority: keyof typeof QUEUE_PRIORITY_RANK;
	line: z.infer<typeof QueuedTaskNotificationLineSchema> | z.infer<typeof QueuedPromptLineSchema> | null;
};

const SYSTEM_QUEUED_PREFIXES = ["<task-notification>", "<agent-message", "<cross-session-message"];
const SYSTEM_QUEUED_PATTERNS = [
	/^Background agent ".*" was stopped/s,
	/^\d+ background agents were stopped/,
	/^\[Cross-session delivery notice\]/,
	/^The person enabled mod hot-reload/,
];

/**
 * Whether an enqueued plain-text content is something a person typed, not a
 * notification, agent message or CLI notice the harness queued itself.
 */
export function isHumanQueuedContent(content: string | undefined): boolean {
	if (content === undefined || content === "") return false;
	if (SYSTEM_QUEUED_PREFIXES.some((prefix) => content.startsWith(prefix))) return false;
	return !SYSTEM_QUEUED_PATTERNS.some((pattern) => pattern.test(content));
}

const QueuedPromptBlocksSchema = z.array(ContentBlockSchema);

type QueuedCommandAttachment = Extract<
	Extract<z.infer<typeof JsonlRecordSchema>, {type: "attachment"}>["attachment"],
	{type: "queued_command"}
>;

/**
 * The prompt of a queued_command a person typed while a turn ran: a prompt-mode,
 * non-meta command from a human (or, from older CLIs, no) origin whose text is not
 * a notification, agent message or CLI notice. Null for any other queued command.
 */
function humanQueuedPrompt(
	attachment: QueuedCommandAttachment,
): z.infer<typeof AttachmentLineSchema>["humanPrompt"] | null {
	if (attachment.commandMode !== "prompt" || attachment.isMeta === true) return null;
	const {origin, prompt} = attachment;
	if (origin !== undefined && (typeof origin === "string" || origin["kind"] !== "human")) return null;
	let content: string | z.infer<typeof QueuedPromptBlocksSchema>;
	if (typeof prompt === "string") {
		content = prompt;
	} else {
		const blocks = QueuedPromptBlocksSchema.safeParse(prompt);
		if (!blocks.success) return null;
		content = blocks.data;
	}
	const text =
		typeof content === "string"
			? content
			: content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
	// The harness frames agent messages with a lead-in line, so the envelope can sit past the start.
	if (!isHumanQueuedContent(text) || parseAgentMessage(text) !== null) return null;
	return {
		content,
		...(attachment.timestamp === undefined ? {} : {timestamp: attachment.timestamp}),
		...(attachment.source_uuid === undefined ? {} : {sourceUuid: attachment.source_uuid}),
	};
}

/**
 * Replays one queue operation: an enqueue joins the back (a task notification
 * or a human prompt also draws a line), a dequeue takes the first entry of the highest priority
 * (task notifications wait behind typed prompts), a removal takes the first
 * entry with its content, and popAll empties the queue. A taken entry's line
 * goes into `delivered`, for the caller to drop.
 */
function trackQueue(
	record: QueueOperationRecord,
	lineIndex: number,
	queued: QueuedEntry[],
	delivered: Set<ProcessedLine>,
	sessionLines: ProcessedLine[],
): void {
	const take = (index: number) => {
		const [entry] = queued.splice(index, 1);
		if (entry?.line) delivered.add(entry.line);
	};
	switch (record.operation) {
		case "enqueue": {
			const {content} = record;
			let line: QueuedEntry["line"] = null;
			const isTaskNotification = content?.startsWith("<task-notification>") === true;
			if (isTaskNotification) {
				line = {type: "queued-task-notification", content, lineIndex};
			} else if (content !== undefined && isHumanQueuedContent(content)) {
				line = {type: "queued-prompt", content, lineIndex};
			}
			if (line) {
				if (record.timestamp !== undefined) line.timestamp = record.timestamp;
				sessionLines.push(line);
			}
			queued.push({content, priority: isTaskNotification ? "later" : "next", line});
			return;
		}
		case "dequeue": {
			const rank = Math.min(...queued.map((entry) => QUEUE_PRIORITY_RANK[entry.priority]));
			const index = queued.findIndex((entry) => QUEUE_PRIORITY_RANK[entry.priority] === rank);
			if (index !== -1) take(index);
			return;
		}
		case "remove": {
			const index = queued.findIndex((entry) => entry.content === record.content);
			if (index !== -1) take(index);
			return;
		}
		case "popAll":
			while (queued.length > 0) take(0);
			return;
	}
}

/** An assistant record holding only empty thinking that no transcript mode draws (an omitted one draws a stub). */
function isInvisibleThinkingRecord(record: {
	thinkingDisplay?: string | undefined;
	message: {content: string | readonly {type: string; thinking?: string}[]};
}): boolean {
	const {content} = record.message;
	return (
		record.thinkingDisplay !== "omitted" &&
		typeof content !== "string" &&
		content.length > 0 &&
		content.every((block) => block.type === "thinking" && block.thinking?.trim() === "")
	);
}

export interface SessionOwner {
	accountUuid: string;
	organizationUuid: string;
}

interface RecordBatchResult {
	sessionLines: ProcessedLine[];
	toolResults: Map<string, ToolResultInfo>;
	title: string;
	customTitle: string | undefined;
	sessionOwner: SessionOwner | undefined;
}

/**
 * Records processed between pause points of `processRecordBatchSteps`. Small
 * enough that a pause comes every millisecond or so, large enough that the
 * generator's resumption cost disappears into the work.
 */
const RECORD_BATCH_STEP = 64;

/** Run a stepped computation to completion without pausing. */
function drainSteps<T>(steps: Generator<void, T, void>): T {
	for (;;) {
		const step = steps.next();
		if (step.done) return step.value;
	}
}

function processRecordBatch(
	records: unknown[],
	startLineIndex: number,
	uuidToLine?: Map<string, number>,
	hidden?: ReadonlySet<string>,
): RecordBatchResult {
	return drainSteps(processRecordBatchSteps(records, startLineIndex, uuidToLine, hidden));
}

/**
 * The record loop as a generator that pauses every `RECORD_BATCH_STEP` records,
 * so a caller holding a whole huge transcript can hand the event loop back
 * between steps instead of blocking it for seconds (see session-resource-scan).
 */
function* processRecordBatchSteps(
	records: unknown[],
	startLineIndex: number,
	uuidToLine?: Map<string, number>,
	hidden?: ReadonlySet<string>,
	onFold?: CommandGroupFoldObserver,
): Generator<void, RecordBatchResult, void> {
	const sessionLines: ProcessedLine[] = [];
	const toolResults = new Map<string, ToolResultInfo>();
	const toolStartTimes = new Map<string, number>();
	const toolNames = new Map<string, string>();
	const toolInputs = new Map<string, Record<string, unknown>>();
	let title = "";
	let lastWorktreeKey: string | undefined;
	let lastAttributionKey: string | undefined;
	let lastRequestRef: string | undefined;
	let customTitle: string | undefined;
	let sessionOwner: SessionOwner | undefined;
	const publishedArtifactKeys = new Set<string>();
	let lastMonitor: Extract<z.infer<typeof JsonlRecordSchema>, {type: "artifact-comment-monitor"}> | undefined;
	let lastLedger: Extract<z.infer<typeof JsonlRecordSchema>, {type: "artifact-autoreact-ledger"}> | undefined;
	let lastArtifactWatchKey: string | undefined;
	// Absorbed removals and queued_command attachments can land in either order,
	// and pair on either the command uuid or the delivery id.
	const absorbedQueueKeys = new Set<string>();
	const queuedCommandLines = new Map<string, z.infer<typeof AttachmentLineSchema>>();
	// The queue in enqueue order.
	const queued: QueuedEntry[] = [];
	const delivered = new Set<ProcessedLine>();
	// Per deferred_tools_delta uuid, the description each surfaced tool resolved to.
	const surfacedDescriptions = new Map<string, Map<string, string | undefined>>();
	// Adjacent notices share one line (upstream `Jd` merges adjacent plugin-less `hook_notice` items).
	// A turn_duration line between them doesn't split them: upstream's stand-in for it, the `result`
	// event, adds no item to the entry, so the last item is still the notice.
	const pushHookNotice = (notice: HookNotice, lineIndex: number, timestamp: string | undefined) => {
		const previous = sessionLines.findLast((line) => !(line.type === "system" && line.subtype === "turn_duration"));
		if (previous?.type === "hook-notice") {
			previous.notices.push(notice);
			return;
		}
		const noticeLine: z.infer<typeof HookNoticeLineSchema> = {type: "hook-notice", notices: [notice], lineIndex};
		if (notice.uuid !== undefined) noticeLine.uuid = notice.uuid;
		if (timestamp !== undefined) noticeLine.timestamp = timestamp;
		sessionLines.push(noticeLine);
	};

	for (let i = 0; i < records.length; i++) {
		if (i > 0 && i % RECORD_BATCH_STEP === 0) yield;
		const obj = records[i];
		const lineIndex = startLineIndex + i;
		if (hidden !== undefined && isRecord(obj) && typeof obj["uuid"] === "string" && hidden.has(obj["uuid"]))
			continue;

		const parsed = JsonlRecordSchema.safeParse(obj);
		let invalidToolInputIds: string[] | undefined;
		let record: JsonlRecord;
		if (parsed.success) {
			record = parsed.data;
		} else {
			const salvaged = parseWithInvalidToolInputs(obj, parsed.error);
			if (salvaged === undefined) {
				sessionLines.push(buildUnparsedLine(obj, lineIndex, parsed.error));
				continue;
			}
			record = salvaged.record;
			invalidToolInputIds = salvaged.invalidToolInputIds;
		}

		const uuid = "uuid" in record && typeof record.uuid === "string" ? record.uuid : undefined;
		const sessionId = getRecordSessionId(record);
		if (uuid && uuidToLine) uuidToLine.set(uuid, lineIndex);

		if (record.type === "custom-title") {
			customTitle = record.customTitle;
			continue;
		}

		// Re-emitted every turn; metadata, never a transcript row.
		if (record.type === "session-owner") {
			sessionOwner = {accountUuid: record.accountUuid, organizationUuid: record.organizationUuid};
			continue;
		}

		// Extract title from first user text
		if (record.type === "user" && !title) {
			const {content} = record.message;
			const titleOptions = {isMeta: record.isMeta === true};
			if (typeof content === "string") {
				const cleaned = stripCommandTags(content);
				if (cleaned) title = extractSessionTitle(cleaned, undefined, titleOptions);
			} else if (Array.isArray(content)) {
				for (const block of content) {
					if (block.type === "text") {
						const cleaned = stripCommandTags(block.text);
						if (cleaned) {
							title = extractSessionTitle(cleaned, undefined, titleOptions);
							break;
						}
					}
				}
			}
		}

		// Track tool_use start times from assistant messages
		if (record.type === "assistant") {
			const {content} = record.message;
			const timestamp = record.timestamp;
			if (Array.isArray(content)) {
				for (const block of content) {
					if (block.type === "tool_use") {
						toolNames.set(block.id, block.name);
						toolInputs.set(block.id, block.input);
						if (timestamp) {
							const t = new Date(timestamp).getTime();
							if (!isNaN(t)) toolStartTimes.set(block.id, t);
						}
					}
				}
			}
		}

		// Pair tool_result blocks from user messages
		if (record.type === "user") {
			const {content} = record.message;
			const timestamp = record.timestamp;
			if (Array.isArray(content)) {
				for (const block of content) {
					if (block.type === "tool_result") {
						// A result with no text, like ToolSearch's tool_reference blocks or a
						// Read of an image, still settles its call.
						const rawResult = extractToolResultContent(block.content) ?? "";
						const resultText = stripResultTags(rawResult);
						// A result reporting `success: false`, as SendMessage does when no agent
						// is reachable, fails the call upstream though is_error is unset.
						const reported = record.toolUseResult;
						const reportsFailure =
							typeof reported === "object" &&
							reported !== null &&
							"success" in reported &&
							reported.success === false;
						const info: ToolResultInfo = {
							result: truncateResult(resultText, 150),
							isError: block.is_error === true || reportsFailure,
							resultUuid: uuid ?? "",
						};
						const denial = info.isError
							? userDenial(record.toolDenialKind, record.toolUseResult, resultText)
							: null;
						if (info.isError && interruptedResult(content, record, resultText)) info.interrupted = true;
						if (denial === "stopped") info.stopped = true;
						if (denial === "denied") info.denied = true;
						const autoMode =
							info.isError && denial === null ? autoModeDenial(record.toolDenialKind, resultText) : null;
						if (autoMode !== null) {
							info.blocked = true;
							if (autoMode.blockedReason !== undefined) info.blockedReason = autoMode.blockedReason;
							if (autoMode.blockedNoVerdict !== undefined)
								info.blockedNoVerdict = autoMode.blockedNoVerdict;
						}
						const name = toolNames.get(block.tool_use_id);
						const input = toolInputs.get(block.tool_use_id);
						const resultMeta = toolResultMetaFrom(
							record.toolUseResult,
							name === undefined || input === undefined ? undefined : {name, input},
						);
						if (resultMeta !== undefined) info.resultMeta = resultMeta;
						if (record.permissionDecision !== undefined) info.permission = record.permissionDecision;
						if (record.sandboxed !== undefined) info.sandboxed = record.sandboxed;
						// Only an array result can hold image blocks; skipping the call keeps string
						// results off the hot path.
						if (Array.isArray(block.content)) {
							const images = extractToolResultImages(block.content);
							if (images.length > 0) info.images = images;
						}
						if (!info.isError) {
							addArtifactDecoration(
								info,
								resultText,
								record.toolUseResult,
								toolNames.get(block.tool_use_id),
							);
						}
						const startTime = toolStartTimes.get(block.tool_use_id);
						if (startTime && timestamp) {
							const resultTime = new Date(timestamp).getTime();
							if (!isNaN(resultTime) && resultTime > startTime) {
								info.duration = resultTime - startTime;
							}
						}
						toolResults.set(block.tool_use_id, info);
					}
				}
			}
		}

		// Non-message rendering line types
		if (record.type === "agent-name") {
			sessionLines.push({
				type: "agent-name",
				agentName: record.agentName,
				lineIndex,
			});
			continue;
		}
		if (record.type === "agent-color") {
			sessionLines.push({
				type: "agent-color",
				agentColor: record.agentColor,
				lineIndex,
			});
			continue;
		}
		if (record.type === "permission-mode") {
			sessionLines.push({
				type: "permission-mode",
				permissionMode: record.permissionMode,
				lineIndex,
			});
			continue;
		}

		if (record.type === "frame-link") {
			// Most frame-link records are count-only heartbeats; a republish that
			// changes nothing is not news either.
			if (record.frameUrl === undefined) continue;
			const publishedKey = JSON.stringify([record.frameUrl, record.title]);
			if (publishedArtifactKeys.has(publishedKey)) continue;
			publishedArtifactKeys.add(publishedKey);
			const artifactLine: z.infer<typeof ArtifactLinkLineSchema> = {
				type: "artifact-link",
				frameUrl: record.frameUrl,
				lineIndex,
			};
			if (record.title !== undefined) artifactLine.title = record.title;
			if (record.path !== undefined) artifactLine.path = record.path;
			if (record.timestamp !== undefined) artifactLine.timestamp = record.timestamp;
			sessionLines.push(artifactLine);
			continue;
		}

		if (record.type === "artifact-comment-monitor" || record.type === "artifact-autoreact-ledger") {
			if (record.type === "artifact-comment-monitor") lastMonitor = record;
			else lastLedger = record;
			if (lastMonitor === undefined) continue;
			const artifacts = artifactWatchEntries(lastMonitor, lastLedger);
			// Both records are re-saved often; only a change in what is watched renders.
			const watchKey = JSON.stringify(artifacts);
			if (watchKey === lastArtifactWatchKey) continue;
			lastArtifactWatchKey = watchKey;
			if (artifacts.length === 0) continue;
			sessionLines.push({type: "artifact-watch", artifacts, lineIndex});
			continue;
		}

		if (record.type === "queue-operation") {
			if (record.reason === "absorbed_mid_turn") {
				for (const key of queuePairingKeys(record.commandUuid, record.deliveryId)) {
					absorbedQueueKeys.add(key);
					const queuedLine = queuedCommandLines.get(key);
					if (queuedLine !== undefined) queuedLine.absorbedMidTurn = true;
				}
			}
			trackQueue(record, lineIndex, queued, delivered, sessionLines);
			continue;
		}

		if (record.type === "attachment") {
			const attachmentLine: z.infer<typeof AttachmentLineSchema> = {
				type: "attachment",
				attachmentJson: JSON.stringify(record.attachment),
				lineIndex,
			};
			if (record.rendered !== undefined) {
				attachmentLine.rendered = record.rendered.map((r) => r.content);
			}
			if (record.renderedInHumanTurn !== undefined) {
				attachmentLine.renderedInHumanTurn = record.renderedInHumanTurn.map((r) => r.content);
			}
			if (record.renderedRole !== undefined) attachmentLine.renderedRole = record.renderedRole;
			if (record.attachment.type === "queued_command") {
				const keys = queuePairingKeys(record.attachment.source_uuid, record.attachment.delivery_id);
				if (keys.some((key) => absorbedQueueKeys.has(key))) attachmentLine.absorbedMidTurn = true;
				else for (const key of keys) queuedCommandLines.set(key, attachmentLine);
				const humanPrompt = humanQueuedPrompt(record.attachment);
				if (humanPrompt !== null) attachmentLine.humanPrompt = humanPrompt;
			}
			if (record.attachment.type === "deferred_tools_delta" && record.attachment.surfacedDefinitions) {
				const descriptions = new Map<string, string | undefined>();
				const sameAsDescriptions: Record<string, string> = {};
				for (const tool of record.attachment.surfacedDefinitions) {
					const description =
						"definition" in tool
							? tool.definition.description
							: surfacedDescriptions.get(tool.sameAs)?.get(tool.name);
					descriptions.set(tool.name, description);
					if ("sameAs" in tool && description !== undefined) sameAsDescriptions[tool.name] = description;
				}
				if (uuid !== undefined) surfacedDescriptions.set(uuid, descriptions);
				if (Object.keys(sameAsDescriptions).length > 0) attachmentLine.sameAsDescriptions = sameAsDescriptions;
			}
			const refreshed = record.attachment;
			if (
				(refreshed.type === "instructions" || refreshed.type === "session_context") &&
				refreshed.changed === true
			) {
				attachmentLine.contextRefresh =
					refreshed.reason === undefined
						? {subject: refreshed.type}
						: {subject: refreshed.type, reason: refreshed.reason};
			}
			if (uuid !== undefined) attachmentLine.uuid = uuid;
			if (record.timestamp !== undefined) attachmentLine.timestamp = record.timestamp;
			if (sessionId !== undefined) attachmentLine.sessionId = sessionId;
			sessionLines.push(attachmentLine);
			continue;
		}

		if (record.type === "system") {
			if (record.subtype === "informational") {
				// A preventContinuation stop is a prompt_stopped notice; a block or any other preventContinuation
				// record is a prompt-blocked card; the rest are plain notices.
				const content = record.content;
				const preventContinuation = record.preventContinuation === true;
				if (typeof content !== "string" || record.isSidechain === true) continue;
				const text = stripAnsi(content);
				const parsedHook = parseHookMessage(text);
				if (preventContinuation && parsedHook?.kind === "stopped") {
					if (!repeatsUserText(sessionLines.findLast(isEntryLine), text.trim())) {
						const message: HookNoticeMessage =
							parsedHook.reason === ""
								? {notice: "prompt_stopped"}
								: {notice: "prompt_stopped", reason: parsedHook.reason};
						const notice: HookNotice = {message, level: "warning"};
						if (uuid !== undefined) notice.uuid = uuid;
						pushHookNotice(notice, lineIndex, record.timestamp);
					}
					continue;
				}
				if (preventContinuation || parsedHook?.kind === "blocked") {
					const blocked = promptBlockedLine(text, lineIndex);
					if (uuid !== undefined) blocked.uuid = uuid;
					if (record.timestamp !== undefined) blocked.timestamp = record.timestamp;
					sessionLines.push(blocked);
					continue;
				}
				const notice = hookNotice(text, record.level, uuid);
				if (notice !== null) pushHookNotice(notice, lineIndex, record.timestamp);
				continue;
			}
			if (record.subtype !== undefined && NOTICE_SUBTYPES.has(record.subtype)) {
				const notice = record.isSidechain === true ? null : subtypeNotice(record);
				if (notice !== null) pushHookNotice(notice, lineIndex, record.timestamp);
				continue;
			}
			const subtype = RenderedSystemSubtypeSchema.safeParse(record.subtype);
			if (!subtype.success) continue;
			// The input-echo half of a local command carries no commandRun; the
			// output half names the command, so render only that one.
			if (subtype.data === "local_command" && record.commandRun === undefined) continue;
			const systemLine: z.infer<typeof SystemLineSchema> = {
				type: "system",
				subtype: subtype.data,
				lineIndex,
			};
			if (record.content !== undefined) systemLine.content = record.content;
			if (record.compactMetadata !== undefined) systemLine.compactMetadata = record.compactMetadata;
			if (record.hookCount !== undefined) systemLine.hookCount = record.hookCount;
			if (record.hookInfos !== undefined) systemLine.hookInfos = record.hookInfos;
			if (record.hookErrors !== undefined) systemLine.hookErrors = record.hookErrors;
			if (record.hookAdditionalContext !== undefined) {
				systemLine.hookAdditionalContext = record.hookAdditionalContext;
			}
			if (record.preventedContinuation !== undefined) {
				systemLine.preventedContinuation = record.preventedContinuation;
			}
			if (record.retryAttempt !== undefined) systemLine.retryAttempt = record.retryAttempt;
			if (record.retryInMs !== undefined) systemLine.retryInMs = record.retryInMs;
			if (record.maxRetries !== undefined) systemLine.maxRetries = record.maxRetries;
			if (record.pendingBackgroundAgentCount !== undefined) {
				systemLine.pendingBackgroundAgentCount = record.pendingBackgroundAgentCount;
			}
			if (record.durationMs !== undefined) systemLine.durationMs = record.durationMs;
			if (record.error !== undefined) systemLine.error = record.error;
			if (record.taskId !== undefined) systemLine.taskId = record.taskId;
			if (record.cron !== undefined) systemLine.cron = record.cron;
			if (record.prompt !== undefined) systemLine.prompt = record.prompt;
			if (record.taskKind !== undefined) systemLine.taskKind = record.taskKind;
			if (record.cronKind !== undefined) systemLine.cronKind = record.cronKind;
			if (record.noOpStreak !== undefined) systemLine.noOpStreak = record.noOpStreak;
			if (record.commandRun !== undefined) systemLine.commandRun = record.commandRun;
			if (record.url !== undefined) systemLine.url = record.url;
			if (record.originalModel !== undefined) systemLine.originalModel = record.originalModel;
			if (typeof record.requestId === "string") systemLine.requestId = record.requestId;
			if (typeof record.apiRefusalCategory === "string")
				systemLine.apiRefusalCategory = record.apiRefusalCategory;
			if (typeof record.apiRefusalExplanation === "string") {
				systemLine.apiRefusalExplanation = record.apiRefusalExplanation;
			}
			if (uuid !== undefined) systemLine.uuid = uuid;
			if (record.timestamp !== undefined) systemLine.timestamp = record.timestamp;
			if (sessionId !== undefined) systemLine.sessionId = sessionId;
			sessionLines.push(systemLine);
			continue;
		}

		if (record.type === "worktree-state") {
			const ws = record.worktreeSession;
			if (ws === undefined || ws === null) continue;
			if (ws.worktreeBranch === undefined) continue;
			// Worktree state is re-emitted on every prompt; only render changes.
			const worktreeKey = JSON.stringify([
				ws.worktreeName,
				ws.worktreeBranch,
				ws.originalBranch,
				ws.originalHeadCommit,
				ws.originalCwd,
				ws.enteredExisting,
			]);
			if (worktreeKey === lastWorktreeKey) continue;
			lastWorktreeKey = worktreeKey;
			const worktreeLine: z.infer<typeof WorktreeLineSchema> = {
				type: "worktree",
				worktreeName: ws.worktreeName,
				worktreeBranch: ws.worktreeBranch,
				originalCwd: ws.originalCwd,
				lineIndex,
			};
			if (ws.originalBranch !== undefined) worktreeLine.originalBranch = ws.originalBranch;
			if (ws.originalHeadCommit !== undefined) {
				worktreeLine.originalHeadCommit = ws.originalHeadCommit;
			}
			if (ws.enteredExisting !== undefined) worktreeLine.enteredExisting = ws.enteredExisting;
			sessionLines.push(worktreeLine);
			continue;
		}

		// Only include user/assistant lines for the rendering tree
		if (record.type !== "user" && record.type !== "assistant") continue;

		const processedLine: MessageProcessedLine = {
			type: record.type,
			lineIndex,
		};
		if (uuid !== undefined) processedLine.uuid = uuid;
		if (sessionId !== undefined) processedLine.sessionId = sessionId;
		if (typeof record.parentUuid === "string") processedLine.parentUuid = record.parentUuid;
		if (record.timestamp !== undefined) processedLine.timestamp = record.timestamp;
		if (typeof record.userType === "string") processedLine.userType = record.userType;
		if (record.type === "user") {
			if (record.isMeta === true) processedLine.isMeta = true;
			if (record.isCompactSummary === true) processedLine.isCompactSummary = true;
			if (record.isVisibleInTranscriptOnly === true) processedLine.isVisibleInTranscriptOnly = true;
			if (record.promptSource !== undefined && record.promptSource !== "typed") {
				processedLine.promptSource = record.promptSource;
			}
			if (record.queuePriority !== undefined) {
				processedLine.queuePriority = record.queuePriority;
			}
			if (record.turnOrigin !== undefined && record.turnOrigin !== "human") {
				processedLine.turnOrigin = record.turnOrigin;
			}
			if (record.scheduledTaskId !== undefined) {
				processedLine.scheduledTaskId = record.scheduledTaskId;
			}
			if (record.wakeupSource !== undefined) {
				processedLine.wakeupSource = record.wakeupSource;
			}
			const queueOrigin = record.queueOrigin;
			if (queueOrigin?.source === "artifact-watch-lifecycle" && queueOrigin.watchEnded === true) {
				processedLine.artifactWatchEnded = queueOrigin.displayName;
			}
			const classifier = record.serverClassifierContext?.context;
			if (classifier !== undefined) {
				const context: NonNullable<MessageProcessedLine["classifierContext"]> = {};
				if (classifier.live_cwd !== undefined) context.liveCwd = classifier.live_cwd;
				const branch = classifier.git_state?.branch;
				if (typeof branch === "string") context.branch = branch;
				if (classifier.platform !== undefined) context.platform = classifier.platform;
				processedLine.classifierContext = context;
			}
		}
		if (record.type === "assistant") {
			const refused = record.message.stop_reason === "refusal";
			if (record.isApiErrorMessage === true || refused) {
				if (record.requestId !== undefined) processedLine.requestId = record.requestId;
				// A synthetic refusal's own id is a uuid; the withheld message's id is the one upstream names.
				const messageId = refused ? (record.refusedMessageId ?? record.message.id) : record.message.id;
				if (messageId !== undefined) processedLine.messageId = messageId;
			}
			if (record.isApiErrorMessage === true) {
				processedLine.isApiErrorMessage = true;
				if (typeof record.error === "string") processedLine.apiErrorCode = record.error;
			}
			// The Request disclosure rides on its request's first line, so a record that never renders (the empty
			// thinking block a `thinkingDisplay: "updates"` request opens with) leaves the ref to the next one.
			const {requestRef} = record;
			if (requestRef !== lastRequestRef && (requestRef === undefined || !isInvisibleThinkingRecord(record))) {
				if (requestRef !== undefined) processedLine.requestRef = requestRef;
				lastRequestRef = requestRef;
			}
			if (record.apiErrorStatus !== undefined) processedLine.apiErrorStatus = record.apiErrorStatus;
			if (record.errorDetails !== undefined) processedLine.errorDetails = record.errorDetails;
			const limitInfo = record.apiErrorParams?.rate_limit_info ?? record.quotaLimits;
			if (limitInfo !== undefined) {
				processedLine.usageLimit = {
					resetsAt: limitInfo.resetsAt,
					rateLimitType: limitInfo.rateLimitType,
					overageStatus: limitInfo.overageStatus,
					overageDisabledReason: limitInfo.overageDisabledReason,
					isUsingOverage: limitInfo.isUsingOverage,
				};
			}
			const stopReason = record.message.stop_reason;
			if (stopReason === "max_tokens" || stopReason === "refusal") processedLine.stopReason = stopReason;
			if (record.message.usage !== undefined) processedLine.usage = record.message.usage;
			if (typeof record.perTurnEffort === "string") {
				processedLine.perTurnEffort = record.perTurnEffort;
			}
			if (record.advisorModel !== undefined) processedLine.advisorModel = record.advisorModel;
			const actualModel = record.message.model;
			if (
				record.requestedModel !== undefined &&
				typeof actualModel === "string" &&
				formatModelName(record.requestedModel) !== formatModelName(actualModel)
			) {
				processedLine.modelMismatch = {requested: record.requestedModel, actual: actualModel};
			}
			if (record.thinkingDurationMs !== undefined) processedLine.thinkingDurationMs = record.thinkingDurationMs;
			if (record.thinkingDisplay === "omitted") processedLine.thinkingOmitted = true;
			// Attribution repeats on every turn of a skill/MCP block; only carry it
			// onto the first line of each run so the UI shows one pill per block.
			const attributionKey = JSON.stringify([
				record.attributionSkill,
				record.attributionPlugin,
				record.attributionMcpServer,
				record.attributionMcpTool,
			]);
			if (attributionKey !== lastAttributionKey) {
				lastAttributionKey = attributionKey;
				if (record.attributionSkill !== undefined) {
					processedLine.attributionSkill = record.attributionSkill;
				}
				if (record.attributionPlugin !== undefined) {
					processedLine.attributionPlugin = record.attributionPlugin;
				}
				if (record.attributionMcpServer !== undefined) {
					processedLine.attributionMcpServer = record.attributionMcpServer;
				}
				if (record.attributionMcpTool !== undefined) {
					processedLine.attributionMcpTool = record.attributionMcpTool;
				}
			}
		}
		// The Zod-parsed message uses the ContentBlock type directly --
		// no intermediate serialization type needed.
		processedLine.message = record.message as MessageProcessedLine["message"];
		if (invalidToolInputIds !== undefined) processedLine.invalidToolInputIds = invalidToolInputIds;

		sessionLines.push(processedLine);
	}

	return {
		sessionLines: deduplicateCommandGroups(
			delivered.size === 0 ? sessionLines : sessionLines.filter((line) => !delivered.has(line)),
			onFold,
		),
		toolResults,
		title,
		customTitle,
		sessionOwner,
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process raw JSONL records into rendering data.
 *
 * Takes the raw JSON objects from the transcript API and returns everything
 * the renderer needs: lines, toolResultMap, uuidToLine, title, customTitle.
 *
 * @param startLineIndex - JSONL record index of `records[0]`. The transcript
 *   endpoint serves a window over the tail of the file, so pass the window's
 *   `startIndex` to keep every `lineIndex` session-absolute. Message anchors
 *   are built from `lineIndex`, and an anchor has to survive the window
 *   boundary moving as the session grows.
 * @param chain - The served active chain. Hidden records are skipped, not
 *   removed, so the visible rows keep their raw index. Omit it to render the
 *   raw file.
 */
export function processTranscript(records: unknown[], startLineIndex = 0, chain?: ServedChain): ProcessedTranscript {
	return drainSteps(processTranscriptSteps(records, startLineIndex, chain));
}

/**
 * `processTranscript` as a generator that pauses every few dozen records. Drive
 * it with `runCooperatively` to process a huge transcript without blocking the
 * server's event loop; the result is identical to `processTranscript`'s.
 */
export function* processTranscriptSteps(
	records: unknown[],
	startLineIndex = 0,
	chain?: ServedChain,
	onFold?: CommandGroupFoldObserver,
): Generator<void, ProcessedTranscript, void> {
	const uuidToLine = new Map<string, number>();
	const {sessionLines, toolResults, title, customTitle, sessionOwner} = yield* processRecordBatchSteps(
		records,
		startLineIndex,
		uuidToLine,
		chain?.hidden,
		onFold,
	);
	// The served cuts grouped by the prompt that replaced them, keeping served order.
	const cutsByReplacement = new Map<string, TranscriptCut[]>();
	for (const cut of chain?.cuts ?? []) {
		const group = cutsByReplacement.get(cut.replacementUuid);
		if (group === undefined) cutsByReplacement.set(cut.replacementUuid, [cut]);
		else group.push(cut);
	}
	return {
		lines: sessionLines,
		toolResultMap: toolResults,
		uuidToLine,
		title,
		customTitle,
		sessionOwner,
		cutsByReplacement,
	};
}

/**
 * Process new JSONL records incrementally for SSE appends.
 *
 * Same processing logic as processTranscript but returns data shaped for
 * merging into existing state.
 *
 * @param records - Raw JSON objects from the SSE event
 * @param startIndex - The JSONL line index to start counting from
 */
export function processNewRecords(records: unknown[], startIndex: number): IncrementalResult {
	const {sessionLines, toolResults} = processRecordBatch(records, startIndex);
	return {
		newSessionLines: sessionLines,
		newToolResults: toolResults,
	};
}
