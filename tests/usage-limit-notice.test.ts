import {describe, expect, it} from "vite-plus/test";
import {describeUsageLimit} from "../src/lib/usage-limit-notice";

// 2026-10-19T08:00:00Z, a Monday.
const RESETS_AT = 1792396800;

describe("describeUsageLimit", () => {
	it("names the weekly window and counts down to a future reset", () => {
		const nowMs = (RESETS_AT - 3 * 3600 - 15 * 60) * 1000;
		expect(
			describeUsageLimit(
				{
					rateLimitType: "seven_day",
					resetsAt: RESETS_AT,
					overageStatus: "rejected",
					overageDisabledReason: "org_level_disabled",
					isUsingOverage: false,
				},
				nowMs,
				"UTC",
			),
		).toStrictEqual({
			limitLabel: "Weekly · all models",
			resetLabel: "Resets in 3 hr 15 min",
			overageLabel: "Extra usage unavailable: org level disabled",
		});
	});

	it("names the five-hour window and prints a past reset as an absolute local time", () => {
		const nowMs = (RESETS_AT + 86_400) * 1000;
		expect(
			describeUsageLimit(
				{
					rateLimitType: "five_hour",
					resetsAt: RESETS_AT,
					overageStatus: "allowed",
					overageDisabledReason: "",
					isUsingOverage: true,
				},
				nowMs,
				"UTC",
			),
		).toStrictEqual({
			limitLabel: "5-hour limit",
			resetLabel: "Reset Mon, Oct 19, 8:00 AM",
			overageLabel: "Using extra usage",
		});
	});

	it("falls back to the raw window name and omits the overage line when nothing applies", () => {
		expect(
			describeUsageLimit(
				{
					rateLimitType: "seven_day_opus",
					resetsAt: RESETS_AT,
					overageStatus: "allowed",
					overageDisabledReason: "",
					isUsingOverage: false,
				},
				(RESETS_AT - 30 * 60) * 1000,
				"UTC",
			),
		).toStrictEqual({
			limitLabel: "seven day opus",
			resetLabel: "Resets in 30 min",
		});
	});
});
