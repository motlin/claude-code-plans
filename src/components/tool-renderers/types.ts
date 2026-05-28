import type { ToolResultInfo } from "../../lib/sessions";
import type { ToolUseBlock } from "../../lib/schemas";

type ToolInput = Record<string, unknown>;

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
}

export interface ToolRendererProps {
  toolCall: ClientToolCall;
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

  return call;
}

function truncate(value: string, maxLength = 60): string {
  return value.length > maxLength ? value.slice(0, maxLength) + "..." : value;
}

function getToolParam(name: string, input: Record<string, unknown>): string {
  if (name === "ToolSearch")
    return typeof input["query"] === "string" ? truncate(input["query"]) : "";
  if (typeof input["file_path"] === "string") return input["file_path"];
  if (typeof input["description"] === "string") return truncate(input["description"]);
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
