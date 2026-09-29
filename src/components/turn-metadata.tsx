import { Folder, GitBranch } from "lucide-react";
import { formatModelName } from "../lib/model-name";
import type { MessageSessionLine } from "../lib/transcript";

type AssistantMessage = NonNullable<MessageSessionLine["message"]>;
type InputTransformation = NonNullable<AssistantMessage["input_transformations"]>[number];
type SafeguardResult = NonNullable<AssistantMessage["safeguard_results"]>[number];

const THINKING_DROPPED = "thinking_dropped";
const NOT_FLAGGED = "not_flagged";
const AVAILABLE = "available";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Dropped-thinking count and a reason tally, e.g. "model_binding_mismatch ×2". */
function summarizeDroppedThinking(
  transformations: readonly InputTransformation[] | undefined,
): { count: number; title: string } | undefined {
  const dropped = (transformations ?? []).filter((t) => t.type === THINKING_DROPPED);
  if (dropped.length === 0) return undefined;
  const reasons = new Map<string, number>();
  for (const t of dropped) {
    const reason = t.reason ?? "unknown";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const tally = Array.from(reasons, ([reason, n]) => `${reason} ×${n}`).join(", ");
  return { count: dropped.length, title: `Thinking dropped from the request: ${tally}` };
}

/** Safeguard results worth flagging: tool calls with a non-clean outcome, and checks that did not run. */
function summarizeSafeguards(
  results: readonly SafeguardResult[] | undefined,
): { label: string; title: string } | undefined {
  const details: string[] = [];
  let flagged = 0;
  let unavailable = 0;
  for (const result of results ?? []) {
    const status = result.status;
    if (status?.type !== AVAILABLE) {
      unavailable++;
      details.push(`${result.type}: ${status?.type ?? "no status"}`);
      continue;
    }
    for (const [toolUseId, toolUse] of Object.entries(status.tool_uses ?? {})) {
      if (toolUse.outcome === undefined || toolUse.outcome === NOT_FLAGGED) continue;
      flagged++;
      details.push(`${result.type}: ${toolUseId} ${toolUse.outcome}`);
    }
  }
  if (details.length === 0) return undefined;
  const parts: string[] = [];
  if (flagged > 0) parts.push(`flagged ${plural(flagged, "tool call")}`);
  if (unavailable > 0) parts.push(`${unavailable} unavailable`);
  return { label: `safeguard ${parts.join(" · ")}`, title: details.join("\n") };
}

/**
 * Per-turn request metadata for an assistant message's hover toolbar: effort,
 * advisor model, and flags for dropped thinking and safeguard outcomes.
 */
export function AssistantTurnMeta({ line }: { line: MessageSessionLine }) {
  const advisor =
    line.advisorModel !== undefined
      ? (formatModelName(line.advisorModel) ?? line.advisorModel)
      : undefined;
  const dropped = summarizeDroppedThinking(line.message?.input_transformations);
  const safeguards = summarizeSafeguards(line.message?.safeguard_results);
  if (
    line.perTurnEffort === undefined &&
    advisor === undefined &&
    dropped === undefined &&
    safeguards === undefined
  ) {
    return null;
  }
  return (
    <>
      {line.perTurnEffort !== undefined && (
        <span className="text-[11px] text-secondary" title="Per-turn effort">
          {line.perTurnEffort} effort
        </span>
      )}
      {advisor !== undefined && (
        <span className="text-[11px] text-secondary" title={`Advisor model ${line.advisorModel}`}>
          advisor {advisor}
        </span>
      )}
      {dropped !== undefined && (
        <span
          className="text-[10px] text-warning-100 rounded-full bg-surface-0 px-1.5"
          title={dropped.title}
        >
          {plural(dropped.count, "thinking block")} dropped
        </span>
      )}
      {safeguards !== undefined && (
        <span
          className="text-[10px] text-danger-000 rounded-full bg-surface-0 px-1.5"
          title={safeguards.title}
        >
          {safeguards.label}
        </span>
      )}
    </>
  );
}

/** The branch (or live cwd) the server-side classifier saw for a user turn. */
export function UserTurnContext({ line }: { line: MessageSessionLine }) {
  const context = line.classifierContext;
  const shown = context?.branch ?? context?.liveCwd;
  if (context === undefined || shown === undefined) return null;
  const title = [context.liveCwd, context.platform].filter((part) => part !== undefined);
  return (
    <span
      className="flex items-center gap-0.5 min-w-0 text-[11px] text-secondary"
      title={`Classifier context: ${title.join(" · ")}`}
    >
      {context.branch !== undefined ? (
        <GitBranch className="h-3 w-3 shrink-0" />
      ) : (
        <Folder className="h-3 w-3 shrink-0" />
      )}
      <span className="truncate font-mono">{shown}</span>
    </span>
  );
}
