import {z} from "zod";
import {ExitPlanModeAllowedPromptSchema} from "./tool-input-schemas";
import {parseToolRejection} from "./tool-rejection";

export type ExitPlanModeAllowedPrompt = z.infer<typeof ExitPlanModeAllowedPromptSchema>;

const AllowedPromptsSchema = z.array(ExitPlanModeAllowedPromptSchema);

/**
 * Read the `allowedPrompts` field of an `ExitPlanMode` input. Anything that
 * does not match the on-disk shape is dropped rather than rendered raw.
 */
export function parseAllowedPrompts(value: unknown): ExitPlanModeAllowedPrompt[] {
	const parsed = AllowedPromptsSchema.safeParse(value);
	return parsed.success ? parsed.data : [];
}

export type ExitPlanModeStatusTone = "approved" | "rejected" | "error" | "info";

export interface ExitPlanModeStatus {
	tone: ExitPlanModeStatusTone;
	text: string;
	/** The user's own words, when they rejected the plan with feedback. */
	detail?: string;
}

const APPROVAL_PREFIX = "User has approved";

/** Upstream's plan states for an `ExitPlanMode` call: awaiting approval, approved, rejected, or failed. */
export type ExitPlanModeState = "ready" | "approved" | "rejected" | "not-approved";

/** Upstream's words for each plan state ("Plan ready" card eyebrow, tool body, and tool summary). */
export const EXIT_PLAN_MODE_STATE_LABEL: Record<ExitPlanModeState, string> = {
	ready: "Plan ready",
	approved: "Plan approved",
	rejected: "Plan rejected",
	"not-approved": "Plan not approved",
};

/** Upstream's title on the pending plan's approval card, and its action that opens the Plan pane. */
export const PLAN_PROPOSED_TITLE = "Claude proposed a plan";
export const OPEN_PLAN_ACTION_LABEL = "Open plan";

/** The local link to a plan's saved `~/.claude/plans` file, on the tool body and the Plan pane header. */
export const PLAN_FILE_ACTION_LABEL = "Open plan file";

/** The plan state an `ExitPlanMode` result records; no result yet means it awaits approval. */
export function exitPlanModeState(result: string | undefined, isError: boolean | undefined): ExitPlanModeState {
	const trimmed = result?.trim();
	if (!trimmed) return "ready";
	if (trimmed.startsWith(APPROVAL_PREFIX)) return "approved";
	if (parseToolRejection(trimmed)) return "rejected";
	return isError === true ? "not-approved" : "approved";
}

/**
 * Collapse an `ExitPlanMode` tool result to a status line.
 *
 * Both the approval and the rejection results are instructions addressed to the
 * model ("You can now start coding", "STOP what you are doing"), which say
 * nothing to a human reading the transcript. Only the outcome — and any words
 * the user typed when rejecting — carry information, so everything else is
 * dropped. Unrecognized results pass through verbatim.
 */
export function describeExitPlanModeResult(
	result: string | undefined,
	isError: boolean | undefined,
): ExitPlanModeStatus | null {
	const trimmed = result?.trim();
	if (!trimmed) return null;

	if (trimmed.startsWith(APPROVAL_PREFIX)) {
		return {tone: "approved", text: EXIT_PLAN_MODE_STATE_LABEL.approved};
	}

	const rejection = parseToolRejection(trimmed);
	if (rejection) {
		const status: ExitPlanModeStatus = {tone: "rejected", text: EXIT_PLAN_MODE_STATE_LABEL.rejected};
		if (rejection.feedback) status.detail = rejection.feedback;
		return status;
	}

	return {tone: isError ? "error" : "info", text: trimmed};
}

/** Upstream's plan block: the plan text as typed, set off by a 2px start border. */
export const PLAN_BLOCK_CLASS =
	"text-body text-secondary whitespace-pre-wrap break-words ps-2 border-s-2 [unicode-bidi:plaintext]";

/** Bidi embedding/override/isolate controls and marks, plus Unicode tag characters. */
const BIDI_CONTROL_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u{E0000}-\u{E007F}]/gu;

/** A `` `code` `` run never crosses a line, as in upstream's plan block. */
const INLINE_CODE_RE = /`[^`\n]+`/g;

export interface PlanBlockSegment {
	code: boolean;
	text: string;
}

/**
 * The plan block's text with Bidi controls stripped, split so each inline
 * `` `code` `` run can sit in its own `dir="ltr"` span, as upstream's does.
 */
export function planBlockSegments(plan: string): PlanBlockSegment[] {
	const text = plan.replace(BIDI_CONTROL_RE, "");
	const segments: PlanBlockSegment[] = [];
	let last = 0;
	for (const match of text.matchAll(INLINE_CODE_RE)) {
		if (match.index > last) segments.push({code: false, text: text.slice(last, match.index)});
		segments.push({code: true, text: match[0]});
		last = match.index + match[0].length;
	}
	if (last < text.length) segments.push({code: false, text: text.slice(last)});
	return segments;
}
