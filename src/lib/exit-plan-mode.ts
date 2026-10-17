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
