import {formatTokens} from "../components/system-banner";
import {formatModelName} from "./model-name";
import {promptSourceLabels, turnOriginLabels} from "./schema-choices";
import type {MessageSessionLine} from "./transcript";

/*
 * Per-turn facts that upstream claude.ai/code never shows inline. They live in
 * the hover toolbar's `<time>` tooltip, one line each, after the timestamp.
 */

type AssistantMessage = NonNullable<MessageSessionLine["message"]>;
type InputTransformation = NonNullable<AssistantMessage["input_transformations"]>[number];
type SafeguardResult = NonNullable<AssistantMessage["safeguard_results"]>[number];

const THINKING_DROPPED = "thinking_dropped";
const NOT_FLAGGED = "not_flagged";
const AVAILABLE = "available";

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Compact token usage, e.g. "595.8k in / 595 out", counting cache reads and writes as input. */
function usageDetail(usage: MessageSessionLine["usage"]): string | undefined {
	if (usage === undefined) return undefined;
	const num = (key: string): number => {
		const value = usage[key];
		return typeof value === "number" ? value : 0;
	};
	const totalIn = num("input_tokens") + num("cache_read_input_tokens") + num("cache_creation_input_tokens");
	const output = num("output_tokens");
	if (totalIn === 0 && output === 0) return undefined;
	return `${formatTokens(totalIn)} in / ${formatTokens(output)} out`;
}

/** Dropped-thinking count with a reason tally, e.g. "3 thinking blocks dropped (model_binding_mismatch ×2)". */
function droppedThinkingDetail(transformations: readonly InputTransformation[] | undefined): string | undefined {
	const dropped = (transformations ?? []).filter((t) => t.type === THINKING_DROPPED);
	if (dropped.length === 0) return undefined;
	const reasons = new Map<string, number>();
	for (const t of dropped) {
		const reason = t.reason ?? "unknown";
		reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
	}
	const tally = Array.from(reasons, ([reason, n]) => `${reason} ×${n}`).join(", ");
	return `${plural(dropped.length, "thinking block")} dropped (${tally})`;
}

/** Safeguard results worth flagging: tool calls with a non-clean outcome, and checks that did not run. */
function safeguardDetail(results: readonly SafeguardResult[] | undefined): string | undefined {
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
	return `safeguard ${parts.join(" · ")} (${details.join("; ")})`;
}

/** An assistant turn's usage, truncation, effort, advisor, dropped thinking and safeguard flags. */
export function assistantTurnDetails(line: MessageSessionLine): string[] {
	const advisor =
		line.advisorModel !== undefined ? (formatModelName(line.advisorModel) ?? line.advisorModel) : undefined;
	return [
		usageDetail(line.usage),
		line.stopReason === "max_tokens" ? "Truncated at max tokens" : undefined,
		line.perTurnEffort !== undefined ? `${line.perTurnEffort} effort` : undefined,
		advisor !== undefined ? `advisor ${advisor}` : undefined,
		droppedThinkingDetail(line.message?.input_transformations),
		safeguardDetail(line.message?.safeguard_results),
	].filter((detail) => detail !== undefined);
}

/** Where a user turn came from (peer, task notification, scheduled task) and how it was submitted. */
function originDetail(line: MessageSessionLine): string | undefined {
	const parts: string[] = [];
	if (line.turnOrigin !== undefined && line.turnOrigin !== "human") {
		const origin = turnOriginLabels[line.turnOrigin];
		parts.push(
			line.turnOrigin === "scheduled" && line.scheduledTaskId !== undefined
				? `${origin} ${line.scheduledTaskId}`
				: origin,
		);
	}
	if (line.promptSource !== undefined) parts.push(`${promptSourceLabels[line.promptSource]} prompt`);
	if (line.queuePriority === "later" && parts.length > 0) parts.push("queued for later");
	return parts.length === 0 ? undefined : parts.join(" · ");
}

/** The branch (or live cwd) the server-side classifier saw for a user turn. */
function classifierDetail(line: MessageSessionLine): string | undefined {
	const context = line.classifierContext;
	if (context === undefined) return undefined;
	const where = [context.liveCwd, context.platform].filter((part) => part !== undefined).join(" · ");
	if (context.branch !== undefined)
		return where === "" ? `Branch ${context.branch}` : `Branch ${context.branch} (${where})`;
	if (context.liveCwd !== undefined) return `Directory ${where}`;
	return undefined;
}

/** A user turn's origin caption and classifier context. */
export function userTurnDetails(line: MessageSessionLine): string[] {
	return [originDetail(line), classifierDetail(line)].filter((detail) => detail !== undefined);
}
