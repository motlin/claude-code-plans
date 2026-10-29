/**
 * Each workflow agent's state and attempt, read at request time from the run's
 * `journal.jsonl` and, once the run ends, its `workflows/<runId>.json`. Kept out
 * of the index because the run file lands after the agents' transcripts stop
 * changing, so an index-time value would never learn an agent was superseded.
 */
import {readFileSync} from "node:fs";
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

/**
 * Each agent's status from the journal's events. `finalAgentIds` is the run
 * file's `workflowProgress` agents, or null while the run has no run file.
 */
export function workflowAgentStatuses(
	journalText: string,
	finalAgentIds: ReadonlySet<string> | null,
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
	const statuses = new Map<string, WorkflowAgentStatus>();
	for (const [agentId, type] of lastEvent) {
		const unfinished: WorkflowAgentState = finalAgentIds === null ? "running" : "ended";
		statuses.set(agentId, {
			state: type === "result" ? "done" : type === "failed" ? "failed" : unfinished,
			attempt: finalAgentIds === null || finalAgentIds.has(agentId) ? "final" : "superseded",
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

function runFileAgentIds(text: string): Set<string> | null {
	let run: unknown;
	try {
		run = JSON.parse(text);
	} catch {
		return null;
	}
	const progress = asRecord(run)?.["workflowProgress"];
	if (!Array.isArray(progress)) return null;
	const ids = new Set<string>();
	for (const raw of progress) {
		const entry = RuntimeWorkflowProgressEntrySchema.safeParse(raw);
		if (entry.success && entry.data.type === "workflow_agent") ids.add(entry.data.agentId);
	}
	return ids;
}

/** The statuses of run `runId`'s agents in session directory `sessionDir`, keyed by bare agent id. */
export function readWorkflowAgentStatuses(sessionDir: string, runId: string): Map<string, WorkflowAgentStatus> {
	const journal = readText(join(sessionDir, "subagents", "workflows", runId, "journal.jsonl"));
	if (journal === null) return new Map();
	const runFile = readText(join(sessionDir, "workflows", `${runId}.json`));
	return workflowAgentStatuses(journal, runFile === null ? null : runFileAgentIds(runFile));
}
