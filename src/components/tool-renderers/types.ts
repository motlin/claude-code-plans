import type { ToolResultInfo } from "../../lib/sessions";
import type { ToolUseBlock } from "../../lib/schemas";
import type { Subagent } from "../../lib/subagents";
import { getAgentTypeOrNull, getTaskCreateDisplaySubject } from "../../lib/tool-utils";
import { buildSubagentTree } from "../../lib/subagent-tree";
import type {
  ParallelSubagentGroup,
  SubagentTreeEntry,
  SubagentTreeNode,
} from "../../lib/subagent-tree";

type ToolInput = Record<string, unknown>;

/**
 * Inline subagent decoration attached to an `Agent` tool call. Resolved from
 * the session's flat `Subagent[]` list so the chat view can show the spawned
 * agent's type/status, link straight to its session, and flag parallel batches.
 */
export interface SubagentInlineInfo {
  agentId: string;
  agentType: string | null;
  slug: string | null;
  description: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  status: "running" | "done" | "error";
  parallelGroupKey?: string | undefined;
  parallelGroupSize?: number | undefined;
}

/**
 * ClientToolCall is the flattened shape passed to individual tool renderers.
 * Built at render time from raw JSONL block + decorations + tool result info.
 */
export interface ClientToolCall {
  id: string;
  name: string;
  input: ToolInput;
  param: string;
  result?: string | undefined;
  isError?: boolean | undefined;
  duration?: number | undefined;
  sourceUuid: string;
  resultUuid?: string | undefined;
  subagentInfo?: SubagentInlineInfo | undefined;
}

export interface ToolRendererProps {
  toolCall: ClientToolCall;
  /**
   * True when the row is nested inside a grouped tool card, which already draws
   * the card chrome and names the tool. Nested renderers drop their own header
   * and card padding so the group never renders a card inside a card.
   */
  nested?: boolean | undefined;
  /**
   * True when the viewer is on the `verbose` verbosity preset. Renderers that
   * match upstream by hiding detail (TodoWrite's checklist, which upstream
   * never draws in the transcript) restore it here, so the reviewer can still
   * read data a live console would have shown elsewhere.
   */
  verbose?: boolean | undefined;
}

const AGENT_ID_RE = /agentId:\s*(\S+)/;

function isParallelGroup(entry: SubagentTreeEntry): entry is ParallelSubagentGroup {
  return (entry as ParallelSubagentGroup).type === "parallel";
}

function statusForAgent(agent: { finishedAt: string | null }): "running" | "done" | "error" {
  if (!agent.finishedAt) return "running";
  return "done";
}

export interface SubagentLookup {
  byBareId: Map<string, SubagentInlineInfo>;
  byTypeAndDescription: Map<string, SubagentInlineInfo>;
}

function lookupKey(agentType: string | null, description: string | null): string {
  return `${agentType ?? ""}::${description ?? ""}`;
}

/**
 * Build a lookup over a flat `Subagent[]` list keyed both by bare agent id and
 * by (agentType, description). Siblings started within 2s of each other are
 * clustered into parallel groups (via `buildSubagentTree`) so the chat can flag
 * `parallel ×N` batches. Depth is irrelevant to the inline decoration, so the
 * tree is flattened back out here.
 */
export function buildSubagentLookup(agents: Subagent[]): SubagentLookup {
  const byBareId = new Map<string, SubagentInlineInfo>();
  const byTypeAndDescription = new Map<string, SubagentInlineInfo>();
  let parallelCounter = 0;

  function addNode(node: SubagentTreeNode, parallelKey?: string, parallelSize?: number): void {
    const bareId = node.agent.id.replace(/^agent-/, "");
    const entry: SubagentInlineInfo = {
      agentId: node.agent.id,
      agentType: node.agent.agentType,
      slug: node.agent.slug,
      description: node.agent.description,
      startedAt: node.agent.startedAt,
      finishedAt: node.agent.finishedAt,
      status: statusForAgent(node.agent),
    };
    if (parallelKey !== undefined) entry.parallelGroupKey = parallelKey;
    if (parallelSize !== undefined) entry.parallelGroupSize = parallelSize;
    byBareId.set(bareId, entry);
    if (node.agent.description) {
      byTypeAndDescription.set(lookupKey(node.agent.agentType, node.agent.description), entry);
    }
    walk(node.children);
  }

  function walk(entries: SubagentTreeEntry[]): void {
    for (const entry of entries) {
      if (isParallelGroup(entry)) {
        const key = `pg-${parallelCounter++}`;
        const size = entry.children.length;
        for (const child of entry.children) {
          addNode(child, key, size);
        }
      } else {
        addNode(entry);
      }
    }
  }

  walk(buildSubagentTree(agents));
  return { byBareId, byTypeAndDescription };
}

function resolveSubagentInfo(
  name: string,
  input: Record<string, unknown>,
  result: string | undefined,
  isError: boolean | undefined,
  subagentLookup: SubagentLookup,
): SubagentInlineInfo | undefined {
  if (name !== "Agent") return undefined;

  let info: SubagentInlineInfo | undefined;
  if (result) {
    const match = AGENT_ID_RE.exec(result);
    if (match?.[1]) {
      info = subagentLookup.byBareId.get(match[1]);
    }
  }
  if (!info) {
    const inputAgentType = getAgentTypeOrNull(input);
    const inputDescription = (input["description"] as string) ?? null;
    if (inputDescription) {
      info = subagentLookup.byTypeAndDescription.get(lookupKey(inputAgentType, inputDescription));
    }
  }
  if (info) {
    return {
      ...info,
      status: isError ? "error" : info.status,
    };
  }
  return undefined;
}

/**
 * Live failure info derived from a `PostToolUseFailure` hook payload. Keyed
 * by tool_use_id in the caller's map. Lets the session view mark a tool call
 * as errored before the failure shows up in the JSONL (~2s after the hook).
 */
export interface LiveToolFailure {
  toolUseId: string;
  error: string;
}

/**
 * Build a ClientToolCall from a tool_use content block + sidecar maps.
 * Computes all decorations client-side (diff data, markdown rendering).
 *
 * `liveFailures` is an optional map keyed by `tool_use_id` of failures
 * received over SSE from `PostToolUseFailure` hooks. If the JSONL hasn't
 * caught up yet, the live failure flips `isError` and supplies `result` so
 * the renderer can show the error message immediately.
 */
export function buildClientToolCall(
  block: ToolUseBlock,
  sourceUuid: string,
  toolResultMap: Map<string, ToolResultInfo>,
  liveFailures?: Map<string, LiveToolFailure>,
  subagentLookup?: SubagentLookup,
): ClientToolCall {
  const id = block.id;
  const name = block.name;
  const input = block.input as ToolInput;

  const call: ClientToolCall = {
    id,
    name,
    input,
    param: getToolParam(name, block.input),
    sourceUuid,
  };

  // Attach tool result info from pairing map
  const resultInfo = toolResultMap.get(id);
  if (resultInfo) {
    call.result = resultInfo.result;
    if (resultInfo.isError) call.isError = true;
    call.resultUuid = resultInfo.resultUuid;
    if (resultInfo.duration !== undefined) call.duration = resultInfo.duration;
  }

  // Live failure override: if SSE told us this tool_use_id failed but the
  // JSONL hasn't been re-read yet, surface the error immediately.
  const liveFailure = liveFailures?.get(id);
  if (liveFailure && !call.isError) {
    call.isError = true;
    if (!call.result) call.result = liveFailure.error;
  }

  // Resolve inline subagent info client-side from the session's subagent list.
  if (subagentLookup) {
    const subagentInfo = resolveSubagentInfo(
      name,
      block.input,
      call.result,
      call.isError,
      subagentLookup,
    );
    if (subagentInfo) call.subagentInfo = subagentInfo;
  }

  return call;
}

function truncate(value: string, maxLength = 60): string {
  return value.length > maxLength ? value.slice(0, maxLength) + "..." : value;
}

/**
 * The call's own free-text description, when that is what the row shows as its
 * param (Bash and friends). Null when the param comes from somewhere else --
 * a file path, a query, a pattern.
 */
export function getToolDescription(name: string, input: Record<string, unknown>): string | null {
  if (name === "ToolSearch" || name === "TaskCreate") return null;
  if (typeof input["file_path"] === "string") return null;
  if (typeof input["description"] !== "string") return null;
  return truncate(input["description"]);
}

function getToolParam(name: string, input: Record<string, unknown>): string {
  if (name === "ToolSearch")
    return typeof input["query"] === "string" ? truncate(input["query"]) : "";
  if (name === "TaskCreate") return truncate(getTaskCreateDisplaySubject(input));
  // The schedule, not the prompt, is what "Scheduled ..." reads as upstream.
  if (name === "CronCreate") return typeof input["cron"] === "string" ? input["cron"] : "";
  if (typeof input["file_path"] === "string") return input["file_path"];
  const description = getToolDescription(name, input);
  if (description !== null) return description;
  if (typeof input["command"] === "string") return input["command"];
  if (typeof input["pattern"] === "string") return input["pattern"];
  if (typeof input["query"] === "string") return input["query"];
  if (typeof input["url"] === "string") return input["url"];
  if (typeof input["prompt"] === "string") return truncate(input["prompt"]);
  if (typeof input["skill"] === "string") return input["skill"];
  if (typeof input["subject"] === "string") return truncate(input["subject"]);
  if (typeof input["taskId"] === "string") return `#${input["taskId"]}`;
  if (typeof input["task_id"] === "string") return `#${input["task_id"]}`;
  return "";
}
