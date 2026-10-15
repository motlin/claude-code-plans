import {z} from "zod";
import {FIVE_HOUR_LABEL, formatResetLabel, WEEKLY_LABEL} from "./composer-state";

/** The rate-limit window a synthetic usage-limit assistant message carries. */
export const UsageLimitSchema = z.object({
	resetsAt: z.number(),
	rateLimitType: z.string(),
	overageStatus: z.string(),
	overageDisabledReason: z.string(),
	isUsingOverage: z.boolean(),
});

export type UsageLimit = z.infer<typeof UsageLimitSchema>;

export interface UsageLimitNotice {
	limitLabel: string;
	resetLabel: string;
	overageLabel?: string;
}

const LIMIT_LABELS: Record<string, string> = {
	five_hour: FIVE_HOUR_LABEL,
	seven_day: WEEKLY_LABEL,
};

function humanize(value: string): string {
	return value.replaceAll("_", " ");
}

/** "Reset Mon, Oct 19, 8:00 AM": a reset already behind us, in local time. */
function formatPastReset(resetsAtSec: number, timeZone: string | undefined): string {
	const formatted = new Intl.DateTimeFormat("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		...(timeZone === undefined ? {} : {timeZone}),
	}).format(resetsAtSec * 1000);
	return `Reset ${formatted}`;
}

function overageLabel(limit: UsageLimit): string | undefined {
	if (limit.isUsingOverage) return "Using extra usage";
	if (limit.overageDisabledReason !== "") {
		return `Extra usage unavailable: ${humanize(limit.overageDisabledReason)}`;
	}
	return undefined;
}

/** The window, reset, and overage lines of a usage-limit notice. */
export function describeUsageLimit(limit: UsageLimit, nowMs: number, timeZone?: string): UsageLimitNotice {
	const notice: UsageLimitNotice = {
		limitLabel: LIMIT_LABELS[limit.rateLimitType] ?? humanize(limit.rateLimitType),
		resetLabel:
			limit.resetsAt * 1000 > nowMs
				? formatResetLabel(limit.resetsAt, nowMs, timeZone)
				: formatPastReset(limit.resetsAt, timeZone),
	};
	const overage = overageLabel(limit);
	if (overage !== undefined) notice.overageLabel = overage;
	return notice;
}
