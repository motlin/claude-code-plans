import { Bot } from "lucide-react";
import type { ToolRendererProps } from "./types";
import type { KeyValueParam } from "./shared";
import { ErrorBorder, KeyValueCard } from "./shared";

const AGENT_ID_RE = /agentId:\s*(\S+)/;

export function AgentRenderer({ toolCall }: ToolRendererProps) {
  const prompt = (toolCall.input["prompt"] as string) ?? "";
  const agentType = (toolCall.input["subagent_type"] as string) ?? "";
  const description = (toolCall.input["description"] as string) ?? "";
  const parameter = (toolCall.input["parameter"] as string) ?? "";
  const { result, isError } = toolCall;

  const agentIdMatch = result?.match(AGENT_ID_RE);
  const displayResult = agentIdMatch?.[1]
    ? result!.replace(/agentId:\s*\S+\n?/, "").trim()
    : result;
  const agentSessionId = agentIdMatch?.[1] ? `agent-${agentIdMatch[1]}` : null;

  const params: KeyValueParam[] = [];
  if (description) params.push({ key: "description", value: description });
  if (prompt) params.push({ key: "prompt", value: prompt });
  if (agentType) params.push({ key: "subagent_type", value: agentType });
  if (parameter) params.push({ key: "parameter", value: parameter });

  return (
    <ErrorBorder isError={isError}>
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
