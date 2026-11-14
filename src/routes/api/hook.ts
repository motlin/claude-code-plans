import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {createHash} from "node:crypto";
import {homedir} from "node:os";
import {join} from "node:path";
import {sql} from "drizzle-orm";
import type {core, ZodError} from "zod";
import {DOMAIN_EVENTS, HookEventEnvelope, type HookEvent} from "../../lib/hook-events";
import {toLenient} from "../../lib/lenient-schema";
import {broadcastTyped} from "../../lib/watcher";
import {dispatchHookEvent, type HookDispatchDirs} from "../../lib/hook-dispatcher";
import {getTerminalHost} from "../../lib/terminal-host";
import
{
	getActiveSessionEntry,
	markSessionActive,
	markSessionEnded,
	setSessionState,
	touchSession,
	setBackgroundTasks,
	setSessionCrons,
	setPendingPermissionRequest,
	touchSubagentActivity,
} from "../../lib/active-session-store";
import {getCacheDir} from "../../lib/db/connection";
import {getDb} from "../../lib/db";
import {hookSchemaDrift} from "../../lib/db/schema";
import {indexFile} from "../../lib/db/indexer";
import {rejectCrossSite} from "../../lib/same-origin-guard";
import {isRecord} from "../../lib/narrow";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import * as dbSchema from "../../lib/db/schema";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const PLANS_DIR = join(homedir(), ".claude", "plans");
const TASKS_DIR = join(homedir(), ".claude", "tasks");
const COMMANDS_DIR = join(homedir(), ".claude", "commands");
const PLUGINS_DIR = join(homedir(), ".claude", "plugins", "cache");
const STATUSLINE_DIR = join(getCacheDir(), "statusline");

const HOOK_DIRS: HookDispatchDirs =
{
	projectsDir: PROJECTS_DIR,
	plansDir: PLANS_DIR,
	tasksDir: TASKS_DIR,
	commandsDir: COMMANDS_DIR,
	pluginsDir: PLUGINS_DIR,
	statuslineDir: STATUSLINE_DIR,
};

/** Truncated raw body to keep the drift table from growing unbounded. */
const RAW_BODY_MAX_BYTES = 16_384;

/** Issue fields that carry body values rather than schema shape, so two bodies with the same drift differ there. */
const VALUE_BEARING_ISSUE_KEYS = new Set(["input", "message"]);

function normalizeIssueValue(key: string, value: unknown): unknown
{
	if (key === "path" && Array.isArray(value))
	{
		return value.map((segment: unknown) => (typeof segment === "number" ? "*" : segment));
	}
	if (Array.isArray(value)) return value.map((item: unknown) => normalizeIssueValue("", item));
	if (isRecord(value))
	{
		return Object.fromEntries(
			Object.keys(value)
				.filter((childKey) => !VALUE_BEARING_ISSUE_KEYS.has(childKey))
				.toSorted()
				.map((childKey) => [childKey, normalizeIssueValue(childKey, value[childKey])]),
		);
	}
	return value;
}

/**
 * A sha256 of the Zod issue list with body values stripped (messages, inputs, array indices), so every hook that
 * hits the same drift collapses onto one (hook_event_name, issue_signature) row however its session, prompt or
 * tool input differ.
 */
export function driftIssueSignature(error: ZodError): string
{
	const normalized = JSON.stringify(normalizeIssueValue("", error.issues));
	return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Extract missing-field and unknown-field paths from the Zod error issue list.
 * Zod v4 marks missing required fields as `'invalid_type'` with
 * `expected !== 'undefined'` and `received === 'undefined'`; unknown keys come
 * through as `'unrecognized_keys'`.
 */
function walkZodIssues(
	issues: core.$ZodIssue[],
	output: core.$ZodIssue[],
	state:
	{
		matchedToolArm: boolean;
	},
): void
{
	for (const issue of issues)
	{
		if (issue.code !== "invalid_union")
		{
			output.push(issue);
			continue;
		}

		const isToolUnion = issue.errors.some((arm) => arm.some((armIssue) => armIssue.path[0] === "tool_name"));
		for (const arm of issue.errors)
		{
			const discriminatorFailed = arm.some(
				(armIssue) => armIssue.path[0] === "hook_event_name" || armIssue.path[0] === "tool_name",
			);
			if (discriminatorFailed) continue;
			if (isToolUnion) state.matchedToolArm = true;
			walkZodIssues(arm, output, state);
		}
	}
}

function extractUnmatchedToolName(body: unknown, matchedToolArm: boolean): string | undefined
{
	if (matchedToolArm || !isRecord(body)) return undefined;
	const record = body;
	if (
		record["hook_event_name"] !== "PreToolUse" &&
		record["hook_event_name"] !== "PostToolUse" &&
		record["hook_event_name"] !== "PostToolUseFailure"
	)
	{
		return undefined;
	}
	return typeof record["tool_name"] === "string" ? record["tool_name"] : undefined;
}

export function classifyZodIssues(
	error: ZodError,
	body: unknown,
):
{
	missingFields: string[];
	unknownFields: string[];
}
{
	const missingFields = new Set<string>();
	const unknownFields = new Set<string>();
	const relevantIssues: core.$ZodIssue[] = [];
	const state =
	{
		matchedToolArm: false,
	};
	walkZodIssues(error.issues, relevantIssues, state);

	for (const issue of relevantIssues)
	{
		const path = issue.path.join(".");
		if (issue.code === "unrecognized_keys")
		{
			for (const key of issue.keys)
			{
				unknownFields.add(path ? `${path}.${key}` : key);
			}
			continue;
		}
		if (issue.code === "invalid_type")
		{
			const received = "received" in issue ? issue.received : undefined;
			if (received === "undefined")
			{
				if (path) missingFields.add(path);
			}
		}
	}
	// Zod returns a union's issues unwrapped when only one arm survives, so a lone arm that never failed on
	// `tool_name` is the matched tool arm even though no `invalid_union` reached the walker.
	const matchedToolArm =
		state.matchedToolArm ||
		(relevantIssues.length > 0 && !relevantIssues.some((issue) => issue.path[0] === "tool_name"));
	const unmatchedToolName = extractUnmatchedToolName(body, matchedToolArm);
	if (unmatchedToolName) unknownFields.add(`tool_name: ${unmatchedToolName}`);
	return {
		missingFields: [...missingFields].toSorted(),
		unknownFields: [...unknownFields].toSorted(),
	};
}

/**
 * Read `tool_input.file_path` from a payload that already failed schema
 * validation. We can't trust the type, so we walk the structure defensively
 * and return undefined for anything that isn't a plain string.
 */
function extractFilePath(body: unknown): string | undefined
{
	if (!isRecord(body)) return undefined;
	const toolInput = body["tool_input"];
	if (!isRecord(toolInput)) return undefined;
	const filePath = toolInput["file_path"];
	return typeof filePath === "string" ? filePath : undefined;
}

function extractHookEventName(body: unknown): string
{
	if (!isRecord(body)) return "unknown";
	const name = body["hook_event_name"];
	return typeof name === "string" ? name : "unknown";
}

/**
 * Persist a schema-drift row keyed by (hook_event_name, issue_signature). Repeat
 * drifts keep the first sample body, increment the `count` column and refresh
 * `last_seen_at` instead of inserting a new row, so the table holds one row per
 * distinct drift.
 *
 * Returns the post-upsert `count` so callers can include it in the broadcast.
 */
export function persistDrift(
	db: BetterSQLite3Database<typeof dbSchema>,
	hookEventName: string,
	rawBody: string,
	error: ZodError,
): number
{
	const now = Date.now();
	const issueSignature = driftIssueSignature(error);
	const issuesJson = JSON.stringify(error.issues);
	const truncated = rawBody.length > RAW_BODY_MAX_BYTES ? rawBody.slice(0, RAW_BODY_MAX_BYTES) : rawBody;

	const result = db
		.insert(hookSchemaDrift)
		.values(
			{
				hookEventName,
				issueSignature,
				rawBody: truncated,
				issuesJson,
				count: 1,
				firstSeenAt: now,
				lastSeenAt: now,
			},
		)
		.onConflictDoUpdate(
			{
				target: [hookSchemaDrift.hookEventName, hookSchemaDrift.issueSignature],
				set:
				{
					count: sql`${hookSchemaDrift.count} + 1`,
					lastSeenAt: now,
				},
			},
		)
		.returning(
			{
				count: hookSchemaDrift.count,
			},
		)
		.get();
	return result.count;
}

/** The lenient twin (see `toLenient`): dispatches events whose only drift is new keys or enum values. */
export const RuntimeHookEventEnvelope = toLenient(HookEventEnvelope);

async function dispatch(event: HookEvent): Promise<void>
{
	await dispatchHookEvent(
		{
			event,
			db: getDb().index,
			store:
			{
				markSessionActive,
				markSessionEnded,
				setSessionState,
				touchSession,
				touchSubagentActivity,
				setBackgroundTasks,
				setSessionCrons,
				setPendingPermissionRequest,
				getActiveSessionEntry,
			},
			broadcast: broadcastTyped,
			dirs: HOOK_DIRS,
			reportHerdrState: (reportedEvent, entry) =>
			{
				void getTerminalHost().then((host) =>
				{
					host.reportHookState(reportedEvent, entry);
				});
			},
		},
	);
}

export const Route = createFileRoute("/api/hook")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					POST: async ({request}: {request: Request}) =>
					{
						const rejection = rejectCrossSite(request);
						if (rejection) return rejection;

						const rawText = await request.text();
						let body: unknown;
						try
						{
							body = JSON.parse(rawText) as unknown;
						}
						catch
						{
							return Response.json(
								{
									error: "Invalid JSON",
								},
								{
									status: 400,
								},
							);
						}

						// Strict parse reports drift; the lenient twin still dispatches the
						// event when the drift is only new keys or enum values.
						const result = HookEventEnvelope.safeParse(body);
						const lenient = result.success ? result : RuntimeHookEventEnvelope.safeParse(body);

						if (!result.success)
						{
							const {index} = getDb();
							const hookEventName = extractHookEventName(body);
							const {missingFields, unknownFields} = classifyZodIssues(result.error, body);

							let count = 1;
							try
							{
								count = persistDrift(index, hookEventName, rawText, result.error);
							}
							catch
							{
								// transient DB error — still broadcast and attempt fallback
							}

							broadcastTyped(
								DOMAIN_EVENTS.HOOK_SCHEMA_DRIFT,
								{
									hookEventName,
									missingFields,
									unknownFields,
									count,
								},
							);

							if (lenient.success)
							{
								await dispatch(lenient.data);
								return Response.json(
									{
										ok: true,
										drift: true,
										count,
									},
								);
							}

							// Watcher-style fallback: if this looks like a PostToolUse on a file
							// we'd otherwise pick up via chokidar, index it directly so the
							// client still sees the update. Anything else is left for chokidar.
							if (hookEventName === "PostToolUse")
							{
								const filePath = extractFilePath(body);
								if (filePath)
								{
									try
									{
										await indexFile(index, filePath, PROJECTS_DIR, PLANS_DIR);
									}
									catch
									{
										// fall through — chokidar will retry
									}
								}
							}

							// Return 202 so Claude Code's hook curl exits 0 and doesn't surface
							// a hook failure to the user. The drift is persisted server-side.
							return Response.json(
								{
									ok: false,
									drift: true,
									count,
								},
								{
									status: 202,
								},
							);
						}

						await dispatch(result.data);
						return Response.json(
							{
								ok: true,
							},
						);
					},
				},
			),
		},
	},
);
