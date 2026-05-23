import type { ToolRendererProps } from "./types";
import { ErrorBorder, KeyValueCard } from "./shared";

export function TaskCreateRenderer({ toolCall }: ToolRendererProps) {
  const subject = (toolCall.input["subject"] as string) ?? "";
  const description = (toolCall.input["description"] as string) ?? "";

  const params: Array<{ key: string; value: string }> = [];
  if (subject) params.push({ key: "subject", value: subject });
  if (description) params.push({ key: "description", value: description });

  return (
    <ErrorBorder isError={toolCall.isError}>
      <KeyValueCard params={params} result={toolCall.result ?? undefined} />
    </ErrorBorder>
  );
}
