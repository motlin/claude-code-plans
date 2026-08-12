import type { ToolRendererProps } from "./types";
import { KeyValueCard } from "./shared";

export function EnterPlanModeRenderer({ toolCall }: ToolRendererProps) {
  const { result } = toolCall;

  return (
    <KeyValueCard
      isError={toolCall.isError}
      params={[]}
      result={result && result !== "success" ? result : undefined}
    />
  );
}
