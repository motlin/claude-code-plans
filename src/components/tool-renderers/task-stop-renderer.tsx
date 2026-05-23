import type { ToolRendererProps } from "./types";
import { ErrorBorder, KeyValueCard } from "./shared";

export function TaskStopRenderer({ toolCall }: ToolRendererProps) {
  const taskId = (toolCall.input["task_id"] as string) ?? "";

  const params: Array<{ key: string; value: string }> = [];
  if (taskId) params.push({ key: "task_id", value: `#${taskId}` });

  return (
    <ErrorBorder isError={toolCall.isError}>
      <KeyValueCard params={params} result={toolCall.result ?? undefined} />
    </ErrorBorder>
  );
}
