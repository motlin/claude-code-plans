import { Bot } from "lucide-react";
import type { ToolRendererProps } from "./types";
import type { KeyValueParam } from "./shared";
import { KeyValueCard } from "./shared";
import { getAgentTypeFromInput } from "../../lib/tool-utils";

const AGENT_ID_RE = /agentId:\s*(\S+)/;

export function AgentRenderer({ toolCall }: ToolRendererProps) {
  const prompt = (toolCall.input["prompt"] as string) ?? "";
  const agentType = getAgentTypeFromInput(toolCall.input);
  const description = (toolCall.input["description"] as string) ?? "";
  const effort = (toolCall.input["effort"] as string) ?? "";
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
  if (effort) params.push({ key: "effort", value: effort });
  if (slug) params.push({ key: "slug", value: slug });
  if (parameter) params.push({ key: "parameter", value: parameter });

  // Upstream labels no subagent status: a finished agent needs no "done" badge
  // and a failed one already reads pink. A still-running agent is the one state
  // a session reviewer can't infer, so it stays -- as plain body text, not a
  // pill, since upstream has no pill anywhere in a transcript body.
  const notes: string[] = [];
  if (status === "running") notes.push("running");
  if (parallelSize !== undefined && parallelSize > 1) notes.push(`parallel ×${parallelSize}`);

  return (
    <>
      {notes.length > 0 && (
        <div className="mb-1 text-body text-assistant-secondary">{notes.join(" · ")}</div>
      )}
      <KeyValueCard isError={isError} params={params} result={displayResult ?? undefined} />
      {agentSessionId && (
        <a
          href={`/session/${agentSessionId}`}
          className="mt-2 inline-flex items-center gap-1 text-xs text-accent-100 hover:underline"
        >
          <Bot className="h-3 w-3" />
          View subagent session
        </a>
      )}
    </>
  );
}
