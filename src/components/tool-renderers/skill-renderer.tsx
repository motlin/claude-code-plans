import type { ToolRendererProps } from "./types";
import { KeyValueCard } from "./shared";

export function SkillRenderer({ toolCall }: ToolRendererProps) {
  const skill = (toolCall.input["skill"] as string) ?? "";
  const args = toolCall.input["args"] as string | undefined;
  const { result, isError } = toolCall;

  const params: Array<{ key: string; value: string }> = [];
  if (skill) params.push({ key: "skill", value: skill });
  if (args) params.push({ key: "args", value: args });

  return <KeyValueCard isError={isError} params={params} result={result ?? undefined} />;
}
