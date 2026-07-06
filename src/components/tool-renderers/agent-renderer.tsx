import { Bot } from "lucide-react";
import type { ToolRendererProps } from "./types";
import type { KeyValueParam } from "./shared";
import { ErrorBorder, KeyValueCard } from "./shared";
import { getAgentTypeFromInput } from "../../lib/tool-utils";

const AGENT_ID_RE = /agentId:\s*(\S+)/;

const STATUS_LABELS: Record<"running" | "done" | "error", string> = {
  running: "running",
  done: "done",
  error: "error",
};

const STATUS_STYLES: Record<"running" | "done" | "error", string> = {
  running: "bg-accent-000/12 text-accent-100",
  done: "bg-success-900 text-success-000",
  error: "bg-danger-900 text-danger-000",
};

export function AgentRenderer({ toolCall }: ToolRendererProps) {
  const prompt = (toolCall.input["prompt"] as string) ?? "";
  const agentType = getAgentTypeFromInput(toolCall.input);
  const description = (toolCall.input["description"] as string) ?? "";
  const parameter = (toolCall.input["parameter"] as string) ?? "";
  const { result, isError, subagentInfo } = toolCall;

  const agentIdMatch = result?.match(AGENT_ID_RE);
  const displayResult = agentIdMatch?.[1]
    ? result!.replace(/agentId:\s*\S+\n?/, "").trim()
    : result;
  // Prefer the resolved subagent id (carries the whole nested tree); fall back
  // to the bare id parsed out of the tool result text.
  const agentSessionId =
    subagentInfo?.agentId ?? (agentIdMatch?.[1] ? `agent-${agentIdMatch[1]}` : null);

  const slug = subagentInfo?.slug ?? "";
  const parallelSize = subagentInfo?.parallelGroupSize;
  const status = subagentInfo?.status;

  const params: KeyValueParam[] = [];
  if (description) params.push({ key: "description", value: description });
  if (prompt) params.push({ key: "prompt", value: prompt });
  if (agentType) params.push({ key: "agentType", value: agentType });
  if (slug) params.push({ key: "slug", value: slug });
  if (parameter) params.push({ key: "parameter", value: parameter });

  return (
    <ErrorBorder isError={isError}>
      {(status || (parallelSize && parallelSize > 1)) && (
        <div className="mb-1 flex items-center gap-1.5">
          {status && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLES[status]}`}
            >
              {STATUS_LABELS[status]}
            </span>
          )}
          {parallelSize && parallelSize > 1 && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-accent-000/12 text-accent-100">
              parallel &times;{parallelSize}
            </span>
          )}
        </div>
      )}
      <KeyValueCard params={params} result={displayResult ?? undefined} />
      {agentSessionId && (
        <a
          href={`/session/${agentSessionId}`}
          className="mt-2 inline-flex items-center gap-1 text-xs text-accent-100 hover:underline"
        >
          <Bot className="h-3 w-3" />
          View subagent session
        </a>
      )}
    </ErrorBorder>
  );
}
