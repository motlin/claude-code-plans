import type { ToolRendererProps } from "./types";
import { ErrorBorder, KeyValueCard } from "./shared";

export function TaskGetRenderer({ toolCall }: ToolRendererProps) {
  const taskId = toolCall.input["taskId"] ?? toolCall.input["id"];

  const params: Array<{ key: string; value: string }> = [];
  if (typeof taskId === "string" || typeof taskId === "number") {
    params.push({ key: "taskId", value: `#${taskId}` });
  }

  return (
    <ErrorBorder isError={toolCall.isError}>
      <KeyValueCard params={params} result={toolCall.result ?? undefined} />
    </ErrorBorder>
  );
}
