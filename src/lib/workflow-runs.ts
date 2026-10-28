/**
 * A session's workflow runs, read from what the CLI writes to disk: each
 * `Workflow` launch result (`toolUseResult` with `taskType: "local_workflow"`),
 * its `<task-notification>`, the `workflows/<runId>.json` run file once the run
 * ends, and while it runs `subagents/workflows/<runId>/journal.jsonl` plus each
 * agent's `agent-*.meta.json` and transcript mtime.
 */
import {readFileSync, statSync} from "node:fs";
import {join, relative, sep} from "node:path";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {z} from "zod";
import {notificationStatus} from "./background-tasks";
import {toLenient} from "./lenient-schema";
import {asRecord} from "./narrow";
import {trackedReadFileSync} from "./perf/tracked-fs";
import type * as schema from "./db/schema";
import {JsonValueSchema} from "./json-value-schema";
import {transcriptFilePath} from "./structured-transcript";
import {
	RuntimeWorkflowProgressEntrySchema,
	type WorkflowAgentEntry,
	type WorkflowProgressEntry,
	type WorkflowRunStatus,
} from "./workflow-progress";

type IndexDb = BetterSQLite3Database<typeof schema>;

/** The `toolUseResult` of a `Workflow` call that launched a run. */
const WorkflowLaunchResultSchema = z.strictObject({
	status: z.literal("async_launched"),
	taskId: z.string(),
	taskType: z.literal("local_workflow"),
	workflowName: z.string(),
	runId: z.string(),
	summary: z.string(),
	transcriptDir: z.string(),
	scriptPath: z.string(),
});

export const WorkflowRunFileStatusSchema = z.enum(["completed", "killed"]);

/** `<session>/workflows/<runId>.json`, written when a run ends. */
export const WorkflowRunFileSchema = z.strictObject({
	runId: z.string(),
	timestamp: z.string(),
	taskId: z.string(),
	script: z.string(),
	scriptPath: z.string(),
	args: JsonValueSchema.optional(),
	result: JsonValueSchema,
	error: z.string().optional(),
	agentCount: z.number(),
	logs: z.array(JsonValueSchema),
	durationMs: z.number(),
	summary: z.string(),
	workflowName: z.string(),
	status: WorkflowRunFileStatusSchema,
	startTime: z.number(),
	phases: z.array(JsonValueSchema),
	defaultModel: z.string(),
	workflowProgress: z.array(JsonValueSchema),
	totalTokens: z.number(),
	totalToolCalls: z.number(),
});

/** One line of `subagents/workflows/<runId>/journal.jsonl`. */
export const WorkflowJournalEventSchema = z.discriminatedUnion("type", [
	z.strictObject({type: z.literal("launched")}),
	z.strictObject({
		type: z.literal("started"),
		key: z.string(),
		agentId: z.string(),
		label: z.string().optional(),
		phase: z.string().optional(),
	}),
	z.strictObject({
		type: z.literal("result"),
		key: z.string(),
		agentId: z.string(),
		result: JsonValueSchema,
		toolsUsed: z.array(z.string()).optional(),
	}),
	z.strictObject({type: z.literal("failed"), key: z.string(), agentId: z.string()}),
]);

/** `subagents/workflows/<runId>/agent-<agentId>.meta.json`. */
export const WorkflowAgentMetaSchema = z.strictObject({
	agentType: z.string(),
	isBuiltIn: z.boolean().optional(),
	description: z.string().optional(),
	workflowPhase: z.string().optional(),
	spawnDepth: z.number(),
	requestShape: z.string().optional(),
	requestNonInteractive: z.boolean().optional(),
	model: z.string().optional(),
});

const RuntimeLaunchResultSchema = /* @__PURE__ */ toLenient(WorkflowLaunchResultSchema);
const RuntimeRunFileSchema = /* @__PURE__ */ toLenient(WorkflowRunFileSchema);
const RuntimeJournalEventSchema = /* @__PURE__ */ toLenient(WorkflowJournalEventSchema);
const RuntimeAgentMetaSchema = /* @__PURE__ */ toLenient(WorkflowAgentMetaSchema);

export interface WorkflowRun {
	runId: string;
	/** The latest launch's background task id. */
	taskId: string;
	/** The latest launch's `Workflow` tool_use id. */
	toolUseId: string;
	/** Every launch of this run in transcript order; a resumed run is launched again under the same runId. */
	toolUseIds: string[];
	workflowName: string;
	scriptPath: string;
	transcriptDir: string;
	description: string;
	status: WorkflowRunStatus;
	/** The latest launch's `<task-notification>` summary. */
	summary: string | null;
	/** Epoch ms. */
	startedAt: number | null;
	durationMs: number | null;
	totalTokens: number | null;
	progress: WorkflowProgressEntry[];
}

interface Launch {
	toolUseId: string;
	timestamp: string | null;
	result: z.infer<typeof WorkflowLaunchResultSchema>;
}

interface Notification {
	taskId: string | null;
	toolUseId: string | null;
	status: Exclude<WorkflowRunStatus, "running">;
	summary: string | null;
	durationMs: number | null;
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function tag(text: string, name: string): string | null {
	const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text);
	return match?.[1] === undefined ? null : match[1].trim();
}

function parseNotification(text: string): Notification | null {
	if (!text.trimStart().startsWith("<task-notification>")) return null;
	const status = notificationStatus(tag(text, "status"));
	if (status === null) return null;
	const duration = tag(text, "duration_ms");
	return {
		taskId: tag(text, "task-id"),
		toolUseId: tag(text, "tool-use-id"),
		status,
		summary: tag(text, "summary"),
		durationMs: duration !== null && /^\d+$/.test(duration) ? Number(duration) : null,
	};
}

/** Every text a record could carry a `<task-notification>` in: a user turn, a queued_command attachment, a queue enqueue. */
function notificationTexts(record: Readonly<Record<string, unknown>>): string[] {
	if (record["type"] === "queue-operation" && record["operation"] === "enqueue") {
		const content = asString(record["content"]);
		return content === null ? [] : [content];
	}
	if (record["type"] === "attachment") {
		const attachment = asRecord(record["attachment"]);
		const prompt = attachment?.["type"] === "queued_command" ? asString(attachment["prompt"]) : null;
		return prompt === null ? [] : [prompt];
	}
	if (record["type"] !== "user") return [];
	const content = asRecord(record["message"])?.["content"];
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];
	return content.flatMap((block) => {
		const text = asRecord(block)?.["type"] === "text" ? asString(asRecord(block)?.["text"]) : null;
		return text === null ? [] : [text];
	});
}

function launchOf(record: Readonly<Record<string, unknown>>): Launch | null {
	const parsed = RuntimeLaunchResultSchema.safeParse(record["toolUseResult"]);
	if (!parsed.success) return null;
	const content = asRecord(record["message"])?.["content"];
	if (!Array.isArray(content)) return null;
	for (const block of content) {
		const toolUseId = asString(asRecord(block)?.["tool_use_id"]);
		if (toolUseId !== null) return {toolUseId, timestamp: asString(record["timestamp"]), result: parsed.data};
	}
	return null;
}

/** Only these lines can hold a launch result or a notification; skip parsing the rest. */
function mightMatter(line: string): boolean {
	return line.includes("local_workflow") || line.includes("<task-notification>");
}

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

function mtimeMs(path: string): number | undefined {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return undefined;
	}
}

function readRunFile(sessionDir: string, runId: string): z.infer<typeof WorkflowRunFileSchema> | null {
	const parsed = RuntimeRunFileSchema.safeParse(readJson(join(sessionDir, "workflows", `${runId}.json`)));
	return parsed.success ? parsed.data : null;
}

function runFileStatus(status: string): Exclude<WorkflowRunStatus, "running"> {
	return notificationStatus(status) ?? "completed";
}

function progressEntries(raw: readonly unknown[]): WorkflowProgressEntry[] {
	return raw.flatMap((entry) => {
		const parsed = RuntimeWorkflowProgressEntrySchema.safeParse(entry);
		return parsed.success ? [parsed.data] : [];
	});
}

/**
 * A running run's `workflowProgress`, synthesized from its journal: agents in
 * first-started order, phases numbered in first-seen order, `started` →
 * `progress`, `result` → `done`, `failed` → `error`. The agent's meta file
 * fills in a missing label or phase and the model; its mtime is the start time
 * and its transcript's mtime the last progress.
 */
function journalProgress(transcriptDir: string): WorkflowProgressEntry[] {
	let lines: string[];
	try {
		lines = readFileSync(join(transcriptDir, "journal.jsonl"), "utf8").split("\n");
	} catch {
		return [];
	}
	const agents = new Map<string, {label?: string; phase?: string; state: WorkflowAgentEntry["state"]}>();
	for (const line of lines) {
		if (line === "") continue;
		let raw: unknown;
		try {
			raw = JSON.parse(line);
		} catch {
			continue;
		}
		const parsed = RuntimeJournalEventSchema.safeParse(raw);
		if (!parsed.success) continue;
		const event = parsed.data;
		if (event.type === "launched") continue;
		const agent = agents.get(event.agentId) ?? {state: "progress"};
		agents.set(event.agentId, agent);
		if (event.type === "started") {
			if (event.label !== undefined) agent.label = event.label;
			if (event.phase !== undefined) agent.phase = event.phase;
			if (agent.state !== "done") agent.state = "progress";
		} else {
			agent.state = event.type === "result" ? "done" : "error";
		}
	}

	const phases = new Map<string, number>();
	const entries: WorkflowAgentEntry[] = [];
	for (const [agentId, agent] of agents) {
		const metaPath = join(transcriptDir, `agent-${agentId}.meta.json`);
		const meta = RuntimeAgentMetaSchema.safeParse(readJson(metaPath));
		const phaseTitle = agent.phase ?? (meta.success ? meta.data.workflowPhase : undefined);
		const entry: WorkflowAgentEntry = {
			type: "workflow_agent",
			index: entries.length + 1,
			label: agent.label ?? (meta.success ? meta.data.description : undefined) ?? agentId,
			agentId,
			state: agent.state,
		};
		if (phaseTitle !== undefined) {
			const phaseIndex = phases.get(phaseTitle) ?? phases.size + 1;
			phases.set(phaseTitle, phaseIndex);
			entry.phaseIndex = phaseIndex;
			entry.phaseTitle = phaseTitle;
		}
		if (meta.success && meta.data.model !== undefined) entry.model = meta.data.model;
		const startedAt = mtimeMs(metaPath);
		if (startedAt !== undefined) entry.startedAt = startedAt;
		const lastProgressAt = mtimeMs(join(transcriptDir, `agent-${agentId}.jsonl`));
		if (lastProgressAt !== undefined) entry.lastProgressAt = lastProgressAt;
		entries.push(entry);
	}
	const phaseEntries = [...phases].map(([title, index]): WorkflowProgressEntry => ({
		type: "workflow_phase",
		index,
		title,
	}));
	return [...phaseEntries, ...entries];
}

function epochMs(timestamp: string | null): number | null {
	if (timestamp === null) return null;
	const ms = Date.parse(timestamp);
	return Number.isNaN(ms) ? null : ms;
}

/** The workflow runs of the session whose transcript is `transcriptPath`, in launch order of each run's latest launch. */
export function readWorkflowRuns(transcriptPath: string): WorkflowRun[] {
	let text: string;
	try {
		text = trackedReadFileSync(transcriptPath);
	} catch {
		return [];
	}
	const sessionDir = transcriptPath.replace(/\.jsonl$/, "");
	const launches = new Map<string, Launch[]>();
	const notifications: Notification[] = [];
	for (const line of text.split("\n")) {
		if (!mightMatter(line)) continue;
		let record: Record<string, unknown> | undefined;
		try {
			record = asRecord(JSON.parse(line));
		} catch {
			continue;
		}
		if (record === undefined) continue;
		const launch = launchOf(record);
		if (launch !== null) {
			const runId = launch.result.runId;
			// Re-insert so the map orders runs by their latest launch.
			const previous = launches.get(runId) ?? [];
			launches.delete(runId);
			launches.set(runId, [...previous, launch]);
			continue;
		}
		for (const content of notificationTexts(record)) {
			const notification = parseNotification(content);
			if (notification !== null) notifications.push(notification);
		}
	}

	return [...launches].flatMap(([runId, runLaunches]): WorkflowRun[] => {
		const latest = runLaunches.at(-1);
		if (latest === undefined) return [];
		const {taskId} = latest.result;
		const notification = notifications.findLast(
			(candidate) => candidate.toolUseId === latest.toolUseId || candidate.taskId === taskId,
		);
		// A resumed run's file can still describe an earlier launch; only the latest launch's file counts.
		const runFile = readRunFile(sessionDir, runId);
		const file = runFile?.taskId === taskId ? runFile : null;
		return [
			{
				runId,
				taskId,
				toolUseId: latest.toolUseId,
				toolUseIds: runLaunches.map((launch) => launch.toolUseId),
				workflowName: latest.result.workflowName,
				scriptPath: latest.result.scriptPath,
				transcriptDir: latest.result.transcriptDir,
				description: file?.summary ?? latest.result.summary,
				status: notification?.status ?? (file === null ? "running" : runFileStatus(file.status)),
				summary: notification?.summary ?? null,
				startedAt: file?.startTime ?? epochMs(latest.timestamp),
				durationMs: file?.durationMs ?? notification?.durationMs ?? null,
				totalTokens: file?.totalTokens ?? null,
				progress:
					file === null
						? journalProgress(join(sessionDir, "subagents", "workflows", runId))
						: progressEntries(file.workflowProgress),
			},
		];
	});
}

/**
 * The session id whose workflow runs a change at `path` affects: a run file
 * (`<session>/workflows/<runId>.json`) or anything in a run's transcript
 * directory (`<session>/subagents/workflows/<runId>/…`). Null for any other path.
 */
export function workflowSessionIdForPath(path: string, projectsDir: string): string | null {
	const rel = relative(projectsDir, path);
	if (rel.startsWith("..")) return null;
	const parts = rel.split(sep);
	const [, session, first, second, third, fourth] = parts;
	if (session === undefined) return null;
	if (parts.length === 4 && first === "workflows" && second?.endsWith(".json") === true) return session;
	if (
		parts.length === 6 &&
		first === "subagents" &&
		second === "workflows" &&
		third !== undefined &&
		fourth !== undefined
	) {
		return session;
	}
	return null;
}

/** The workflow runs of session `id`, or none when the index has no transcript for it. */
export function readSessionWorkflowRuns(db: IndexDb, id: string): WorkflowRun[] {
	const filePath = transcriptFilePath(db, id);
	return filePath ? readWorkflowRuns(filePath) : [];
}
