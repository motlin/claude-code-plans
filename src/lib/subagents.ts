import type { JsonValue } from "./hook-events";
import { getAgentTypeOrNull } from "./tool-utils";

/**
 * Subagent record extracted from transcript JSONL records.
 *
 * This shape is the contract between transcript-derived extraction and the
 * Gantt/Sequence visualisation components. It mirrors the historical
 * `DbSubagent` shape closely enough that those components can keep using the
 * same field names.
 *
 * `parentAgentId` is left null when the parent transcript is the root session
 * (we cannot detect parent-child relationships across nested subagent JSONL
 * files from a single transcript). For most sessions this is fine because
 * subagent depth is rarely > 1 in practice; the project-aggregate handler
 * (Phase 2c) walks every transcript so the same constraint applies.
 */
export interface Subagent {
  id: string;
  sessionId: string;
  projectId: string;
  parentAgentId: string | null;
  agentType: string | null;
  slug: string | null;
  description: string | null;
  startedAt: string | null;
  finishedAt: string | null;
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
 * The same `extractSubagents` utility is used both by the client session view
 * and by the project-aggregate `/api/projects/:id/subagents` handler so the
 * two sources stay in sync without a separate per-session API endpoint.
 */
export function extractSubagents(records: TranscriptRecord[], projectId: string): Subagent[] {
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
          slug: null,
          description: pending.description,
          startedAt: pending.startedAt,
          finishedAt: record.timestamp ?? null,
        });
        pendingByToolUseId.delete(toolResult.tool_use_id);
      }
    }
  }

  return results;
}
