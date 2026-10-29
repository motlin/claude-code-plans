import {dirname} from "node:path";
import {eq} from "drizzle-orm";
import {z} from "zod";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import {getSubagentsForSession} from "./queries";
import type {DbSubagent} from "./queries";
import {toClientSubagent, type Subagent} from "../subagents";
import {readWorkflowAgentStatuses, type WorkflowAgentStatus} from "../workflow-journal";

type IndexDb = BetterSQLite3Database<typeof schema>;

const StoppedTaskIdsSchema = z.array(z.string());

const IN_PROCESS_TEAMMATE = "in_process_teammate";

/**
 * The session's subagents as the client sees them, each teammate a successful
 * TaskStop in the main transcript named (by name or agent id) marked stopped.
 */
export function sessionSubagentsWithStops(db: IndexDb, sessionId: string): Subagent[] {
	const agents = getSubagentsForSession(db, sessionId);
	return withWorkflowStatuses(agents, withStops(db, sessionId, agents));
}

function withStops(db: IndexDb, sessionId: string, agents: DbSubagent[]): Subagent[] {
	// Only teammates can be stopped by name, so a session without one costs no second query.
	if (!agents.some((agent) => agent.taskKind === IN_PROCESS_TEAMMATE)) return agents.map(toClientSubagent);
	const row = db
		.select({stopped: schema.sessions.stoppedTaskIdsJson})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.get();
	const parsed = StoppedTaskIdsSchema.safeParse(JSON.parse(row?.stopped ?? "[]"));
	const stopped = new Set(parsed.success ? parsed.data : []);
	return agents.map((agent) => {
		const client = toClientSubagent(agent);
		const bareId = bareAgentId(agent.id);
		const isStopped = stopped.has(bareId) || (agent.name != null && stopped.has(agent.name));
		return isStopped ? {...client, stopped: true} : client;
	});
}

/**
 * Each workflow agent with its journal state and attempt, read per run at
 * request time: the run file that supersedes earlier attempts lands after their
 * transcripts stop changing, so the index never sees it.
 */
function withWorkflowStatuses(rows: DbSubagent[], agents: Subagent[]): Subagent[] {
	const statusesByRun = new Map<string, Map<string, WorkflowAgentStatus>>();
	return agents.map((agent, index) => {
		const runId = agent.workflowRunId;
		const filePath = rows[index]?.filePath;
		if (!runId || filePath === undefined) return agent;
		let statuses = statusesByRun.get(runId);
		if (statuses === undefined) {
			// `<session>/subagents/workflows/<runId>/agent-<id>.jsonl`
			const sessionDir = dirname(dirname(dirname(dirname(filePath))));
			statuses = readWorkflowAgentStatuses(sessionDir, runId, runStartTimes(rows, runId));
			statusesByRun.set(runId, statuses);
		}
		const status = statuses.get(bareAgentId(agent.id));
		return status === undefined ? agent : {...agent, workflowState: status.state, workflowAttempt: status.attempt};
	});
}

function bareAgentId(id: string): string {
	return id.startsWith("agent-") ? id.slice("agent-".length) : id;
}

/** Each of run `runId`'s agents' start time, keyed by bare agent id. */
function runStartTimes(rows: DbSubagent[], runId: string): Map<string, string> {
	const startedAt = new Map<string, string>();
	for (const row of rows)
		if (row.workflowRunId === runId && row.startedAt !== null) startedAt.set(bareAgentId(row.id), row.startedAt);
	return startedAt;
}
