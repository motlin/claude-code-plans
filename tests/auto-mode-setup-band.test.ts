import {describe, expect, it} from "vite-plus/test";
import {type AutoSetupBandInput, autoSetupBandEligible} from "../src/lib/auto-mode-setup-band";

const NOW = 1_800_000_000_000;
const WEEK = 604_800_000;

const AUTO_PATH: AutoSetupBandInput =
{
	setup:
	{
		offered: true,
		setupComplete: false,
		denials: 5,
		dismissed: false,
		snoozedUntil: 0,
	},
	autoModeIsDefault: true,
	paneWritable: true,
	effectiveMode: "auto",
	sessionHistoryCount: 3,
	bandSeen: false,
	coachSeenAt: 0,
	now: NOW,
};
const TRY_PATH: AutoSetupBandInput =
{
	...AUTO_PATH,
	setup:
	{
		...AUTO_PATH.setup,
		denials: 0,
	},
	effectiveMode: "default",
	sessionHistoryCount: 0,
	coachSeenAt: NOW - 1,
};

function withSetup(patch: Partial<AutoSetupBandInput["setup"]>): AutoSetupBandInput
{
	return {
		...AUTO_PATH,
		setup:
		{
			...AUTO_PATH.setup,
			...patch,
		},
	};
}

describe("autoSetupBandEligible", () =>
{
	it("follows upstream hr clause by clause", () =>
	{
		const cases: [string, AutoSetupBandInput][] = [
			["auto path", AUTO_PATH],
			["try path", TRY_PATH],
			[
				"not offered",
				withSetup(
					{
						offered: false,
					},
				),
			],
			[
				"auto not the default",
				{
					...AUTO_PATH,
					autoModeIsDefault: false,
				},
			],
			[
				"pane not writable",
				{
					...AUTO_PATH,
					paneWritable: false,
				},
			],
			[
				"setup complete",
				withSetup(
					{
						setupComplete: true,
					},
				),
			],
			[
				"dismissed",
				withSetup(
					{
						dismissed: true,
					},
				),
			],
			[
				"snoozed",
				withSetup(
					{
						snoozedUntil: NOW + 1,
					},
				),
			],
			[
				"snooze over",
				withSetup(
					{
						snoozedUntil: NOW,
					},
				),
			],
			[
				"band seen",
				{
					...AUTO_PATH,
					bandSeen: true,
				},
			],
			[
				"4 denials",
				withSetup(
					{
						denials: 4,
					},
				),
			],
			[
				"2 sessions",
				{
					...AUTO_PATH,
					sessionHistoryCount: 2,
				},
			],
			[
				"coach mark a week old",
				{
					...TRY_PATH,
					coachSeenAt: NOW - WEEK,
				},
			],
			[
				"coach mark never shown",
				{
					...TRY_PATH,
					coachSeenAt: 0,
				},
			],
			[
				"accept edits",
				{
					...AUTO_PATH,
					effectiveMode: "acceptEdits",
				},
			],
			[
				"accept edits on the try path",
				{
					...TRY_PATH,
					effectiveMode: "acceptEdits",
				},
			],
		];
		expect(cases.map(([name, input]) => [name, autoSetupBandEligible(input)])).toStrictEqual([
			["auto path", true],
			["try path", true],
			["not offered", false],
			["auto not the default", false],
			["pane not writable", false],
			["setup complete", false],
			["dismissed", false],
			["snoozed", false],
			["snooze over", true],
			["band seen", false],
			["4 denials", false],
			["2 sessions", false],
			["coach mark a week old", false],
			["coach mark never shown", false],
			["accept edits", false],
			["accept edits on the try path", false],
		]);
	});
});
