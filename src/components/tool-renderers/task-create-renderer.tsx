import type { ToolRendererProps } from "./types";
import { ErrorBorder, KeyValueCard } from "./shared";
import { getTaskCreateDisplaySubject } from "../../lib/tool-utils";

export function getTaskCreateParams(
  input: Record<string, unknown>,
): Array<{ key: string; value: string }> {
  const subject = getTaskCreateDisplaySubject(input);
  const description = (input["description"] as string) ?? "";
  const activeForm = (input["activeForm"] as string) ?? "";
  const params: Array<{ key: string; value: string }> = [];
  if (subject) params.push({ key: "subject", value: subject });
  if (description && description !== subject) {
    params.push({ key: "description", value: description });
  }
  if (activeForm && activeForm !== subject) {
    params.push({ key: "activeForm", value: activeForm });
  }
  return params;
}

export function TaskCreateRenderer({ toolCall }: ToolRendererProps) {
  return (
    <ErrorBorder isError={toolCall.isError}>
      <KeyValueCard
        params={getTaskCreateParams(toolCall.input)}
        result={toolCall.result ?? undefined}
      />
    </ErrorBorder>
  );
}
