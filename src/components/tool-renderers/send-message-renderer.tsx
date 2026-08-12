import type { ToolRendererProps } from "./types";
import { KeyValueCard } from "./shared";

export function SendMessageRenderer({ toolCall }: ToolRendererProps) {
  const recipient =
    (toolCall.input["to"] as string) ?? (toolCall.input["recipient"] as string) ?? "";
  const message =
    (toolCall.input["message"] as string) ??
    (toolCall.input["content"] as string) ??
    (toolCall.input["prompt"] as string) ??
    "";
  const summary = (toolCall.input["summary"] as string) ?? "";

  const params: Array<{ key: string; value: string }> = [];
  if (recipient) params.push({ key: "to", value: recipient });
  if (summary) params.push({ key: "summary", value: summary });
  if (message) params.push({ key: "message", value: message });

  return (
    <KeyValueCard
      isError={toolCall.isError}
      params={params}
      result={toolCall.result ?? undefined}
    />
  );
}
