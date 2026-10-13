import type {Capabilities} from "../lib/capabilities";

export function reviewOfferAction(mode: WorkingCopyReviewMode): ReviewOfferAction {
	if (mode === "off") return "ignore";
	return mode === "offer" ? "offer" : "start";
}

export function workingCopyReviewDegradedMessage(capability: Capabilities["workingCopyReview"]): string | null {
	if (!capability.enabled || capability.available) return null;
	if (!capability.installed) {
		return "Working-copy review is enabled, but its review skill is not installed.";
	}
	const reason = capability.unavailabilityReason;
	if (reason === null) return null;
	if (reason.type === "claude-not-found") {
		return "Working-copy review is enabled, but the Claude executable was not found. Install Claude Code or add claude to PATH, then restart just dev.";
	}
	return "Working-copy review is enabled, but its database is unavailable. Check the server logs, then restart just dev.";
}

export type ReviewOfferAction = "ignore" | "offer" | "start";

type WorkingCopyReviewMode = "off" | "offer" | "auto";
