import type { ToolRendererProps } from "./types";
import { KeyValueCard } from "./shared";

export function GlobRenderer({ toolCall }: ToolRendererProps) {
  const pattern = (toolCall.input["pattern"] as string) ?? "";
  const path = toolCall.input["path"] as string | undefined;
  const { result, isError } = toolCall;

  const params: Array<{ key: string; value: string }> = [];
  if (pattern) params.push({ key: "pattern", value: pattern });
  if (path) params.push({ key: "path", value: path });

  return <KeyValueCard isError={isError} params={params} result={result ?? undefined} />;
}
