/**
 * Each workflow agent's state and attempt, read at request time from the run's
 * `journal.jsonl` and, once the run ends, its `workflows/<runId>.json`. Kept out
 * of the index because the run file lands after the agents' transcripts stop
 * changing, so an index-time value would never learn an agent was superseded.
 */
import {readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {asRecord, isRecord} from "./narrow";
import {RuntimeWorkflowProgressEntrySchema} from "./workflow-progress";

/** `result` → done, `failed` → failed, only `started` → running, or ended once the run file exists. */
export type WorkflowAgentState = "done" | "failed" | "running" | "ended";

/** Upstream shows only the final launch's agents; earlier attempts of a resumed run are superseded. */
export type WorkflowAttempt = "final" | "superseded";

export interface WorkflowAgentStatus {
	state: WorkflowAgentState;
	attempt: WorkflowAttempt;
}

/** The run file's `workflowProgress` agents and when it was written. */
export interface WorkflowRunFile {
	agentIds: ReadonlySet<string>;
	writtenAt: string;
}

/**
 * Each agent's status from the journal's events. `runFile` is null while the
 * run has no run file. A resume appends to the same journal and leaves the
 * previous launch's run file in place until it finishes, so an agent that
 * `startedAt` places after the run file was written belongs to the running
 * launch and is judged as if there were no run file yet.
 */
export function workflowAgentStatuses(
	journalText: string,
	runFile: WorkflowRunFile | null,
	startedAt: ReadonlyMap<string, string> = new Map(),
): Map<string, WorkflowAgentStatus> {
	const lastEvent = new Map<string, "started" | "result" | "failed">();
	for (const line of journalText.split("\n")) {
		if (line === "") continue;
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(event)) continue;
		const type = event["type"];
		const agentId = event["agentId"];
		if (typeof agentId !== "string" || (type !== "started" && type !== "result" && type !== "failed")) continue;
		lastEvent.set(agentId, type);
	}
	const writtenAtMs = runFile === null ? Number.NaN : Date.parse(runFile.writtenAt);
	const statuses = new Map<string, WorkflowAgentStatus>();
	for (const [agentId, type] of lastEvent) {
		const started = startedAt.get(agentId);
		const judgedByRunFile =
			runFile !== null && !(started !== undefined && Date.parse(started) > writtenAtMs) ? runFile : null;
		const unfinished: WorkflowAgentState = judgedByRunFile === null ? "running" : "ended";
		statuses.set(agentId, {
			state: type === "result" ? "done" : type === "failed" ? "failed" : unfinished,
			attempt: judgedByRunFile === null || judgedByRunFile.agentIds.has(agentId) ? "final" : "superseded",
		});
	}
	return statuses;
}

function readText(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

/** The run file's agents and its `timestamp`, falling back to the file's mtime. */
function parseRunFile(text: string, path: string): WorkflowRunFile | null {
	let run: unknown;
	try {
		run = JSON.parse(text);
	} catch {
		return null;
	}
	const record = asRecord(run);
	const progress = record?.["workflowProgress"];
	if (!Array.isArray(progress)) return null;
	const ids = new Set<string>();
	for (const raw of progress) {
		const entry = RuntimeWorkflowProgressEntrySchema.safeParse(raw);
		if (entry.success && entry.data.type === "workflow_agent") ids.add(entry.data.agentId);
	}
	const timestamp = record?.["timestamp"];
	return {agentIds: ids, writtenAt: typeof timestamp === "string" ? timestamp : fileMtime(path)};
}

function fileMtime(path: string): string {
	try {
		return statSync(path).mtime.toISOString();
	} catch {
		return new Date(0).toISOString();
	}
}

/**
 * The statuses of run `runId`'s agents in session directory `sessionDir`, keyed
 * by bare agent id. `startedAt` is each agent's first transcript timestamp.
 */
export function readWorkflowAgentStatuses(
	sessionDir: string,
	runId: string,
	startedAt: ReadonlyMap<string, string>,
): Map<string, WorkflowAgentStatus> {
	const journal = readText(join(sessionDir, "subagents", "workflows", runId, "journal.jsonl"));
	if (journal === null) return new Map();
	const runFilePath = join(sessionDir, "workflows", `${runId}.json`);
	const runFile = readText(runFilePath);
	return workflowAgentStatuses(journal, runFile === null ? null : parseRunFile(runFile, runFilePath), startedAt);
}
