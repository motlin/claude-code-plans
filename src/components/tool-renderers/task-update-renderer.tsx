import type { ToolRendererProps } from "./types";
import { KeyValueCard } from "./shared";

export function TaskUpdateRenderer({ toolCall }: ToolRendererProps) {
  const taskId = (toolCall.input["taskId"] as string) ?? "";
  const status = (toolCall.input["status"] as string) ?? "";
  const subject = (toolCall.input["subject"] as string) ?? "";
  const description = (toolCall.input["description"] as string) ?? "";

  const params: Array<{ key: string; value: string }> = [];
  if (taskId) params.push({ key: "taskId", value: `#${taskId}` });
  if (status) params.push({ key: "status", value: status });
  if (subject) params.push({ key: "subject", value: subject });
  if (description) params.push({ key: "description", value: description });

  return (
    <KeyValueCard
      isError={toolCall.isError}
      params={params}
      result={toolCall.result ?? undefined}
    />
  );
}
