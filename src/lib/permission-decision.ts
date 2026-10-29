import type {z} from "zod";
import {assertNever} from "./assert-never";
import type {PermissionDecisionReasonTypeSchema, UserRecordSchema} from "./schemas";
import {
	permissionDecisionCircuitBreakerLabels,
	permissionDecisionDecisionLabels,
	permissionDecisionReasonTypeLabels,
	permissionDecisionRuleSourceLabels,
	permissionDecisionSourceLabels,
} from "./schema-choices";

/** How Claude Code permitted or denied a tool call, from its tool_result record's `permissionDecision`. */
export type PermissionDecision = NonNullable<z.infer<typeof UserRecordSchema>["permissionDecision"]>;

type ReasonType = z.infer<typeof PermissionDecisionReasonTypeSchema>;

/** What a settings-sourced decision rested on, as the tail of "Allowed by …" / "Blocked by …". */
const REASON_AGENTS = {
	asyncAgent: "no approval prompt",
	classifier: "auto mode",
	hook: "hook",
	mode: "permission mode",
	other: "settings",
	rule: "rule",
	safetyCheck: "safety check",
	sandboxOverride: "sandbox override",
	subcommandResults: "rules",
	workingDir: "working directories",
} satisfies Record<ReasonType, string>;

/**
 * A short phrase for what allowed or blocked a tool call, e.g. "Allowed by auto
 * mode", "Approved once" or "Approved for session". Null when the user rejected or aborted the call, which the
 * row's "Denied"/"Stopped" status already says.
 */
export function permissionDecisionLabel(permission: PermissionDecision): string | null {
	switch (permission.source) {
		case "user_reject":
		case "user_abort":
			return null;
		case "user_temporary": {
			const reach = permission.grantScope === "session" ? "for session" : "once";
			return `${permission.decision === "accept" ? "Approved" : "Rejected"} ${reach}`;
		}
		case "user_permanent":
			return permission.decision === "accept" ? "Approved always" : "Rejected always";
		case "classifier":
			return permission.decision === "accept" ? "Allowed by classifier" : "Blocked by classifier";
		case "hook":
		case "config": {
			const agent = permission.source === "hook" ? "hook" : REASON_AGENTS[permission.reasonType ?? "other"];
			return `${permission.decision === "accept" ? "Allowed" : "Blocked"} by ${agent}`;
		}
		default:
			return assertNever(permission.source);
	}
}

/** A classifier category id spelled as words, e.g. "git_destructive" → "Git destructive". */
function classifierCategoryLabel(category: string): string {
	const words = category.replaceAll("_", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The reason label, with what backed it: the settings layer a rule came from, the
 * auto-mode classifier's category, or the safety check that tripped, e.g.
 * "Permission rule (User settings)" or "Safety check (Dangerous removal)".
 */
function reasonTitle(permission: PermissionDecision): string | undefined {
	if (permission.reasonType === undefined) {
		return undefined;
	}
	const reason = permissionDecisionReasonTypeLabels[permission.reasonType];
	const details = [
		permission.ruleSource === undefined ? undefined : permissionDecisionRuleSourceLabels[permission.ruleSource],
		permission.classifierCategory === undefined
			? undefined
			: classifierCategoryLabel(permission.classifierCategory),
		permission.circuitBreaker === undefined
			? undefined
			: permissionDecisionCircuitBreakerLabels[permission.circuitBreaker],
	].filter((detail) => detail !== undefined);
	return details.length === 0 ? reason : `${reason} (${details.join(", ")})`;
}

/** The raw decision, source and reason spelled out, for a tooltip. */
export function permissionDecisionTitle(permission: PermissionDecision): string {
	const parts = [
		permissionDecisionDecisionLabels[permission.decision],
		permissionDecisionSourceLabels[permission.source],
		reasonTitle(permission),
	].filter((part) => part !== undefined);
	return `Permission: ${parts.join(" · ")}`;
}
