import {z} from "zod";

/** The rate-limit window a synthetic usage-limit assistant message carries. */
export const UsageLimitSchema = z.object({
	resetsAt: z.number(),
	rateLimitType: z.string(),
	overageStatus: z.string(),
	overageDisabledReason: z.string(),
	isUsingOverage: z.boolean(),
});

export type UsageLimit = z.infer<typeof UsageLimitSchema>;

/** Upstream's usage-limit error card: its headline and its hint sentence. */
export interface UsageLimitCard {
	headline: string;
	hint: string;
}

type LimitWindow = "session" | "weekly";
type Cause =
	| "out_of_credits"
	| "org_spend_cap"
	| "spend_cap"
	| "extra_usage_off"
	| "seat_tier"
	| "member_disabled"
	| "group_zero";
type Kind = "generic" | LimitWindow | "model" | "org_out_of_credits" | Cause;

/** Upstream's `dj`: an overage-disabled reason's cause; a service-disabled org falls back to the window. */
const CAUSES: Record<string, Cause | undefined> = {
	out_of_credits: "out_of_credits",
	org_level_disabled_until: "org_spend_cap",
	org_spend_cap_reached: "spend_cap",
	org_level_disabled: "extra_usage_off",
	overage_not_provisioned: "extra_usage_off",
	seat_tier_level_disabled: "seat_tier",
	seat_tier_zero_credit_limit: "seat_tier",
	member_level_disabled: "member_disabled",
	member_zero_credit_limit: "member_disabled",
	group_zero_credit_limit: "group_zero",
};

const WINDOWS: Record<string, LimitWindow | undefined> = {five_hour: "session", seven_day: "weekly"};

/** Upstream's `u2`: the kind a usage-limit message's own text names, in its order. */
const TEXT_KINDS: ReadonlyArray<[string, Kind]> = [
	["You've hit your session limit", "session"],
	["You've hit your weekly limit", "weekly"],
	["You've hit your org's monthly", "org_spend_cap"],
	["You've hit your monthly spend limit", "spend_cap"],
	["You're out of usage credits", "out_of_credits"],
	["You're out of extra usage", "out_of_credits"],
	["Your org is out of usage", "org_out_of_credits"],
	["Your seat type doesn't include", "seat_tier"],
	["Your usage allocation has been disabled", "member_disabled"],
	["Your group's usage limit is set to $0", "group_zero"],
	["You've hit your", "generic"],
	["You've reached your", "generic"],
	["Fable 5 requires usage credits", "generic"],
	["Fable requires usage credits", "generic"],
];
const FABLE_CREDITS = /^Fable(?: [^·\n]{1,40})? requires usage credits\./;
const MODEL_LIMIT = /^You've (?:hit|reached) your (?!(?:usage |org's )?limit\b)([A-Z][\w.]*(?: [\d.]+)?) limit/;

function kindFromText(text: string): {kind: Kind; model?: string} | null {
	const message = text.replace(/^Claude Code returned an error result:\s*/, "").replace(/^API Error:?\s*/, "");
	const kind =
		TEXT_KINDS.find(([prefix]) => message.startsWith(prefix))?.[1] ??
		(FABLE_CREDITS.test(message) ? "generic" : null);
	if (kind !== "generic") return kind === null ? null : {kind};
	const model = MODEL_LIMIT.exec(message)?.[1];
	return model === undefined ? {kind} : {kind: "model", model};
}

/** Upstream's `nt`: whether a message's text names a usage limit. */
export function isUsageLimitText(text: string): boolean {
	return kindFromText(text) !== null;
}

const HEADLINES: Record<Exclude<Kind, "model">, string> = {
	generic: "Usage limit reached",
	session: "Session limit reached",
	weekly: "Weekly limit reached",
	spend_cap: "Monthly spend limit reached",
	org_spend_cap: "Org spend limit reached",
	out_of_credits: "Out of usage credits",
	org_out_of_credits: "Your org is out of usage credits",
	seat_tier: "Your seat doesn’t include usage credits",
	member_disabled: "Usage credits are off for your account",
	group_zero: "Your group’s usage limit is $0",
	extra_usage_off: "Usage limit reached",
};

/** Upstream's fixed sentence for an overage cause, before the plan's reset. */
const CAUSE_HINTS: Record<Cause | "org_out_of_credits", string> = {
	spend_cap: "Raise your spend limit to keep working. Credits can’t be used until you do.",
	org_spend_cap: "Raise your organization’s spend limit to keep working.",
	out_of_credits: "Buy credits to keep working.",
	org_out_of_credits: "Buy credits for your organization to keep working.",
	extra_usage_off: "Turn on usage credits to keep working past your plan limit.",
	seat_tier: "Ask your admin for a seat that includes usage credits.",
	member_disabled: "Ask your admin for a higher limit.",
	group_zero: "Ask your admin for a higher limit.",
};

interface ResetAt {
	time: string;
	day?: string;
}

/** Upstream's `hA`: the reset's time, plus its day when that is not today. */
function resetAt(resetsAt: number, nowMs: number, timeZone: string | undefined): ResetAt {
	const zone = timeZone === undefined ? {} : {timeZone};
	const at = new Date(resetsAt * 1000);
	const ymd = (date: Date) => date.toLocaleDateString("en-US", zone);
	const time = at.toLocaleTimeString("en-US", {hour: "numeric", minute: "numeric", ...zone});
	if (ymd(at) === ymd(new Date(nowMs))) return {time};
	return {time, day: at.toLocaleDateString("en-US", {month: "short", day: "numeric", ...zone})};
}

function when(reset: ResetAt): string {
	return reset.day === undefined ? `at ${reset.time}` : `${reset.day} at ${reset.time}`;
}

const LIMIT_NOUNS: Record<"generic" | LimitWindow, string> = {generic: "usage", session: "session", weekly: "weekly"};

/** Upstream's windowed `hintWithoutRetry`: the viewer offers no Try again, only the composer. */
function windowHint(kind: "generic" | LimitWindow, reset: ResetAt | null): string {
	if (reset !== null) return `Your ${LIMIT_NOUNS[kind]} limit resets ${when(reset)}. Send a message then.`;
	if (kind === "generic") return "You’ve reached your usage limit. Send a message after your limit resets.";
	return `Send a message after your ${LIMIT_NOUNS[kind]} limit resets.`;
}

function modelHint(model: string, reset: ResetAt | null): string {
	if (reset === null) return `Switch models to keep working, or wait for your ${model} limit to reset.`;
	return `Switch models to keep working, or wait until ${when(reset)} when your ${model} limit resets.`;
}

/**
 * Upstream's card for a usage-limit error. Its context is the limit the
 * message carries while that limit's reset is still ahead; without one the
 * kind comes from the message text. Returns null when neither names a limit.
 */
export function usageLimitCard(
	limit: UsageLimit | undefined,
	text: string,
	nowMs: number,
	timeZone?: string,
): UsageLimitCard | null {
	const live = limit !== undefined && limit.resetsAt * 1000 > nowMs ? limit : undefined;
	const window = live === undefined ? undefined : WINDOWS[live.rateLimitType];
	const cause = live === undefined ? undefined : CAUSES[live.overageDisabledReason];
	const fromText = kindFromText(text);
	if (live === undefined && fromText === null && limit === undefined) return null;
	const kind: Kind = cause ?? window ?? fromText?.kind ?? "generic";
	const reset = live === undefined ? null : resetAt(live.resetsAt, nowMs, timeZone);

	if (kind === "model") {
		const model = fromText?.model ?? "";
		return {headline: `${model} limit reached`, hint: modelHint(model, reset)};
	}
	if (kind === "generic" || kind === "session" || kind === "weekly") {
		return {headline: HEADLINES[kind], hint: windowHint(kind, reset)};
	}
	const headline = kind === "extra_usage_off" && window !== undefined ? HEADLINES[window] : HEADLINES[kind];
	const plan = window === undefined ? "plan usage" : `${LIMIT_NOUNS[window]} limit`;
	const hint = reset === null ? CAUSE_HINTS[kind] : `${CAUSE_HINTS[kind]} Your ${plan} resets ${when(reset)}.`;
	return {headline, hint};
}
