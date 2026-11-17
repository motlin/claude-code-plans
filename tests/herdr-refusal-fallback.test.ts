import {describe, expect, it} from "vite-plus/test";

import {parseRefusalFallbackDialog} from "../src/lib/herdr/refusal-fallback";
import
{
	promptBox,
	REFUSAL_DIALOG,
	REFUSAL_DIALOG_BARE_LABELS,
	REFUSAL_DIALOG_GUIDANCE,
	STALE_TITLE,
	USAGE_CREDITS_DIALOG,
} from "./fixtures/refusal-fallback-screens";

describe("parseRefusalFallbackDialog", () =>
{
	it("reads the full dialog with its category, Switch on row 1 focused", () =>
	{
		expect(parseRefusalFallbackDialog(REFUSAL_DIALOG)).toStrictEqual(
			{
				body: "Opus 4.7's safeguards flagged this message. This sometimes happens with safe, normal conversations.",
				guidance: null,
				category: "cyber",
				switchLabel: "Switch to Sonnet 4.6",
				switchRow: 1,
				editLabel: "Edit prompt and retry with Opus 4.7",
				editRow: 2,
				focus: "switch",
			},
		);
	});

	it("reads the CLI's bare labels when it knows no model names", () =>
	{
		expect(parseRefusalFallbackDialog(REFUSAL_DIALOG_BARE_LABELS)).toStrictEqual(
			{
				body: "This model's safeguards flagged this message.",
				guidance: null,
				category: null,
				switchLabel: "Switch to the fallback model",
				switchRow: 1,
				editLabel: "Edit prompt and retry",
				editRow: 2,
				focus: "switch",
			},
		);
	});

	it("reads a guidance block and a backticked category, with focus on Edit", () =>
	{
		expect(parseRefusalFallbackDialog(REFUSAL_DIALOG_GUIDANCE)).toStrictEqual(
			{
				body: "Opus 4.7's safeguards flagged this message.",
				guidance: "Try rephrasing the request without the lab protocol details.",
				category: "bio",
				switchLabel: "Switch to Sonnet 4.6",
				switchRow: 1,
				editLabel: "Edit prompt and retry with Opus 4.7",
				editRow: 2,
				focus: "edit",
			},
		);
	});

	it("refuses the usage-credits Session paused dialog", () =>
	{
		expect(parseRefusalFallbackDialog(USAGE_CREDITS_DIALOG)).toBeNull();
	});

	it("refuses a screen with no dialog", () =>
	{
		expect(parseRefusalFallbackDialog(promptBox(""))).toBeNull();
	});

	it("refuses a stale title above a newer prompt box with no rows under it", () =>
	{
		expect(parseRefusalFallbackDialog(STALE_TITLE)).toBeNull();
	});
});
