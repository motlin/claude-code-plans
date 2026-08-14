import type { JsonValue } from "./hook-events";
import type { DbSubagent } from "./db/queries";
import { getAgentTypeOrNull } from "./tool-utils";

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

export function getSubagentLifecycleKey(
  sessionId: string,
  agentId: string,
  agentType: string,
): string {
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
  return {
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
  };
}

const AGENT_ID_RE = /agentId:\s*(\S+)/;

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name?: string;
  input?: Record<string, JsonValue>;
}

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id?: string;
  content?: string | Array<{ type?: string; text?: string }>;
}

type ContentBlock = ToolUseBlock | ToolResultBlock | { type: string };

interface TranscriptRecord {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  message?: { content?: string | ContentBlock[] };
}

function getResultText(block: ToolResultBlock): string {
  if (typeof block.content === "string") return block.content;
  if (Array.isArray(block.content)) {
    return block.content
      .filter(
        (b): b is { type: string; text: string } => b.type === "text" && typeof b.text === "string",
      )
      .map((b) => b.text)
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
): { agents: Subagent[]; activeSubagents: ActiveSubagent[] } {
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
        const toolUse = block as ToolUseBlock;
        if (toolUse.name !== "Agent" || typeof toolUse.id !== "string") continue;
        const input = toolUse.input ?? {};
        const agentType = getAgentTypeOrNull(input);
        const description =
          typeof input["description"] === "string" ? (input["description"] as string) : null;
        pendingByToolUseId.set(toolUse.id, {
          agentType,
          description,
          startedAt: record.timestamp ?? null,
          sessionId,
        });
        continue;
      }

      if (block.type === "tool_result") {
        const toolResult = block as ToolResultBlock;
        if (typeof toolResult.tool_use_id !== "string") continue;
        const pending = pendingByToolUseId.get(toolResult.tool_use_id);
        if (!pending) continue;
        const text = getResultText(toolResult);
        const match = AGENT_ID_RE.exec(text);
        if (!match || !match[1]) {
          pendingByToolUseId.delete(toolResult.tool_use_id);
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
        pendingByToolUseId.delete(toolResult.tool_use_id);
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

export function extractPendingSubagents(records: TranscriptRecord[]): ActiveSubagent[] {
  return extractSubagentSnapshot(records, "").activeSubagents;
}
