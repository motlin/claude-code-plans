import {describe, expect, it} from "vite-plus/test";
import {usageLimitCard, type UsageLimit} from "../src/lib/usage-limit-notice";

// 2026-10-20T08:00:00Z, a Tuesday: 4:00 AM in New York.
const RESETS_AT = 1792483200;
const DAYS_BEFORE = (RESETS_AT - 3 * 86_400) * 1000;
const SAME_DAY = (RESETS_AT - 3 * 3600) * 1000;
const WEEKLY_TEXT = "You've hit your weekly limit · resets Oct 20 at 4am (America/New_York)";

function limit(overrides: Partial<UsageLimit> = {}): UsageLimit {
	return {
		resetsAt: RESETS_AT,
		rateLimitType: "seven_day",
		overageStatus: "rejected",
		overageDisabledReason: "org_level_disabled",
		isUsingOverage: false,
		...overrides,
	};
}

describe("usageLimitCard", () => {
	it("reads the kalshi specimen as upstream: extra usage off on the weekly window, with the reset day and time", () => {
		expect(usageLimitCard(limit(), WEEKLY_TEXT, DAYS_BEFORE, "America/New_York")).toStrictEqual({
			headline: "Weekly limit reached",
			hint: "Turn on usage credits to keep working past your plan limit. Your weekly limit resets Oct 20 at 4:00 AM.",
		});
	});

	it("names a plain session or weekly window with upstream's send-a-message hint, dropping the day on the reset's own day", () => {
		expect([
			usageLimitCard(limit({overageDisabledReason: ""}), WEEKLY_TEXT, DAYS_BEFORE, "America/New_York"),
			usageLimitCard(
				limit({rateLimitType: "five_hour", overageDisabledReason: ""}),
				"You've hit your session limit",
				SAME_DAY,
				"America/New_York",
			),
		]).toStrictEqual([
			{
				headline: "Weekly limit reached",
				hint: "Your weekly limit resets Oct 20 at 4:00 AM. Send a message then.",
			},
			{
				headline: "Session limit reached",
				hint: "Your session limit resets at 4:00 AM. Send a message then.",
			},
		]);
	});

	it("falls back to the message text once the reset has passed, or with no limit fields", () => {
		const after = (RESETS_AT + 60) * 1000;
		expect([
			usageLimitCard(limit(), WEEKLY_TEXT, after, "UTC"),
			usageLimitCard(undefined, WEEKLY_TEXT, after, "UTC"),
			usageLimitCard(undefined, "You've hit your Opus 5 limit · resets 4am", after, "UTC"),
			usageLimitCard(undefined, "API Error: You've reached your usage limit", after, "UTC"),
			usageLimitCard(undefined, "Something else went wrong", after, "UTC"),
		]).toStrictEqual([
			{
				headline: "Weekly limit reached",
				hint: "Send a message after your weekly limit resets.",
			},
			{
				headline: "Weekly limit reached",
				hint: "Send a message after your weekly limit resets.",
			},
			{
				headline: "Opus 5 limit reached",
				hint: "Switch models to keep working, or wait for your Opus 5 limit to reset.",
			},
			{
				headline: "Usage limit reached",
				hint: "You’ve reached your usage limit. Send a message after your limit resets.",
			},
			null,
		]);
	});

	it("maps the overage causes to upstream's headlines and fixed hints", () => {
		const card = (overageDisabledReason: string) =>
			usageLimitCard(limit({overageDisabledReason}), WEEKLY_TEXT, DAYS_BEFORE, "America/New_York");
		expect([card("out_of_credits"), card("org_spend_cap_reached"), card("seat_tier_level_disabled")]).toStrictEqual(
			[
				{
					headline: "Out of usage credits",
					hint: "Buy credits to keep working. Your weekly limit resets Oct 20 at 4:00 AM.",
				},
				{
					headline: "Monthly spend limit reached",
					hint: "Raise your spend limit to keep working. Credits can’t be used until you do. Your weekly limit resets Oct 20 at 4:00 AM.",
				},
				{
					headline: "Your seat doesn’t include usage credits",
					hint: "Ask your admin for a seat that includes usage credits. Your weekly limit resets Oct 20 at 4:00 AM.",
				},
			],
		);
	});
});
