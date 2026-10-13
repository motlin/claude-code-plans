import type {z} from "zod";
import {assertNever} from "./assert-never";
import type {PermissionDecisionReasonTypeSchema, UserRecordSchema} from "./schemas";
import {
	permissionDecisionDecisionLabels,
	permissionDecisionReasonTypeLabels,
	permissionDecisionSourceLabels,
} from "./schema-choices";

/** How Claude Code permitted or denied a tool call, from its tool_result record's `permissionDecision`. */
export type PermissionDecision = NonNullable<z.infer<typeof UserRecordSchema>["permissionDecision"]>;

type ReasonType = z.infer<typeof PermissionDecisionReasonTypeSchema>;

/** What a settings-sourced decision rested on, as the tail of "Allowed by …" / "Blocked by …". */
const REASON_AGENTS = {
	classifier: "auto mode",
	hook: "hook",
	mode: "permission mode",
	other: "settings",
	rule: "rule",
	safetyCheck: "safety check",
	subcommandResults: "rules",
} satisfies Record<ReasonType, string>;

/**
 * A short phrase for what allowed or blocked a tool call, e.g. "Allowed by auto
 * mode" or "Approved once". Null when the user rejected the call, which the
 * row's "Denied"/"Stopped" status already says.
 */
export function permissionDecisionLabel(permission: PermissionDecision): string | null {
	switch (permission.source) {
		case "user_reject":
			return null;
		case "user_temporary":
			return permission.decision === "accept" ? "Approved once" : "Rejected once";
		case "user_permanent":
			return permission.decision === "accept" ? "Approved always" : "Rejected always";
		case "hook":
		case "config": {
			const agent = permission.source === "hook" ? "hook" : REASON_AGENTS[permission.reasonType ?? "other"];
			return `${permission.decision === "accept" ? "Allowed" : "Blocked"} by ${agent}`;
		}
		default:
			return assertNever(permission.source);
	}
}

/** The raw decision, source and reason spelled out, for a tooltip. */
export function permissionDecisionTitle(permission: PermissionDecision): string {
	const parts = [
		permissionDecisionDecisionLabels[permission.decision],
		permissionDecisionSourceLabels[permission.source],
		permission.reasonType === undefined ? undefined : permissionDecisionReasonTypeLabels[permission.reasonType],
	].filter((part) => part !== undefined);
	return `Permission: ${parts.join(" · ")}`;
}
