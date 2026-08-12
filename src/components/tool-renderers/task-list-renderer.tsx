import type { ToolRendererProps } from "./types";
import { KeyValueCard } from "./shared";

export function TaskListRenderer({ toolCall }: ToolRendererProps) {
  return (
    <KeyValueCard isError={toolCall.isError} params={[]} result={toolCall.result ?? undefined} />
  );
}
