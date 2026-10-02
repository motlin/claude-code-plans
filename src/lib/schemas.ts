import {z} from "zod";
import {isMcpTool, toolInputSchemas} from "./tool-input-schemas";

// ---------------------------------------------------------------------------
// JSON value
// ---------------------------------------------------------------------------

/**
 * Recursive schema for any valid JSON value. Used in place of `z.unknown()` for
 * externally-owned API objects (Anthropic `usage`, `container`, etc.) so we
 * assert "valid JSON" (rejecting undefined/functions/symbols) without breaking
 * when the upstream shape gains new fields.
 */
export const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(JsonValueSchema),
		z.record(z.string(), JsonValueSchema),
	]),
);

// ---------------------------------------------------------------------------
// Sessions Index (sessions-index.json)
// ---------------------------------------------------------------------------

export const SessionIndexEntrySchema = z
	.object({
		sessionId: z.string(),
		fullPath: z.string(),
		fileMtime: z.number(),
		firstPrompt: z.string().optional(),
		summary: z.string().optional(),
		messageCount: z.number().optional(),
		created: z.string().optional(),
		modified: z.string().optional(),
		gitBranch: z.string().optional(),
		projectPath: z.string().optional(),
		isSidechain: z.boolean().optional(),
	})
	.strict();

export const SessionsIndexSchema = z
	.object({
		version: z.number(),
		entries: z.array(SessionIndexEntrySchema),
		originalPath: z.string().optional(),
	})
	.strict();

// ---------------------------------------------------------------------------
// Content Blocks (inside user/assistant messages)
// ---------------------------------------------------------------------------

export const TextBlockSchema = z
	.object({
		type: z.literal("text"),
		text: z.string(),
	})
	.strict();

export const ToolUseBlockSchema = z
	.object({
		type: z.literal("tool_use"),
		id: z.string(),
		name: z.string(),
		input: z.record(z.string(), JsonValueSchema),
		caller: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
	})
	.strict();

export const ThinkingBlockSchema = z
	.object({
		type: z.literal("thinking"),
		thinking: z.string(),
		signature: z.string().optional(),
	})
	.strict();

export const ToolResultBlockSchema = z
	.object({
		type: z.literal("tool_result"),
		tool_use_id: z.string(),
		content: z.union([z.string(), z.array(JsonValueSchema)]).optional(),
		is_error: z.boolean().optional(),
	})
	.strict();

const ImageBlockSchema = z
	.object({
		type: z.literal("image"),
		source: z
			.object({
				type: z.string(),
				media_type: z.string(),
				data: z.string(),
			})
			.strict(),
	})
	.strict();

const DocumentBlockSchema = z
	.object({
		type: z.literal("document"),
		source: z
			.object({
				type: z.string(),
				media_type: z.string(),
				data: z.string(),
			})
			.strict(),
	})
	.strict();

export const ContentBlockSchema = z
	.discriminatedUnion("type", [
		TextBlockSchema,
		ToolUseBlockSchema,
		ThinkingBlockSchema,
		ToolResultBlockSchema,
		ImageBlockSchema,
		DocumentBlockSchema,
	])
	.superRefine((block, ctx) => {
		if (block.type !== "tool_use") return;

		const {name, input} = block;

		if (isMcpTool(name)) return;

		const schema = toolInputSchemas[name as keyof typeof toolInputSchemas];
		if (!schema) return;

		const result = schema.safeParse(input);
		if (!result.success) {
			for (const issue of result.error.issues) {
				ctx.addIssue({
					...issue,
					path: ["input", ...issue.path],
				});
			}
		}
	});

// ---------------------------------------------------------------------------
// File-edit tool results (user record `toolUseResult` for Edit/Write/MultiEdit)
// ---------------------------------------------------------------------------

/** One hunk of the `structuredPatch` the file-edit tools report. */
export const StructuredPatchHunkSchema = z
	.object({
		oldStart: z.number(),
		oldLines: z.number(),
		newStart: z.number(),
		newLines: z.number(),
		lines: z.array(z.string()),
	})
	.strict();

/**
 * `originalFile` is the file before the edit; Claude Code writes null when it
 * kept no snapshot (e.g. `contentNotInModelContext`).
 */
const EditToolUseResultSchema = z
	.object({
		filePath: z.string(),
		oldString: z.string(),
		newString: z.string(),
		originalFile: z.union([z.string(), z.null()]).optional(),
		structuredPatch: z.array(StructuredPatchHunkSchema),
		userModified: z.boolean().optional(),
		replaceAll: z.boolean().optional(),
		contentNotInModelContext: z.boolean().optional(),
		memdirStamped: z.boolean().optional(),
		staleRecovered: z.boolean().optional(),
	})
	.strict();

const MultiEditToolUseResultSchema = z
	.object({
		filePath: z.string(),
		edits: z.array(
			z
				.object({
					old_string: z.string(),
					new_string: z.string(),
					replace_all: z.boolean().optional(),
				})
				.strict(),
		),
		originalFileContents: z.union([z.string(), z.null()]).optional(),
		structuredPatch: z.array(StructuredPatchHunkSchema),
		userModified: z.boolean().optional(),
	})
	.strict();

export const WriteToolUseResultTypeSchema = z.enum(["create", "update"]);

/** `originalFile` is null for a created file (and for an unsnapshotted update). */
const WriteToolUseResultSchema = z
	.object({
		type: WriteToolUseResultTypeSchema,
		filePath: z.string(),
		content: z.string(),
		structuredPatch: z.array(StructuredPatchHunkSchema).optional(),
		originalFile: z.union([z.string(), z.null()]).optional(),
		userModified: z.boolean().optional(),
		memdirStamped: z.boolean().optional(),
	})
	.strict();

export const FileEditToolUseResultSchema = z.union([
	WriteToolUseResultSchema,
	EditToolUseResultSchema,
	MultiEditToolUseResultSchema,
]);

// ---------------------------------------------------------------------------
// Bash tool results: `toolUseResult.gitOperation`, the git action Claude Code
// detected in the command (commit, push, rebase/merge, PR).
// ---------------------------------------------------------------------------

export const GitCommitKindSchema = z.enum(["committed", "amended", "cherry-picked"]);
export const GitBranchActionSchema = z.enum(["rebased", "merged"]);
export const GitPrActionSchema = z.enum(["created", "edited", "commented", "ready", "merged", "closed"]);

export const GitOperationSchema = z
	.object({
		commit: z
			.object({sha: z.string(), kind: GitCommitKindSchema, branch: z.string().optional()})
			.strict()
			.optional(),
		push: z.object({branch: z.string()}).strict().optional(),
		branch: z.object({ref: z.string(), action: GitBranchActionSchema}).strict().optional(),
		pr: z.object({number: z.number(), url: z.string().optional(), action: GitPrActionSchema}).strict().optional(),
	})
	.strict();

export type GitOperation = z.infer<typeof GitOperationSchema>;

// ---------------------------------------------------------------------------
// JSONL Record Types
// ---------------------------------------------------------------------------

// Fork lineage stamped on every record of a branched session. Older writers
// used a bare parent session id; the CLI now writes `{sessionId, messageUuid}`.
export const ForkedFromSchema = z.union([
	z.string(),
	z.strictObject({sessionId: z.string(), messageUuid: z.string().optional()}),
]);

// Shared fields present on most JSONL records (user, assistant, progress, system, attachment)
const BaseRecordFields = {
	uuid: z.string().optional(),
	timestamp: z.string().optional(),
	sessionId: z.string().optional(),
	session_id: z.string().optional(),
	parentUuid: z.union([z.string(), z.null()]).optional(),
	isSidechain: z.boolean().optional(),
	userType: z.string().optional(),
	cwd: z.string().optional(),
	gitBranch: z.string().optional(),
	slug: z.string().optional(),
	version: z.string().optional(),
	entrypoint: z.string().optional(),
	forkedFrom: ForkedFromSchema.optional(),
	teamName: z.string().optional(),
	leafUuid: z.string().optional(),
	agentId: z.string().optional(),
	sessionKind: z.string().optional(),
	// Agent type that produced the record, e.g. "Explore" or "git:commit-handler".
	// Written on subagent transcripts only.
	attributionAgent: z.string().optional(),
};

export const PromptSourceSchema = z.enum(["typed", "system", "sdk", "queued", "suggestion_accepted"]);

/** Who started a user turn; `human` is the ordinary typed-at-the-keyboard case. */
export const TurnOriginSchema = z.enum(["human", "peer", "task_notification", "scheduled"]);

const GitRemoteVisibilitySchema = z
	.object({
		name: z.string().optional(),
		host: z.string().optional(),
		remote: z.string().optional(),
		visibility: z.string().optional(),
	})
	.strict();

// Git and platform context the server-side permission classifier saw for a turn.
const ServerClassifierContextSchema = z
	.object({
		request: z.string().optional(),
		context: z
			.object({
				git_state: z
					.object({
						cwd: z.string().optional(),
						root: z.union([z.string(), z.null()]).optional(),
						branch: z.union([z.string(), z.null()]).optional(),
						default_branch: z.union([z.string(), z.null()]).optional(),
						status: z
							.union([
								z
									.object({
										clean: z.boolean().optional(),
										counts: z
											.object({
												staged: z.number().optional(),
												modified: z.number().optional(),
												untracked: z.null().optional(),
												untracked_normal: z.number().optional(),
											})
											.strict()
											.optional(),
										porcelain: z.null().optional(),
										truncated: z.boolean().optional(),
									})
									.strict(),
								z.null(),
							])
							.optional(),
						visibility: z
							.union([
								z
									.object({
										origin: z.union([GitRemoteVisibilitySchema, z.null()]).optional(),
										push_remote: z.union([z.string(), z.null()]).optional(),
										remotes: z.array(GitRemoteVisibilitySchema).optional(),
										visibility_cache: z.array(GitRemoteVisibilitySchema).optional(),
									})
									.strict(),
								z.null(),
							])
							.optional(),
						error: z.string().optional(),
					})
					.strict()
					.optional(),
				live_cwd: z.string().optional(),
				platform: z.string().optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

export const UserRecordSchema = z
	.object({
		type: z.literal("user"),
		...BaseRecordFields,
		message: z
			.object({
				role: z.literal("user"),
				content: z.union([z.string(), z.array(ContentBlockSchema)]),
			})
			.strict(),
		toolUseResult: JsonValueSchema.optional(),
		toolDenialKind: z.string().optional(),
		sourceToolAssistantUUID: z.string().optional(),
		sourceToolUseID: z.string().optional(),
		toolEndsTurn: z.boolean().optional(),
		promptId: z.string().optional(),
		permissionMode: z.string().optional(),
		promptSource: PromptSourceSchema.optional(),
		queuePriority: z.literal("later").optional(),
		imagePasteIds: z.array(z.union([z.string(), z.number()])).optional(),
		isMeta: z.boolean().optional(),
		isCompactSummary: z.boolean().optional(),
		isVisibleInTranscriptOnly: z.boolean().optional(),
		mcpMeta: z.record(z.string(), JsonValueSchema).optional(),
		origin: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
		interruptedMessageId: z.string().optional(),
		interruptedByShutdown: z.boolean().optional(),
		userFeedback: z.string().optional(),
		turnOrigin: TurnOriginSchema.optional(),
		turnPosition: z
			.object({promptIndex: z.number().optional(), turnIndex: z.number().optional()})
			.strict()
			.optional(),
		turnCompanion: z.boolean().optional(),
		queueSkipAttachments: z.boolean().optional(),
		queueTranscriptOnly: z.boolean().optional(),
		scheduledTaskId: z.string().optional(),
		scheduledFireId: z.string().optional(),
		classifierMetaLines: z.string().optional(),
		serverClassifierContext: ServerClassifierContextSchema.optional(),
	})
	.strict();

export const AssistantRecordSchema = z
	.object({
		type: z.literal("assistant"),
		...BaseRecordFields,
		requestId: z.string().optional(),
		effort: z.string().optional(),
		message: z
			.object({
				role: z.literal("assistant"),
				model: z.string().optional(),
				id: z.string().optional(),
				type: z.string().optional(),
				content: z.union([z.string(), z.array(ContentBlockSchema)]),
				stop_reason: z.union([z.string(), z.null()]).optional(),
				stop_sequence: z.union([z.string(), z.null()]).optional(),
				usage: z.record(z.string(), JsonValueSchema).optional(),
				stop_details: z.union([z.record(z.string(), JsonValueSchema), z.null()]).optional(),
				container: z.union([z.record(z.string(), JsonValueSchema), z.null()]).optional(),
				context_management: z.union([z.record(z.string(), JsonValueSchema), z.null()]).optional(),
				diagnostics: z
					.union([z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema), z.null()])
					.optional(),
				input_transformations: z
					.array(
						z
							.object({
								type: z.string(),
								path: z.string().optional(),
								reason: z.string().optional(),
							})
							.strict(),
					)
					.optional(),
				safeguard_results: z
					.array(
						z
							.object({
								type: z.string(),
								status: z
									.object({
										type: z.string(),
										tool_uses: z
											.record(
												z.string(),
												z.object({type: z.string(), outcome: z.string().optional()}).strict(),
											)
											.optional(),
									})
									.strict()
									.optional(),
							})
							.strict(),
					)
					.optional(),
			})
			.strict(),
		isApiErrorMessage: z.boolean().optional(),
		apiErrorStatus: z.union([z.number(), z.string()]).optional(),
		error: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
		attributionSkill: z.string().optional(),
		attributionPlugin: z.string().optional(),
		attributionMcpServer: z.string().optional(),
		attributionMcpTool: z.string().optional(),
		errorDetails: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
		healsDistinctCarrier: z.boolean().optional(),
		isAbortedMidStream: z.boolean().optional(),
		advisorModel: z.string().optional(),
		apiBlockIndex: z.number().optional(),
		perTurnEffort: z.union([z.string(), z.null()]).optional(),
		serverClassifierRequest: z.string().optional(),
		thinkingDurationMs: z.number().optional(),
		truncatedAfterOutput: z.boolean().optional(),
		// Keyed by tool_use id: the working directory each tool call ran in.
		wireIngestContext: z.record(z.string(), z.object({cwd: z.string().optional()}).strict()).optional(),
		// Keyed by tool_use id: the tool input exactly as sent over the wire.
		wireToolInputs: z.record(z.string(), z.record(z.string(), JsonValueSchema)).optional(),
	})
	.strict();

export const CustomTitleRecordSchema = z
	.object({
		type: z.literal("custom-title"),
		customTitle: z.string(),
		sessionId: z.string(),
	})
	.strict();

// `<projectDir>/<sessionId>/custom-title.json`, written by the CLI when a
// session is renamed outside the transcript.
export const CustomTitleSidecarSchema = z
	.object({
		customTitle: z.string(),
	})
	.strict();

export const FileHistorySnapshotSchema = z
	.object({
		type: z.literal("file-history-snapshot"),
		messageId: z.string().optional(),
		isSnapshotUpdate: z.boolean().optional(),
		snapshot: z
			.object({
				messageId: z.string().optional(),
				timestamp: z.string().optional(),
				trackedFileBackups: z.record(z.string(), JsonValueSchema),
			})
			.strict(),
	})
	.strict();

const ForkContextRefRecordSchema = z
	.object({
		type: z.literal("fork-context-ref"),
		agentId: z.string(),
		parentSessionId: z.string(),
		parentLastUuid: z.string(),
		contextLength: z.number().int().nonnegative(),
	})
	.strict();

// ---------------------------------------------------------------------------
// Attachment sub-types (discriminated on attachment.type)
// ---------------------------------------------------------------------------

const PlanModeAttachmentPayload = z
	.object({
		type: z.literal("plan_mode"),
		planFilePath: z.string().optional(),
		reminderType: z.string().optional(),
		isSubAgent: z.boolean().optional(),
		planExists: z.boolean().optional(),
	})
	.strict();

const PlanModeExitAttachmentPayload = z
	.object({
		type: z.literal("plan_mode_exit"),
		planFilePath: z.string().optional(),
		planExists: z.boolean().optional(),
	})
	.strict();

const PlanModeReentryAttachmentPayload = z
	.object({
		type: z.literal("plan_mode_reentry"),
		planFilePath: z.string().optional(),
		planExists: z.boolean().optional(),
	})
	.strict();

// Fields shared by all hook attachment payloads
const HookBaseFields = {
	hookName: z.string(),
	toolUseID: z.string().optional(),
	hookEvent: z.string(),
};

const HookSuccessAttachmentPayload = z
	.object({
		type: z.literal("hook_success"),
		...HookBaseFields,
		content: z.string().optional(),
		stdout: z.string().optional(),
		stderr: z.string().optional(),
		exitCode: z.number().optional(),
		command: z.string().optional(),
		durationMs: z.number().optional(),
	})
	.strict();

const HookNonBlockingErrorAttachmentPayload = z
	.object({
		type: z.literal("hook_non_blocking_error"),
		...HookBaseFields,
		stderr: z.string().optional(),
		stdout: z.string().optional(),
		exitCode: z.number().optional(),
		command: z.string().optional(),
		durationMs: z.number().optional(),
	})
	.strict();

const HookBlockingErrorAttachmentPayload = z
	.object({
		type: z.literal("hook_blocking_error"),
		...HookBaseFields,
		blockingError: z.record(z.string(), JsonValueSchema).optional(),
		command: z.string().optional(),
		durationMs: z.number().optional(),
	})
	.strict();

const HookCancelledAttachmentPayload = z
	.object({
		type: z.literal("hook_cancelled"),
		...HookBaseFields,
		command: z.string().optional(),
		durationMs: z.number().optional(),
		timedOut: z.boolean().optional(),
		timeoutMs: z.number().optional(),
	})
	.strict();

const HookSystemMessageAttachmentPayload = z
	.object({
		type: z.literal("hook_system_message"),
		...HookBaseFields,
		content: z.union([z.string(), z.array(JsonValueSchema)]).optional(),
	})
	.strict();

const HookAdditionalContextAttachmentPayload = z
	.object({
		type: z.literal("hook_additional_context"),
		...HookBaseFields,
		content: z.union([z.string(), z.array(JsonValueSchema)]).optional(),
	})
	.strict();

const AsyncHookResponseAttachmentPayload = z
	.object({
		type: z.literal("async_hook_response"),
		processId: z.string(),
		hookName: z.string(),
		hookEvent: z.string(),
		response: z.record(z.string(), JsonValueSchema).optional(),
		stdout: z.string().optional(),
		stderr: z.string().optional(),
		exitCode: z.number().optional(),
	})
	.strict();

const DeferredToolsDeltaAttachmentPayload = z
	.object({
		type: z.literal("deferred_tools_delta"),
		addedNames: z.array(z.string()).optional(),
		addedLines: z.array(z.string()).optional(),
		removedNames: z.array(z.string()).optional(),
		readdedNames: z.array(z.string()).optional(),
		pendingMcpServers: z.array(z.string()).optional(),
		needsAuthMcpServers: z.array(z.string()).optional(),
		wireHiddenNames: z.array(z.string()).optional(),
		surfacedNames: z.array(z.string()).optional(),
		restoredNames: z.array(z.string()).optional(),
		retractedTools: z.array(z.object({name: z.string(), cause: z.string().optional()}).strict()).optional(),
		failedMcpServers: z
			.array(
				z
					.object({
						name: z.string(),
						errorCode: z.string().optional(),
						error: z.string().optional(),
					})
					.strict(),
			)
			.optional(),
	})
	.strict();

const AgentListingDeltaAttachmentPayload = z
	.object({
		type: z.literal("agent_listing_delta"),
		addedTypes: z.array(z.string()).optional(),
		addedLines: z.array(z.string()).optional(),
		removedTypes: z.array(z.string()).optional(),
		builtInTypes: z.array(z.string()).optional(),
		isInitial: z.boolean().optional(),
		showConcurrencyNote: z.boolean().optional(),
	})
	.strict();

const McpInstructionsDeltaAttachmentPayload = z
	.object({
		type: z.literal("mcp_instructions_delta"),
		addedNames: z.array(z.string()).optional(),
		addedBlocks: z.array(z.string()).optional(),
		removedNames: z.array(z.string()).optional(),
	})
	.strict();

const SkillListingAttachmentPayload = z
	.object({
		type: z.literal("skill_listing"),
		content: z.string().optional(),
		skillCount: z.number().optional(),
		isInitial: z.boolean().optional(),
		names: z.array(z.string()).optional(),
	})
	.strict();

const DynamicSkillAttachmentPayload = z
	.object({
		type: z.literal("dynamic_skill"),
		skillDir: z.string().optional(),
		skillNames: z.array(z.string()).optional(),
		displayPath: z.string().optional(),
	})
	.strict();

// Fields shared by task/todo reminder payloads
const ReminderBaseFields = {
	content: z.union([z.string(), z.array(JsonValueSchema)]).optional(),
	itemCount: z.number().optional(),
};

const TaskReminderAttachmentPayload = z.object({type: z.literal("task_reminder"), ...ReminderBaseFields}).strict();

const TaskStatusAttachmentPayload = z
	.object({
		type: z.literal("task_status"),
		taskId: z.string(),
		taskType: z.string().optional(),
		description: z.string().optional(),
		status: z.string(),
		deltaSummary: z.union([z.string(), z.null()]).optional(),
		outputFilePath: z.string().optional(),
		shell: z
			.object({
				command: z.string().optional(),
				kind: z.string().optional(),
				toolUseId: z.string().optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

const TodoReminderAttachmentPayload = z.object({type: z.literal("todo_reminder"), ...ReminderBaseFields}).strict();

const TotalTokensReminderAttachmentPayload = z
	.object({
		type: z.literal("total_tokens_reminder"),
		text: z.string(),
	})
	.strict();

const EditedTextFileAttachmentPayload = z
	.object({
		type: z.literal("edited_text_file"),
		filename: z.string(),
		snippet: z.string().optional(),
		displayPath: z.string().optional(),
	})
	.strict();

const FileAttachmentPayload = z
	.object({
		type: z.literal("file"),
		filename: z.string(),
		content: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
		displayPath: z.string().optional(),
		readNotes: z.object({memoryNote: z.string().optional()}).strict().optional(),
	})
	.strict();

const AlreadyReadFileAttachmentPayload = z
	.object({
		type: z.literal("already_read_file"),
		filename: z.string(),
		content: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
		displayPath: z.string().optional(),
	})
	.strict();

const DirectoryAttachmentPayload = z
	.object({
		type: z.literal("directory"),
		path: z.string().optional(),
		content: z.string().optional(),
		displayPath: z.string().optional(),
	})
	.strict();

const CompactFileReferenceAttachmentPayload = z
	.object({
		type: z.literal("compact_file_reference"),
		filename: z.string().optional(),
		displayPath: z.string().optional(),
	})
	.strict();

const ReadTruncationNoticeAttachmentPayload = z
	.object({
		type: z.literal("read_truncation_notice"),
		banner: z.string(),
		toolUseID: z.string().optional(),
	})
	.strict();

const DateChangeAttachmentPayload = z
	.object({
		type: z.literal("date_change"),
		newDate: z.string(),
	})
	.strict();

const CommandPermissionsAttachmentPayload = z
	.object({
		type: z.literal("command_permissions"),
		allowedTools: z.array(JsonValueSchema).optional(),
		model: z.string().optional(),
	})
	.strict();

const DiagnosticsAttachmentPayload = z
	.object({
		type: z.literal("diagnostics"),
		files: z.array(JsonValueSchema).optional(),
		isNew: z.boolean().optional(),
	})
	.strict();

const QueuedCommandAttachmentPayload = z
	.object({
		type: z.literal("queued_command"),
		prompt: z.union([z.string(), z.array(JsonValueSchema)]).optional(),
		commandMode: z.string().optional(),
		imagePasteIds: z.array(z.union([z.string(), z.number()])).optional(),
		origin: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
		timestamp: z.string().optional(),
		isMeta: z.boolean().optional(),
		source_uuid: z.string().optional(),
		delivery_id: z.string().optional(),
		reminderId: z.string().optional(),
		humanTurn: z.boolean().optional(),
		usage: z
			.object({
				totalTokens: z.number().optional(),
				toolUses: z.number().optional(),
				durationMs: z.number().optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

const SelectedLinesInIdeAttachmentPayload = z
	.object({
		type: z.literal("selected_lines_in_ide"),
		ideName: z.string().optional(),
		lineStart: z.number().optional(),
		lineEnd: z.number().optional(),
		filename: z.string().optional(),
		content: z.string().optional(),
		displayPath: z.string().optional(),
	})
	.strict();

const OpenedFileInIdeAttachmentPayload = z
	.object({
		type: z.literal("opened_file_in_ide"),
		filename: z.string().optional(),
	})
	.strict();

const CompanionIntroAttachmentPayload = z
	.object({
		type: z.literal("companion_intro"),
		name: z.string().optional(),
		species: z.string().optional(),
	})
	.strict();

const InvokedSkillsAttachmentPayload = z
	.object({
		type: z.literal("invoked_skills"),
		skills: z.array(JsonValueSchema).optional(),
	})
	.strict();

const UltrathinkEffortAttachmentPayload = z
	.object({
		type: z.literal("ultrathink_effort"),
		level: z.string().optional(),
	})
	.strict();

const MaxTurnsReachedAttachmentPayload = z
	.object({
		type: z.literal("max_turns_reached"),
		maxTurns: z.number().optional(),
		turnCount: z.number().optional(),
	})
	.strict();

const AutoModeAttachmentPayload = z
	.object({
		type: z.literal("auto_mode"),
		reminderType: z.string().optional(),
		autoModeConsentFlow: z.boolean().optional(),
		bashFirst: z.boolean().optional(),
		steerOnly: z.boolean().optional(),
		bypass: z.boolean().optional(),
		bashFirstSteer: z.string().optional(),
	})
	.strict();

const WorkflowKeywordRequestAttachmentPayload = z
	.object({
		type: z.literal("workflow_keyword_request"),
	})
	.strict();

const AutoModeExitAttachmentPayload = z
	.object({
		type: z.literal("auto_mode_exit"),
		bashFirst: z.boolean().optional(),
		steerOnly: z.boolean().optional(),
	})
	.strict();

const PlanFileReferenceAttachmentPayload = z
	.object({
		type: z.literal("plan_file_reference"),
		planFilePath: z.string().optional(),
		planContent: z.string().optional(),
	})
	.strict();

const NestedMemoryAttachmentPayload = z
	.object({
		type: z.literal("nested_memory"),
		path: z.string().optional(),
		content: z.record(z.string(), JsonValueSchema).optional(),
		displayPath: z.string().optional(),
	})
	.strict();

const TeamContextAttachmentPayload = z
	.object({
		type: z.literal("team_context"),
		agentId: z.string().optional(),
		agentName: z.string().optional(),
		teamName: z.string().optional(),
		teamConfigPath: z.string().optional(),
		taskListPath: z.string().optional(),
		hasTaskListTools: z.boolean().optional(),
	})
	.strict();

const ToolDefinitionSchema = z
	.object({
		name: z.string(),
		description: z.string().optional(),
		input_schema: z.record(z.string(), JsonValueSchema).optional(),
		eager_input_streaming: z.boolean().optional(),
		defer_loading: z.boolean().optional(),
	})
	.strict();

const BashOutputAudienceNoteAttachmentPayload = z
	.object({
		type: z.literal("bash_output_audience_note"),
		toolUseID: z.string().optional(),
	})
	.strict();

const BatchingReminderSentAttachmentPayload = z
	.object({
		type: z.literal("batching_reminder_sent"),
		text: z.string().optional(),
		model: z.string().optional(),
		clearAt: z.string().optional(),
	})
	.strict();

const CredentialOrgAttachmentPayload = z
	.object({
		type: z.literal("credential_org"),
		organizationUuid: z.string().optional(),
	})
	.strict();

const DateAttachmentPayload = z
	.object({
		type: z.literal("date"),
		date: z.string().optional(),
		changed: z.boolean().optional(),
	})
	.strict();

const DeferredToolsRecordAttachmentPayload = z
	.object({
		type: z.literal("deferred_tools_record"),
		entries: z.array(ToolDefinitionSchema).optional(),
		toolInputCopies: z.array(z.object({id: z.string(), copy: z.string().optional()}).strict()).optional(),
		nameOnlyAnnouncements: z.array(z.string()).optional(),
	})
	.strict();

const EnvironmentAttachmentPayload = z
	.object({
		type: z.literal("environment"),
		snapshot: z
			.object({
				workingDirectory: z.string().optional(),
				isWorktree: z.boolean().optional(),
				isGitRepo: z.boolean().optional(),
				additionalWorkingDirectories: z.array(z.string()).optional(),
				platform: z.string().optional(),
				shell: z.string().optional(),
				osVersion: z.string().optional(),
				scratchpadDirectory: z.string().optional(),
			})
			.strict()
			.optional(),
		changes: z
			.array(
				z
					.object({
						field: z.string(),
						from: z.string().optional(),
						added: z.array(z.string()).optional(),
						removed: z.array(z.string()).optional(),
					})
					.strict(),
			)
			.optional(),
	})
	.strict();

const ForkBriefingAttachmentPayload = z
	.object({
		type: z.literal("fork_briefing"),
		text: z.string().optional(),
	})
	.strict();

const HookPermissionDecisionAttachmentPayload = z
	.object({
		type: z.literal("hook_permission_decision"),
		decision: z.string().optional(),
		toolUseID: z.string().optional(),
		hookEvent: z.string().optional(),
	})
	.strict();

const InstructionsAttachmentPayload = z
	.object({
		type: z.literal("instructions"),
		files: z
			.array(
				z
					.object({
						path: z.string(),
						type: z.string().optional(),
						content: z.string().optional(),
					})
					.strict(),
			)
			.optional(),
		changed: z.boolean().optional(),
		reason: z.string().optional(),
		removed: z.array(z.string()).optional(),
	})
	.strict();

const ModelAttachmentPayload = z
	.object({
		type: z.literal("model"),
		identity: z
			.object({
				modelId: z.string().optional(),
				marketingName: z.string().optional(),
				knowledgeCutoff: z.string().optional(),
			})
			.strict()
			.optional(),
		text: z.string().optional(),
	})
	.strict();

const OutputStyleAttachmentPayload = z
	.object({
		type: z.literal("output_style"),
		style: z.string().optional(),
		turnReminder: z.string().optional(),
	})
	.strict();

const OutputStyleInstructionsAttachmentPayload = z
	.object({
		type: z.literal("output_style_instructions"),
		style: z.object({name: z.string().optional(), prompt: z.string().optional()}).strict().optional(),
	})
	.strict();

const PromptSnapshotAttachmentPayload = z
	.object({
		type: z.literal("prompt_snapshot"),
		systemPrompt: z.array(z.string()).optional(),
		reminderFold: z.boolean().optional(),
		echoWireToolInputs: z.boolean().optional(),
		contextRendering: z.string().optional(),
		tools: z
			.array(
				z
					.object({
						name: z.string(),
						description: z.string().optional(),
						schema: z.record(z.string(), JsonValueSchema).optional(),
					})
					.strict(),
			)
			.optional(),
		cliPrefix: z.string().optional(),
		systemTurns: z.boolean().optional(),
		toolChangeHeader: z.boolean().optional(),
		inlineTools: z.boolean().optional(),
		keptReminders: z.boolean().optional(),
		hostPrompt: z.string().optional(),
	})
	.strict();

const RemoteSessionChangeAttachmentPayload = z
	.object({
		type: z.literal("remote_session_change"),
		url: z.union([z.string(), z.null()]).optional(),
		commit: z.string().optional(),
		pr: z.string().optional(),
		sendUserFileHint: z.boolean().optional(),
		managedCommit: z.boolean().optional(),
		managedPr: z.boolean().optional(),
	})
	.strict();

const SessionContextAttachmentPayload = z
	.object({
		type: z.literal("session_context"),
		context: z.object({userEmail: z.string().optional()}).strict().optional(),
	})
	.strict();

const SilentTurnReminderAttachmentPayload = z
	.object({
		type: z.literal("silent_turn_reminder"),
		text: z.string().optional(),
	})
	.strict();

const ThinkingBlockPositionSchema = z
	.object({messageIndex: z.number().optional(), blockIndex: z.number().optional()})
	.strict();

const ThinkingDropAttachmentPayload = z
	.object({
		type: z.literal("thinking_drop"),
		requestId: z.string().optional(),
		model: z.string().optional(),
		querySource: z.string().optional(),
		thinkingBlocksSent: z.number().optional(),
		thinkingTurnsSent: z.number().optional(),
		newlyDropped: z
			.object({
				blockCount: z.number().optional(),
				turnCount: z.number().optional(),
				reason: z.string().optional(),
				first: ThinkingBlockPositionSchema.optional(),
				last: ThinkingBlockPositionSchema.optional(),
				reasonCounts: z.record(z.string(), z.number()).optional(),
			})
			.strict()
			.optional(),
		blockHashes: z.array(z.string()).optional(),
		firstReportForThreadInProcess: z.boolean().optional(),
		clientChange: z
			.object({
				kinds: z.string().optional(),
				firstChangedMessageIndex: z.number().optional(),
				baseline: z.string().optional(),
				callNumber: z.number().optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

const ThinkingStrippedAttachmentPayload = z
	.object({
		type: z.literal("thinking_stripped"),
		scope: z.string().optional(),
	})
	.strict();

export const AttachmentPayloadSchema = z.discriminatedUnion("type", [
	PlanModeAttachmentPayload,
	AutoModeAttachmentPayload,
	AutoModeExitAttachmentPayload,
	PlanFileReferenceAttachmentPayload,
	NestedMemoryAttachmentPayload,
	PlanModeExitAttachmentPayload,
	PlanModeReentryAttachmentPayload,
	HookSuccessAttachmentPayload,
	HookNonBlockingErrorAttachmentPayload,
	HookBlockingErrorAttachmentPayload,
	HookCancelledAttachmentPayload,
	HookSystemMessageAttachmentPayload,
	HookAdditionalContextAttachmentPayload,
	AsyncHookResponseAttachmentPayload,
	DeferredToolsDeltaAttachmentPayload,
	AgentListingDeltaAttachmentPayload,
	McpInstructionsDeltaAttachmentPayload,
	SkillListingAttachmentPayload,
	DynamicSkillAttachmentPayload,
	TaskReminderAttachmentPayload,
	TaskStatusAttachmentPayload,
	TodoReminderAttachmentPayload,
	TotalTokensReminderAttachmentPayload,
	EditedTextFileAttachmentPayload,
	FileAttachmentPayload,
	AlreadyReadFileAttachmentPayload,
	DirectoryAttachmentPayload,
	CompactFileReferenceAttachmentPayload,
	ReadTruncationNoticeAttachmentPayload,
	DateChangeAttachmentPayload,
	CommandPermissionsAttachmentPayload,
	DiagnosticsAttachmentPayload,
	QueuedCommandAttachmentPayload,
	SelectedLinesInIdeAttachmentPayload,
	OpenedFileInIdeAttachmentPayload,
	CompanionIntroAttachmentPayload,
	InvokedSkillsAttachmentPayload,
	UltrathinkEffortAttachmentPayload,
	MaxTurnsReachedAttachmentPayload,
	WorkflowKeywordRequestAttachmentPayload,
	TeamContextAttachmentPayload,
	BashOutputAudienceNoteAttachmentPayload,
	BatchingReminderSentAttachmentPayload,
	CredentialOrgAttachmentPayload,
	DateAttachmentPayload,
	DeferredToolsRecordAttachmentPayload,
	EnvironmentAttachmentPayload,
	ForkBriefingAttachmentPayload,
	HookPermissionDecisionAttachmentPayload,
	InstructionsAttachmentPayload,
	ModelAttachmentPayload,
	OutputStyleAttachmentPayload,
	OutputStyleInstructionsAttachmentPayload,
	PromptSnapshotAttachmentPayload,
	RemoteSessionChangeAttachmentPayload,
	SessionContextAttachmentPayload,
	SilentTurnReminderAttachmentPayload,
	ThinkingDropAttachmentPayload,
	ThinkingStrippedAttachmentPayload,
]);

const RenderedAttachmentContentSchema = z.object({content: z.string()}).strict();

export const RenderedRoleSchema = z.enum(["system", "user"]);

/**
 * Attachment record: uses discriminated union on attachment.type
 * for all the different attachment payloads.
 */
export const AttachmentRecordSchema = z
	.object({
		type: z.literal("attachment"),
		...BaseRecordFields,
		attachment: AttachmentPayloadSchema,
		// The system-reminder text each attachment rendered into the model context.
		rendered: z.array(RenderedAttachmentContentSchema).optional(),
		renderedInHumanTurn: z.array(RenderedAttachmentContentSchema).optional(),
		// Which turn role the rendered text was injected as.
		renderedRole: RenderedRoleSchema.optional(),
		renderedBesideToolResult: z.boolean().optional(),
	})
	.strict();

export const ProgressRecordSchema = z
	.object({
		type: z.literal("progress"),
		...BaseRecordFields,
		data: z.record(z.string(), JsonValueSchema).optional(),
		toolUseID: z.string().optional(),
		parentToolUseID: z.string().optional(),
	})
	.strict();

export const CompactMetadataSchema = z
	.object({
		trigger: z.enum(["auto", "manual"]),
		preTokens: z.number(),
		postTokens: z.number().optional(),
		durationMs: z.number().optional(),
		preCompactDiscoveredTools: z.array(z.string()).optional(),
		preCompactArtifactReadVersions: z.array(z.object({slug: z.string(), ver: z.string()}).strict()).optional(),
		cumulativeDroppedTokens: z.number().optional(),
		preservedSegment: z
			.object({
				headUuid: z.string(),
				anchorUuid: z.string(),
				tailUuid: z.string(),
			})
			.strict()
			.optional(),
		preservedMessages: z
			.object({
				anchorUuid: z.string(),
				uuids: z.array(z.string()),
				allUuids: z.array(z.string()),
			})
			.strict()
			.optional(),
	})
	.strict();

export const SystemRecordSchema = z
	.object({
		type: z.literal("system"),
		...BaseRecordFields,
		subtype: z.string().optional(),
		durationMs: z.number().optional(),
		content: z.string().optional(),
		level: z.string().optional(),
		isMeta: z.boolean().optional(),
		toolUseID: z.string().optional(),
		sourceToolUseID: z.string().optional(),
		hookCount: z.number().optional(),
		hookInfos: z.array(JsonValueSchema).optional(),
		hookErrors: z.array(JsonValueSchema).optional(),
		hookAdditionalContext: z.array(JsonValueSchema).optional(),
		preventedContinuation: z.boolean().optional(),
		preventContinuation: z.boolean().optional(),
		stopReason: z.string().optional(),
		hasOutput: z.boolean().optional(),
		error: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
		messageCount: z.number().optional(),
		pendingBackgroundAgentCount: z.number().optional(),
		pendingWorkflowCount: z.number().optional(),
		promptId: z.string().optional(),
		permissionMode: z.string().optional(),
		logicalParentUuid: z.string().optional(),
		cause: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
		compactMetadata: CompactMetadataSchema.optional(),
		retryAttempt: z.number().optional(),
		retryInMs: z.number().optional(),
		maxRetries: z.number().optional(),
		source: z.string().optional(),
		commandRun: z.object({command: z.string(), args: z.string().optional()}).strict().optional(),
		url: z.string().optional(),
		taskId: z.string().optional(),
		cron: z.string().optional(),
		prompt: z.string().optional(),
		taskKind: z.string().optional(),
		cronKind: z.string().optional(),
		noOpStreak: z.number().optional(),
		streakStartedAt: z.string().optional(),
		foldedUuids: z.array(z.string()).optional(),
	})
	.strict();

export const AiTitleRecordSchema = z
	.object({
		type: z.literal("ai-title"),
		aiTitle: z.string(),
		sessionId: z.string(),
	})
	.strict();

export const LastPromptRecordSchema = z
	.object({
		type: z.literal("last-prompt"),
		lastPrompt: z.string().optional(),
		leafUuid: z.string().optional(),
		explicit: z.boolean().optional(),
		sessionId: z.string(),
	})
	.strict();

export const QueueOperationRecordSchema = z
	.object({
		type: z.literal("queue-operation"),
		operation: z.string(),
		timestamp: z.string().optional(),
		sessionId: z.string().optional(),
		content: z.string().optional(),
		reason: z.string().optional(),
		commandUuid: z.string().optional(),
		deliveryId: z.string().optional(),
	})
	.strict();

const AgentNameRecordSchema = z
	.object({
		type: z.literal("agent-name"),
		agentName: z.string(),
		sessionId: z.string(),
	})
	.strict();

const AgentSettingRecordSchema = z
	.object({
		type: z.literal("agent-setting"),
		agentSetting: z.string(),
		sessionId: z.string(),
	})
	.strict();

const AgentColorRecordSchema = z
	.object({
		type: z.literal("agent-color"),
		agentColor: z.string(),
		sessionId: z.string(),
	})
	.strict();

const PermissionModeRecordSchema = z
	.object({
		type: z.literal("permission-mode"),
		permissionMode: z.string(),
		sessionId: z.string(),
	})
	.strict();

const WorktreeSessionSchema = z
	.object({
		originalCwd: z.string(),
		preEnterOriginalCwd: z.string().optional(),
		worktreePath: z.string(),
		worktreeName: z.string(),
		worktreeBranch: z.string().optional(),
		sessionId: z.string(),
		originalBranch: z.string().optional(),
		originalHeadCommit: z.string().optional(),
		enteredExisting: z.boolean().optional(),
		hookBased: z.boolean().optional(),
	})
	.strict()
	.superRefine((session, context) => {
		if (session.worktreeBranch === undefined && session.hookBased !== true) {
			context.addIssue({
				code: "custom",
				path: ["worktreeBranch"],
				message: "Required for non-hook worktree sessions",
			});
		}
	});

const RelocatedRecordSchema = z
	.object({
		type: z.literal("relocated"),
		sessionId: z.string(),
		relocatedCwd: z.string(),
	})
	.strict();

const WorktreeStateRecordSchema = z
	.object({
		type: z.literal("worktree-state"),
		worktreeSession: z.union([WorktreeSessionSchema, z.null()]).optional(),
		sessionId: z.string().optional(),
	})
	.strict();

export const PrLinkRecordSchema = z
	.object({
		type: z.literal("pr-link"),
		prUrl: z.string(),
		prNumber: z.number(),
		prRepository: z.string(),
		sessionId: z.string(),
		timestamp: z.string().optional(),
	})
	.strict();

const ModeRecordSchema = z
	.object({
		type: z.literal("mode"),
		mode: z.string(),
		sessionId: z.string(),
	})
	.strict();

const AtisLatchRecordSchema = z
	.object({
		type: z.literal("atis-latch"),
		atis: z.string().optional(),
		sessionId: z.string().optional(),
	})
	.strict();

export const BridgeSessionRecordSchema = z
	.object({
		type: z.literal("bridge-session"),
		sessionId: z.string().optional(),
		bridgeSessionId: z.string().optional(),
		lastSequenceNum: z.number().optional(),
		ownerAccountUuid: z.string().optional(),
		ownerOrganizationUuid: z.string().optional(),
	})
	.strict();

const ModelCostUsageSchema = z
	.object({
		inputTokens: z.number().optional(),
		outputTokens: z.number().optional(),
		thinkingTokens: z.number().optional(),
		cacheReadInputTokens: z.number().optional(),
		cacheCreationInputTokens: z.number().optional(),
		webSearchRequests: z.number().optional(),
		costUSD: z.number().optional(),
	})
	.strict();

export const CostStateRecordSchema = z
	.object({
		type: z.literal("cost-state"),
		sessionId: z.string().optional(),
		totalCostUSD: z.number().optional(),
		totalAPIDuration: z.number().optional(),
		totalAPIDurationWithoutRetries: z.number().optional(),
		totalToolDuration: z.number().optional(),
		totalLinesAdded: z.number().optional(),
		totalLinesRemoved: z.number().optional(),
		totalDuration: z.number().optional(),
		startTime: z.number().optional(),
		// Keyed by model id, e.g. "claude-opus-5-5[1m]".
		modelUsage: z.record(z.string(), ModelCostUsageSchema).optional(),
		hasUnknownModelCost: z.boolean().optional(),
	})
	.strict();

const FrameLinkRecordSchema = z
	.object({
		type: z.literal("frame-link"),
		sessionId: z.string().optional(),
		path: z.string().optional(),
		frameUrl: z.string().optional(),
		title: z.string().optional(),
		artifactCount: z.number().optional(),
		timestamp: z.string().optional(),
	})
	.strict();

// `artifacts` is keyed by artifact URL.
const ArtifactCommentMonitorRecordSchema = z
	.object({
		type: z.literal("artifact-comment-monitor"),
		v: z.number().optional(),
		sessionId: z.string().optional(),
		artifacts: z
			.record(
				z.string(),
				z
					.object({
						state: z.string().optional(),
						writtenAtMs: z.number().optional(),
						title: z.string().optional(),
					})
					.strict(),
			)
			.optional(),
	})
	.strict();

const ArtifactAutoreactLedgerRecordSchema = z
	.object({
		type: z.literal("artifact-autoreact-ledger"),
		v: z.number().optional(),
		sessionId: z.string().optional(),
		accountUuid: z.string().optional(),
		artifacts: z
			.record(
				z.string(),
				z
					.object({
						savedAt: z.number().optional(),
						stampHighWater: z.union([z.string(), z.null()]).optional(),
						everBaselined: z.boolean().optional(),
						everHadThreads: z.boolean().optional(),
						turnTimestamps: z.array(JsonValueSchema).optional(),
						threads: z.array(JsonValueSchema).optional(),
						interrupted: z.boolean().optional(),
					})
					.strict(),
			)
			.optional(),
	})
	.strict();

/**
 * Discriminated union of all known JSONL record types.
 * Unknown record types are hard errors -- they mean we need a new schema branch.
 */
export const JsonlRecordSchema = z.discriminatedUnion("type", [
	UserRecordSchema,
	AssistantRecordSchema,
	CustomTitleRecordSchema,
	FileHistorySnapshotSchema,
	ForkContextRefRecordSchema,
	AttachmentRecordSchema,
	ProgressRecordSchema,
	SystemRecordSchema,
	AiTitleRecordSchema,
	LastPromptRecordSchema,
	QueueOperationRecordSchema,
	AgentNameRecordSchema,
	AgentSettingRecordSchema,
	AgentColorRecordSchema,
	PermissionModeRecordSchema,
	WorktreeStateRecordSchema,
	RelocatedRecordSchema,
	PrLinkRecordSchema,
	ModeRecordSchema,
	AtisLatchRecordSchema,
	BridgeSessionRecordSchema,
	CostStateRecordSchema,
	FrameLinkRecordSchema,
	ArtifactCommentMonitorRecordSchema,
	ArtifactAutoreactLedgerRecordSchema,
]);

// ---------------------------------------------------------------------------
// Task Files (~/.claude/tasks/{project}/{id}.json)
// ---------------------------------------------------------------------------

export const TaskStatusSchema = z.enum(["pending", "in_progress", "completed"]);

export const TaskFileSchema = z
	.object({
		id: z.string(),
		subject: z.string(),
		description: z.string(),
		status: TaskStatusSchema,
		blocks: z.array(z.string()),
		blockedBy: z.array(z.string()),
		activeForm: z.string().optional(),
		owner: z.string().optional(),
		metadata: z.record(z.string(), JsonValueSchema).optional(),
	})
	.strict();

// ---------------------------------------------------------------------------
// Claude Code Settings (~/.claude/settings.json, settings.local.json)
// ---------------------------------------------------------------------------

const HookCommonFields = {
	if: z.string().optional(),
	timeout: z.number().optional(),
	statusMessage: z.string().optional(),
	once: z.boolean().optional(),
};

const HookEntrySchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("command"),
			command: z.string(),
			args: z.array(z.string()).optional(),
			async: z.boolean().optional(),
			asyncRewake: z.boolean().optional(),
			shell: z.enum(["bash", "powershell"]).optional(),
			...HookCommonFields,
		})
		.strict(),
	z
		.object({
			type: z.literal("http"),
			url: z.string(),
			headers: z.record(z.string(), z.string()).optional(),
			allowedEnvVars: z.array(z.string()).optional(),
			...HookCommonFields,
		})
		.strict(),
]);

const HookMatcherSchema = z
	.object({
		matcher: z.string().optional(),
		hooks: z.array(HookEntrySchema),
	})
	.strict();

const HooksSchema = z.record(z.string(), z.array(HookMatcherSchema));

/** A plugin's hooks/hooks.json: the settings.json `hooks` map plus a description. */
export const PluginHooksFileSchema = z
	.object({
		description: z.string().optional(),
		hooks: HooksSchema,
	})
	.strict();

const PermissionsSchema = z
	.object({
		allow: z.array(z.string()).optional(),
		deny: z.array(z.string()).optional(),
		ask: z.array(z.string()).optional(),
		defaultMode: z.string().optional(),
		additionalDirectories: z.array(z.string()).optional(),
		disableBypassPermissionsMode: z.string().optional(),
	})
	.strict();

const StatusLineSchema = z
	.object({
		type: z.string().optional(),
		command: z.string().optional(),
		padding: z.number().optional(),
		refreshInterval: z.number().min(1).optional(),
		hideVimModeIndicator: z.boolean().optional(),
	})
	.strict();

const MarketplaceSourceSchema = z
	.object({
		source: z.string(),
		repo: z.string().optional(),
		path: z.string().optional(),
		url: z.string().optional(),
	})
	.strict();

const MarketplaceEntrySchema = z
	.object({
		source: MarketplaceSourceSchema,
		autoUpdate: z.boolean().optional(),
		url: z.string().optional(),
	})
	.strict();

const SandboxSchema = z
	.object({
		enabled: z.boolean().optional(),
		autoAllowBashIfSandboxed: z.boolean().optional(),
		excludedCommands: z.array(z.string()).optional(),
	})
	.strict();

const RemoteSchema = z
	.object({
		defaultEnvironmentId: z.string().optional(),
	})
	.strict();

const WorktreeSettingsSchema = z
	.object({
		baseRef: z.string().optional(),
		bgIsolation: z.string().optional(),
	})
	.strict();

/**
 * `skillOverrides[name]` values documented at
 * https://code.claude.com/docs/en/skills.md#override-skill-visibility-from-settings.
 * An absent key means "on".
 */
export const SkillOverrideValueSchema = z.enum(["on", "name-only", "user-invocable-only", "off"]);

export const ClaudeSettingsSchema = z
	.object({
		$schema: z.string().optional(),
		model: z.string().optional(),
		theme: z.string().optional(),
		tui: z.string().optional(),
		verbose: z.boolean().optional(),
		includeCoAuthoredBy: z.boolean().optional(),
		includeGitInstructions: z.boolean().optional(),
		alwaysThinkingEnabled: z.boolean().optional(),
		autoCompactEnabled: z.boolean().optional(),
		voiceEnabled: z.boolean().optional(),
		cleanupPeriodDays: z.number().optional(),
		fileCheckpointingEnabled: z.boolean().optional(),
		autoUpdatesChannel: z.string().optional(),
		enableAllProjectMcpServers: z.boolean().optional(),
		enabledMcpjsonServers: z.array(z.string()).optional(),
		skipDangerousModePermissionPrompt: z.boolean().optional(),
		skipWorkflowUsageWarning: z.boolean().optional(),
		teammateMode: z.string().optional(),
		preferredNotifChannel: z.string().optional(),
		outputStyle: z.string().optional(),
		spinnerTipsEnabled: z.boolean().optional(),
		skillOverrides: z.record(z.string(), SkillOverrideValueSchema).optional(),
		effortLevel: z.string().optional(),
		env: z.record(z.string(), z.string()).optional(),
		permissions: PermissionsSchema.optional(),
		hooks: HooksSchema.optional(),
		statusLine: StatusLineSchema.optional(),
		sandbox: SandboxSchema.optional(),
		remote: RemoteSchema.optional(),
		worktree: WorktreeSettingsSchema.optional(),
		additionalDirectories: z.array(z.string()).optional(),
		enabledPlugins: z.record(z.string(), z.boolean()).optional(),
		extraKnownMarketplaces: z.record(z.string(), MarketplaceEntrySchema).optional(),
		spinnerVerbs: z
			.object({
				mode: z.string().optional(),
				verbs: z.array(z.string()).optional(),
			})
			.strict()
			.optional(),
		attribution: z.object({sessionUrl: z.boolean().optional()}).strict().optional(),
		remoteControlAtStartup: z.boolean().optional(),
		agentPushNotifEnabled: z.boolean().optional(),
		autoMode: z
			.object({environment: z.array(z.string()).optional()})
			.strict()
			.optional(),
	})
	.strict();

// ---------------------------------------------------------------------------
// MCP Configuration (~/.claude/mcp.json, .mcp.json)
// ---------------------------------------------------------------------------

const McpServerEntrySchema = z
	.object({
		type: z.string().optional(),
		command: z.string().optional(),
		args: z.array(z.string()).optional(),
		env: z.record(z.string(), z.string()).optional(),
		cwd: z.string().optional(),
		url: z.string().optional(),
		headers: z.record(z.string(), z.string()).optional(),
		timeout: z.number().optional(),
		tool_timeout_sec: z.number().optional(),
	})
	.strict();

export const McpServersSchema = z.record(z.string(), McpServerEntrySchema);

export const McpConfigSchema = z
	.object({
		mcpServers: McpServersSchema,
	})
	.strict();

/**
 * ~/.claude/mcp-needs-auth-cache.json: the CLI's record of MCP servers that
 * last failed for want of (re)authentication, keyed by server name
 * (`plugin:<plugin>:<server>` for plugin servers). `id` is set on claude.ai connectors.
 */
export const McpNeedsAuthCacheSchema = z.record(
	z.string(),
	z.strictObject({
		timestamp: z.number(),
		id: z.string().optional(),
	}),
);

// ~/.claude.json holds hundreds of unrelated, churning keys. Callers pick the
// MCP-related keys out first, then parse that projection strictly.
export const ClaudeJsonMcpSchema = z
	.object({
		mcpServers: McpServersSchema.optional(),
	})
	.strict();

export const ClaudeJsonProjectMcpSchema = z
	.object({
		mcpServers: McpServersSchema.optional(),
		disabledMcpServers: z.array(z.string()).optional(),
		enabledMcpjsonServers: z.array(z.string()).optional(),
		disabledMcpjsonServers: z.array(z.string()).optional(),
	})
	.strict();

// ---------------------------------------------------------------------------
// Plugin catalog cache (~/.claude/plugins/plugin-catalog-cache.json)
// ---------------------------------------------------------------------------

export const PluginCatalogSourceKindSchema = z.enum(["url", "git-subdir"]);

const PluginCatalogCharsSchema = z.strictObject({
	always_on: z.number(),
	on_invoke: z.number(),
});

const PluginCatalogComponentSchema = z.strictObject({
	name: z.string(),
	chars: PluginCatalogCharsSchema,
});

const PluginCatalogLspServerSchema = z.strictObject({
	command: z.string(),
	args: z.array(z.string()).optional(),
	extensionToLanguage: z.record(z.string(), z.string()),
	startupTimeout: z.number().optional(),
});

const PluginCatalogMarketplaceEntrySchema = z.strictObject({
	name: z.string(),
	displayName: z.string().optional(),
	description: z.string(),
	version: z.string().optional(),
	author: z
		.strictObject({
			name: z.string(),
			email: z.string().optional(),
			url: z.string().optional(),
		})
		.optional(),
	category: z.string().optional(),
	tags: z.array(z.string()).optional(),
	keywords: z.array(z.string()).optional(),
	homepage: z.string().optional(),
	strict: z.boolean().optional(),
	skills: z.array(z.string()).optional(),
	lspServers: z.record(z.string(), PluginCatalogLspServerSchema).optional(),
	source: z.union([
		z.string(),
		z.strictObject({
			source: PluginCatalogSourceKindSchema,
			url: z.string(),
			path: z.string().optional(),
			ref: z.string().optional(),
			sha: z.string().optional(),
		}),
	]),
});

const PluginCatalogPluginSchema = z.strictObject({
	plugin: z.string(),
	tokens: z.record(z.string(), PluginCatalogCharsSchema),
	components: z.strictObject({
		commands: z.array(PluginCatalogComponentSchema),
		agents: z.array(PluginCatalogComponentSchema),
		skills: z.array(PluginCatalogComponentSchema),
		hooks: z.array(z.string()),
		mcpServers: z.array(z.string()),
		lspServers: z.array(z.string()),
	}),
	unique_installs: z.number().optional(),
	last_updated: z.string(),
	marketplace_entry: PluginCatalogMarketplaceEntrySchema,
	version: z.string().optional(),
	source: z.string(),
	/** Null for plugins that live inside the marketplace repo (a string `source`). */
	sha: z.string().nullable(),
	source_sha: z.string(),
});

/** The CLI's cached copy of the official plugin directory, keyed `<name>@<marketplace>`. */
export const PluginCatalogCacheSchema = z.strictObject({
	version: z.number(),
	fetchedAt: z.string(),
	catalog: z.strictObject({
		generated_at: z.string(),
		installs_generated_at: z.string(),
		marketplace_sha: z.string(),
		models: z.array(z.string()),
		plugins: z.record(z.string(), PluginCatalogPluginSchema),
	}),
});

// The identity keys picked out of ~/.claude.json `oauthAccount`. Plan fields stay
// plain strings so an unfamiliar plan still yields a name and email.
export const ClaudeJsonOauthAccountSchema = z
	.object({
		displayName: z.string().optional(),
		fullName: z.string().optional(),
		emailAddress: z.string().optional(),
		organizationType: z.string().optional(),
		organizationRateLimitTier: z.string().optional(),
	})
	.strict();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttachmentPayload = z.infer<typeof AttachmentPayloadSchema>;
export type ToolUseBlock = z.infer<typeof ToolUseBlockSchema>;
export type JsonlRecord = z.infer<typeof JsonlRecordSchema>;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Parse a single JSONL line into a typed record.
 * Returns null for empty/malformed lines.
 */
export function parseJsonlRecord(line: string): JsonlRecord | null {
	const trimmed = line.trim();
	if (!trimmed) return null;

	let obj: unknown;
	try {
		obj = JSON.parse(trimmed);
	} catch {
		return null;
	}

	const result = JsonlRecordSchema.safeParse(obj);
	if (!result.success) return null;
	return result.data;
}
