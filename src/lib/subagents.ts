import {z} from "zod";
import type {DbSubagent} from "./db/queries";
import {getAgentTypeOrNull} from "./tool-utils";
import {asRecord, isRecord} from "./narrow";
import {SlowCommandSchema, type SlowCommand} from "./slow-commands";
import type {WorkflowAgentState, WorkflowAttempt} from "./workflow-journal";

/**
 * Subagent record extracted from transcript JSONL records.
 *
 * This shape is the client contract shared by the subagent API endpoints,
 * transcript-derived extraction, and the Tree/Gantt/Sequence visualizations.
 * It mirrors the historical `DbSubagent` shape while omitting server-only
 * filesystem metadata.
 *
 * Transcript-derived extraction leaves `parentAgentId` null because a single
 * transcript cannot reveal relationships across nested subagent JSONL files.
 * API handlers use DB-backed rows, which preserve parent links established by
 * the indexer.
 */
export interface Subagent {
	id: string;
	sessionId: string;
	projectId: string;
	parentAgentId: string | null;
	agentType: string | null;
	attributionAgent: string | null;
	slug: string | null;
	description: string | null;
	/** Raw model id the agent ran on, e.g. `claude-haiku-4-5-20251001`. */
	model: string | null;
	startedAt: string | null;
	finishedAt: string | null;
	/** The slow foreground commands the agent ran, which upstream tracks as tasks; see `SLOW_COMMAND_MS`. */
	slowCommands?: SlowCommand[] | undefined;
	/** The meta.json `taskKind`, e.g. `in_process_teammate`. */
	taskKind?: string | null | undefined;
	/** The name a teammate is addressed and stopped by. */
	name?: string | null | undefined;
	/** A successful TaskStop in the main transcript stopped this teammate. */
	stopped?: true | undefined;
	/** The description of the agent's foreground Bash call still waiting on its result. */
	pendingCommand?: string | null | undefined;
	/** The agent's last turn ended and nothing has woken it since; an idle teammate is not a running task upstream. */
	idle?: boolean | undefined;
	/** The workflow run (`wf_…`) this agent ran in. */
	workflowRunId?: string | null | undefined;
	/** The agent's workflow phase title. */
	workflowPhase?: string | null | undefined;
	/** The agent's 1-based workflow phase index. */
	workflowPhaseIndex?: number | null | undefined;
	/** The agent's state from its run's journal. */
	workflowState?: WorkflowAgentState | undefined;
	/** Whether the agent belongs to its run's final launch or an earlier, superseded attempt. */
	workflowAttempt?: WorkflowAttempt | undefined;
}

export interface ActiveSubagent {
	key: string;
	sessionId: string;
	agentType: string;
	agentId: string;
	description: string;
}

export function toSubagentSessionId(agentId: string): string {
	return agentId.startsWith("agent-") ? agentId : `agent-${agentId}`;
}

export function getSubagentLifecycleKey(sessionId: string, agentId: string, agentType: string): string {
	const unprefixedAgentId = agentId.startsWith("agent-") ? agentId.slice("agent-".length) : agentId;
	return `${sessionId}:${unprefixedAgentId || agentType}`;
}

/**
 * Project the DB-backed `DbSubagent` row onto the client `Subagent` wire shape,
 * dropping the server-only `filePath`/`mtimeMs` fields. The DB is the only source
 * that carries a real `parentAgentId` (via `linkSubagentParents`), so the
 * subagent endpoints map through here rather than deriving flat records from
 * individual transcripts.
 */
export function toClientSubagent(row: DbSubagent): Subagent {
	const slowCommands = SlowCommandsSchema.safeParse(JSON.parse(row.slowCommandsJson ?? "[]"));
	return {
		...(slowCommands.success && slowCommands.data.length > 0 ? {slowCommands: slowCommands.data} : {}),
		id: row.id,
		sessionId: row.sessionId,
		projectId: row.projectId,
		parentAgentId: row.parentAgentId,
		agentType: row.agentType,
		attributionAgent: row.attributionAgent,
		slug: row.slug,
		description: row.description,
		model: row.model,
		startedAt: row.startedAt,
		finishedAt: row.finishedAt,
		...(row.taskKind == null ? {} : {taskKind: row.taskKind}),
		...(row.name == null ? {} : {name: row.name}),
		...(row.pendingCommand == null ? {} : {pendingCommand: row.pendingCommand}),
		...(row.idle === true ? {idle: true as const} : {}),
		...(row.workflowRunId == null ? {} : {workflowRunId: row.workflowRunId}),
		...(row.workflowPhase == null ? {} : {workflowPhase: row.workflowPhase}),
		...(row.workflowPhaseIndex == null ? {} : {workflowPhaseIndex: row.workflowPhaseIndex}),
	};
}

const SlowCommandsSchema = z.array(SlowCommandSchema);

const AGENT_ID_RE = /agentId:\s*(\S+)/;

interface ContentBlock {
	type: string;
	[key: string]: unknown;
}

interface TranscriptRecord {
	type?: string;
	timestamp?: string;
	sessionId?: string;
	message?: {content?: string | ContentBlock[]};
}

function getResultText(block: ContentBlock): string {
	const content = block["content"];
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.flatMap((b: unknown) => {
				const text = isRecord(b) && b["type"] === "text" ? b["text"] : undefined;
				return typeof text === "string" ? [text] : [];
			})
			.join(" ");
	}
	return "";
}

/**
 * Extract subagent invocations from a transcript record stream.
 *
 * Each record where the assistant invokes the `Agent` tool produces one
 * subagent entry. The matching `tool_result` (looked up by `tool_use_id`)
 * supplies the agent id (`agentId: agent-...`) and the finishedAt timestamp.
 *
 * The completed entries remain useful while scanning because they distinguish
 * finished invocations from agents that are still active.
 */
function extractSubagentSnapshot(
	records: TranscriptRecord[],
	projectId: string,
): {agents: Subagent[]; activeSubagents: ActiveSubagent[]} {
	const pendingByToolUseId = new Map<
		string,
		{
			agentType: string | null;
			description: string | null;
			startedAt: string | null;
			sessionId: string;
		}
	>();
	const results: Subagent[] = [];

	for (const record of records) {
		const content = record.message?.content;
		if (!Array.isArray(content)) continue;
		const sessionId = record.sessionId ?? "";

		for (const block of content) {
			if (block.type === "tool_use") {
				const toolUseId = block["id"];
				if (block["name"] !== "Agent" || typeof toolUseId !== "string") continue;
				const input = asRecord(block["input"]) ?? {};
				const agentType = getAgentTypeOrNull(input);
				const description = typeof input["description"] === "string" ? input["description"] : null;
				pendingByToolUseId.set(toolUseId, {
					agentType,
					description,
					startedAt: record.timestamp ?? null,
					sessionId,
				});
				continue;
			}

			if (block.type === "tool_result") {
				const toolUseId = block["tool_use_id"];
				if (typeof toolUseId !== "string") continue;
				const pending = pendingByToolUseId.get(toolUseId);
				if (!pending) continue;
				const text = getResultText(block);
				const match = AGENT_ID_RE.exec(text);
				if (!match?.[1]) {
					pendingByToolUseId.delete(toolUseId);
					continue;
				}
				const id = `agent-${match[1]}`;
				results.push({
					id,
					sessionId: pending.sessionId,
					projectId,
					parentAgentId: null,
					agentType: pending.agentType,
					attributionAgent: null,
					slug: null,
					description: pending.description,
					model: null,
					startedAt: pending.startedAt,
					finishedAt: record.timestamp ?? null,
				});
				pendingByToolUseId.delete(toolUseId);
			}
		}
	}

	return {
		agents: results,
		activeSubagents: [...pendingByToolUseId].map(([toolUseId, pending]) => ({
			key: toolUseId,
			sessionId: pending.sessionId,
			agentType: pending.agentType ?? "",
			agentId: "",
			description: pending.description ?? "",
		})),
	};
}

/**
 * Map each finished `Agent` call's subagent session id (`agent-<id>`) to the
 * prompt the parent gave it, matching the call to its result's `agentId:` line.
 */
export function extractAgentPrompts(records: TranscriptRecord[]): Map<string, string> {
	const promptByToolUseId = new Map<string, string>();
	const prompts = new Map<string, string>();
	for (const record of records) {
		const content = record.message?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (block.type === "tool_use") {
				const toolUseId = block["id"];
				const prompt = asRecord(block["input"])?.["prompt"];
				if (block["name"] === "Agent" && typeof toolUseId === "string" && typeof prompt === "string") {
					promptByToolUseId.set(toolUseId, prompt);
				}
				continue;
			}
			if (block.type !== "tool_result") continue;
			const toolUseId = block["tool_use_id"];
			if (typeof toolUseId !== "string") continue;
			const prompt = promptByToolUseId.get(toolUseId);
			const agentId = AGENT_ID_RE.exec(getResultText(block))?.[1];
			if (prompt !== undefined && agentId !== undefined) prompts.set(toSubagentSessionId(agentId), prompt);
		}
	}
	return prompts;
}

export function extractPendingSubagents(records: TranscriptRecord[]): ActiveSubagent[] {
	return extractSubagentSnapshot(records, "").activeSubagents;
}
