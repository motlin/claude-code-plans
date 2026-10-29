import {PersistentAllowKindSchema} from "./permission-suggestions";
import {z} from "zod";
import {SessionSummaryStateSchema} from "./api/sessions";
import type {
	HookBackgroundTaskPayload,
	HookSessionCronPayload,
	MemorySummaryPayload,
	NotificationEntryPayload,
	PendingApprovalPayload,
	PlanSummaryPayload,
	SessionSummaryPayload,
} from "./hook-events";
import type {LiveSubagentNode} from "./live-subagent-store";
import {JsonValueSchema} from "./json-value-schema";
import {PrStatusSchema} from "./pr-status";
import {RemoteControlStateSchema, SessionBucketSchema} from "./session-state";

/*
 * Client-side validators for the SSE domain-event payloads the server builds from the
 * `hook-events` interfaces, so the browser narrows parsed JSON instead of asserting it.
 */

export const SessionSummaryPayloadSchema: z.ZodType<SessionSummaryPayload> = z
	.strictObject({
		id: z.string(),
		title: z.string(),
		summary: z.string().optional(),
		aiTitle: z.string().exactOptional(),
		mtime: z.string(),
		created: z.string(),
		project: z.string(),
		projectName: z.string(),
		messageCount: z.number(),
		gitBranch: z.string().optional(),
		pr: z.strictObject({number: z.number(), url: z.string(), repository: z.string()}).exactOptional(),
		prStatus: PrStatusSchema.exactOptional(),
		forkedFromSessionId: z.string().exactOptional(),
		archived: z.boolean(),
		remoteControl: z.literal(true).exactOptional(),
		remoteControlState: RemoteControlStateSchema.exactOptional(),
		terminalHost: z.string().exactOptional(),
		state: SessionSummaryStateSchema,
		awaitingPermission: z.literal(true).exactOptional(),
		processStartedAt: z.number().exactOptional(),
		bucket: SessionBucketSchema,
		liveAgentCount: z.number(),
		unseen: z.boolean(),
		blockedSince: z.string().nullable(),
	})
	// JSON drops the interface's explicitly-undefined `summary` and `gitBranch`; restore the keys.
	.transform(({summary, gitBranch, ...rest}) => ({...rest, summary, gitBranch}));

/** The tools whose unanswered call leaves a session waiting on the user (src/lib/pending-approvals.ts). */
export const PendingApprovalToolNameSchema = z.enum(["ExitPlanMode", "AskUserQuestion"]);

export const PendingApprovalPayloadSchema: z.ZodType<PendingApprovalPayload> = z.strictObject({
	sessionId: z.string(),
	projectId: z.string(),
	projectName: z.string(),
	toolName: PendingApprovalToolNameSchema,
	toolUseId: z.string(),
	blockedSince: z.string(),
	planFilename: z.string().nullable(),
	questionPreview: z.string().nullable(),
	questionOptions: z.array(z.string()),
});

export const PlanSummaryPayloadSchema: z.ZodType<PlanSummaryPayload> = z.strictObject({
	filename: z.string(),
	title: z.string(),
	mtime: z.string(),
});

export const MemorySummaryPayloadSchema: z.ZodType<MemorySummaryPayload> = z.strictObject({
	filename: z.string(),
	title: z.string(),
	mtime: z.string(),
	project: z.string(),
	projectName: z.string(),
});

export const NotificationEntryPayloadSchema: z.ZodType<NotificationEntryPayload> = z
	.strictObject({
		id: z.string(),
		sessionId: z.string(),
		projectId: z.string(),
		projectName: z.string(),
		message: z.string(),
		title: z.string().optional(),
		notificationType: z.string(),
		persistentAllow: PersistentAllowKindSchema.optional(),
		createdAt: z.number(),
		createdAtIso: z.string(),
	})
	// JSON drops the interface's explicitly-undefined `title`; restore the key.
	.transform(({title, ...rest}) => ({...rest, title}));

export const LiveSubagentNodeSchema: z.ZodType<LiveSubagentNode> = z.strictObject({
	agentId: z.string(),
	sessionId: z.string(),
	parentAgentId: z.string().nullable(),
	agentType: z.string(),
	description: z.string(),
	startedAt: z.string(),
	endedAt: z.string().nullable(),
});

export const HookBackgroundTaskPayloadSchema: z.ZodType<HookBackgroundTaskPayload> = z.strictObject({
	id: z.string(),
	type: z.string(),
	status: z.string(),
	description: z.string(),
	command: z.string().exactOptional(),
	agentType: z.string().exactOptional(),
	server: z.string().exactOptional(),
	tool: z.string().exactOptional(),
	name: z.string().exactOptional(),
});

export const HookSessionCronPayloadSchema: z.ZodType<HookSessionCronPayload> = z.strictObject({
	id: z.string(),
	schedule: z.string(),
	recurring: z.boolean(),
	prompt: z.string(),
});

/**
 * An MCP elicitation a session waits on, kept from its `Elicitation` hook until
 * the matching `ElicitationResult` or the turn ends. `mode` is "form" when the
 * hook omitted it (the MCP default); `requestedSchema` is the server's JSON Schema.
 */
export const PendingElicitationSchema = z.strictObject({
	elicitationId: z.string().optional(),
	serverName: z.string(),
	message: z.string(),
	mode: z.enum(["form", "url"]),
	url: z.string().optional(),
	requestedSchema: JsonValueSchema.optional(),
	receivedAt: z.number(),
});
export type PendingElicitation = z.infer<typeof PendingElicitationSchema>;

/** Payload broadcast when a session's pending elicitations change; the full list, oldest first. */
export const SessionElicitationChangedPayloadSchema = z.strictObject({
	sessionId: z.string(),
	pendingElicitations: z.array(PendingElicitationSchema),
});
export type SessionElicitationChangedPayload = z.infer<typeof SessionElicitationChangedPayloadSchema>;
