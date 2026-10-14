import {eq} from "drizzle-orm";
import {z} from "zod";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import {getSubagentsForSession} from "./queries";
import {toClientSubagent, type Subagent} from "../subagents";

type IndexDb = BetterSQLite3Database<typeof schema>;

const StoppedTaskIdsSchema = z.array(z.string());

const IN_PROCESS_TEAMMATE = "in_process_teammate";

/**
 * The session's subagents as the client sees them, each teammate a successful
 * TaskStop in the main transcript named (by name or agent id) marked stopped.
 */
export function sessionSubagentsWithStops(db: IndexDb, sessionId: string): Subagent[] {
	const agents = getSubagentsForSession(db, sessionId);
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
		const bareId = agent.id.startsWith("agent-") ? agent.id.slice("agent-".length) : agent.id;
		const isStopped = stopped.has(bareId) || (agent.name != null && stopped.has(agent.name));
		return isStopped ? {...client, stopped: true} : client;
	});
}
