import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {guardDoubleClicks, guardRowClicks, resetClickGuards, swallowGuardedClick} from "../src/lib/sidebar-click-guard";

function swallowed(type: string, detail: number): boolean
{
	let prevented = false;
	swallowGuardedClick(
		{
			type,
			detail,
			preventDefault: () =>
			{
				prevented = true;
			},
			stopPropagation: () =>
			{
			},
		},
	);
	return prevented;
}

const PROBES = [
	["click", 0],
	["click", 1],
	["click", 2],
	["mousedown", 1],
	["dblclick", 2],
] as const;

const probe = () => PROBES.map(([type, detail]) => swallowed(type, detail));

describe("sidebar click guards", () =>
{
	beforeEach(() =>
	{
		resetClickGuards();
		vi.useFakeTimers(
			{
				toFake: ["performance"],
			},
		);
	});

	afterEach(() =>
	{
		vi.useRealTimers();
	});

	it("swallows every non-keyboard click, press and double-click for the row guard's window", () =>
	{
		const idle = probe();
		guardRowClicks(500);
		const within = probe();
		vi.advanceTimersByTime(500);
		const after = probe();

		expect(
			{
				idle,
				within,
				after,
			},
		).toStrictEqual(
			{
				idle: [false, false, false, false, false],
				within: [false, true, true, true, true],
				after: [false, false, false, false, false],
			},
		);
	});

	it("swallows only multi-clicks for the double-click guard's window", () =>
	{
		guardDoubleClicks(500);
		const within = probe();
		vi.advanceTimersByTime(500);

		expect(
			{
				within,
				after: probe(),
			},
		).toStrictEqual(
			{
				within: [false, false, true, false, true],
				after: [false, false, false, false, false],
			},
		);
	});
});
