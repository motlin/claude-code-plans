import {z} from "zod";

/**
 * The host side of Claude Code's stream-json control protocol (`claude -p
 * --input-format stream-json --output-format stream-json`), as CLI 2.1.327
 * defines it. Every stdin and stdout frame is one JSON object per line.
 *
 * Host to CLI: `user` messages, `control_request`s (`initialize`, `interrupt`,
 * `stop_task`, `set_permission_mode`) and `control_response`s answering the
 * CLI's own requests (`can_use_tool`, `request_user_dialog`).
 */

/** The dialog kinds this app renders; the CLI fails closed (no dialog) for any kind not declared. */
const HEADLESS_DIALOG_KINDS = ["refusal_fallback_prompt"] as const;

export type HeadlessFrame = Record<string, unknown>;

export function initializeRequest(requestId: string): HeadlessFrame
{
	return {
		type: "control_request",
		request_id: requestId,
		request:
		{
			subtype: "initialize",
			supportedDialogKinds: [...HEADLESS_DIALOG_KINDS],
		},
	};
}

export function userMessage(prompt: string): HeadlessFrame
{
	return {
		type: "user",
		message:
		{
			role: "user",
			content: prompt,
		},
		parent_tool_use_id: null,
		session_id: "",
	};
}

export function controlRequest(requestId: string, request: Record<string, unknown>): HeadlessFrame
{
	return {
		type: "control_request",
		request_id: requestId,
		request,
	};
}

export function controlSuccess(requestId: string, response: Record<string, unknown>): HeadlessFrame
{
	return {
		type: "control_response",
		response:
		{
			subtype: "success",
			request_id: requestId,
			response,
		},
	};
}

/** A `can_use_tool` answer: run the tool (with its input, possibly edited) or refuse it. */
export type PermissionResult =
	|
	  {
			behavior: "allow";
			updatedInput: Record<string, unknown>;
			updatedPermissions?: unknown[];
	  }
	|
	  {
			behavior: "deny";
			message: string;
			interrupt?: boolean;
	  };

/** A `request_user_dialog` answer. */
export interface DialogResult
{
	behavior: "completed" | "cancelled";
	result?: unknown;
}

// Lenient at runtime: the CLI adds fields freely, and an unknown frame is ignored.
const RecordSchema = z.record(z.string(), z.unknown());

const CanUseToolSchema = z.looseObject(
	{
		subtype: z.literal("can_use_tool"),
		tool_name: z.string(),
		input: RecordSchema,
		permission_suggestions: z.array(z.unknown()).optional(),
		tool_use_id: z.string().optional(),
	},
);

const UserDialogSchema = z.looseObject(
	{
		subtype: z.literal("request_user_dialog"),
		dialog_kind: z.string(),
		payload: RecordSchema,
		tool_use_id: z.string().optional(),
	},
);

const IncomingControlRequestSchema = z.looseObject(
	{
		type: z.literal("control_request"),
		request_id: z.string(),
		request: z.looseObject(
			{
				subtype: z.string(),
			},
		),
	},
);

const ControlResponseSchema = z.looseObject(
	{
		type: z.literal("control_response"),
		response: z.looseObject(
			{
				subtype: z.string(),
				request_id: z.string(),
				response: RecordSchema.optional(),
				error: z.string().optional(),
			},
		),
	},
);

const ControlCancelSchema = z.looseObject(
	{
		type: z.literal("control_cancel_request"),
		request_id: z.string(),
	},
);

const TaskStartedSchema = z.looseObject(
	{
		type: z.literal("system"),
		subtype: z.literal("task_started"),
		task_id: z.string(),
		description: z.string(),
		tool_use_id: z.string().optional(),
	},
);

const TaskNotificationSchema = z.looseObject(
	{
		type: z.literal("system"),
		subtype: z.literal("task_notification"),
		task_id: z.string(),
	},
);

const TaskUpdatedSchema = z.looseObject(
	{
		type: z.literal("system"),
		subtype: z.literal("task_updated"),
		task_id: z.string(),
		patch: z.looseObject(
			{
				status: z.string().optional(),
			},
		),
	},
);

const ResultSchema = z.looseObject(
	{
		type: z.literal("result"),
	},
);

export interface CanUseToolRequest
{
	requestId: string;
	toolName: string;
	input: Record<string, unknown>;
	suggestions: unknown[] | null;
	toolUseId: string | null;
}

export interface UserDialogRequest
{
	requestId: string;
	kind: string;
	payload: Record<string, unknown>;
}

/** The stdout frames the host acts on; everything else is `ignored`. */
export type HeadlessEvent =
	| (
	  {
			type: "can_use_tool";
	  } & CanUseToolRequest)
	| (
	  {
			type: "dialog";
	  } & UserDialogRequest)
	|
	  {
			type: "unsupported_request";
			requestId: string;
			subtype: string;
	  }
	|
	  {
			type: "control_response";
			requestId: string;
			ok: boolean;
			response: Record<string, unknown>;
			error: string | null;
	  }
	|
	  {
			type: "cancel";
			requestId: string;
	  }
	|
	  {
			type: "task_started";
			taskId: string;
			description: string;
			toolUseId: string | null;
	  }
	|
	  {
			type: "task_ended";
			taskId: string;
	  }
	|
	  {
			type: "result";
	  }
	|
	  {
			type: "ignored";
	  };

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "killed"]);

/** Classify one stdout line; malformed or unknown lines are `ignored`. */
export function parseHeadlessLine(line: string): HeadlessEvent
{
	let json: unknown;
	try
	{
		json = JSON.parse(line);
	}
	catch
	{
		return {
			type: "ignored",
		};
	}

	const incoming = IncomingControlRequestSchema.safeParse(json);
	if (incoming.success)
	{
		const requestId = incoming.data.request_id;
		const canUseTool = CanUseToolSchema.safeParse(incoming.data.request);
		if (canUseTool.success)
			return {
				type: "can_use_tool",
				requestId,
				toolName: canUseTool.data.tool_name,
				input: canUseTool.data.input,
				suggestions: canUseTool.data.permission_suggestions ?? null,
				toolUseId: canUseTool.data.tool_use_id ?? null,
			};
		const dialog = UserDialogSchema.safeParse(incoming.data.request);
		if (dialog.success)
			return {
				type: "dialog",
				requestId,
				kind: dialog.data.dialog_kind,
				payload: dialog.data.payload,
			};
		return {
			type: "unsupported_request",
			requestId,
			subtype: incoming.data.request.subtype,
		};
	}

	const response = ControlResponseSchema.safeParse(json);
	if (response.success)
		return {
			type: "control_response",
			requestId: response.data.response.request_id,
			ok: response.data.response.subtype === "success",
			response: response.data.response.response ?? {},
			error: response.data.response.error ?? null,
		};

	const cancel = ControlCancelSchema.safeParse(json);
	if (cancel.success)
		return {
			type: "cancel",
			requestId: cancel.data.request_id,
		};

	const started = TaskStartedSchema.safeParse(json);
	if (started.success)
		return {
			type: "task_started",
			taskId: started.data.task_id,
			description: started.data.description,
			toolUseId: started.data.tool_use_id ?? null,
		};

	const notification = TaskNotificationSchema.safeParse(json);
	if (notification.success)
		return {
			type: "task_ended",
			taskId: notification.data.task_id,
		};

	const updated = TaskUpdatedSchema.safeParse(json);
	if (updated.success && TERMINAL_TASK_STATUSES.has(updated.data.patch.status ?? ""))
		return {
			type: "task_ended",
			taskId: updated.data.task_id,
		};

	if (ResultSchema.safeParse(json).success)
		return {
			type: "result",
		};

	return {
		type: "ignored",
	};
}
