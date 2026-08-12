import type { ToolRendererProps } from "./types";
import { KeyValueCard } from "./shared";

/**
 * The tool "result" for a successful EnterPlanMode call is a ~600-character
 * block of model-only instructions ("Entered plan mode. You should now focus on
 * exploring the codebase ... DO NOT write or edit any files yet."), identical
 * every time. Upstream claude.ai/code shows a short human status line instead.
 */
const INSTRUCTION_RESULT_RE = /^Entered plan mode/;

/**
 * EnterPlanMode takes no input, so there is nothing to show for a successful
 * call beyond the row's own "Entered plan mode" label. The renderer draws
 * nothing in that case; only a genuine failure gets a card.
 */
export function EnterPlanModeRenderer({ toolCall }: ToolRendererProps) {
  const { result } = toolCall;

  const isBoilerplate = !result || result === "success" || INSTRUCTION_RESULT_RE.test(result);
  if (!toolCall.isError && isBoilerplate) return null;

  return <KeyValueCard isError={toolCall.isError} params={[]} result={result} />;
}
