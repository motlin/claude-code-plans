import { z } from "zod";
import { ExitPlanModeAllowedPromptSchema } from "./tool-input-schemas";

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
const REJECTION_PREFIX = "The user doesn't want to proceed with this tool use.";
const USER_FEEDBACK_RE = /To tell you how to proceed, the user said:\s*([\s\S]*)$/;

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
    return { tone: "approved", text: "Plan approved" };
  }

  if (trimmed.startsWith(REJECTION_PREFIX)) {
    const feedback = USER_FEEDBACK_RE.exec(trimmed)?.[1]?.trim();
    const status: ExitPlanModeStatus = { tone: "rejected", text: "Plan rejected" };
    if (feedback) status.detail = feedback;
    return status;
  }

  return { tone: isError ? "error" : "info", text: trimmed };
}
