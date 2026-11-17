import {describe, expect, it} from "vite-plus/test";

import {createTokenSmoother, seedsAtCurrent} from "../src/lib/token-smoother";

describe("createTokenSmoother", () =>
{
	it("ramps the first count up from 0 over 1200ms", () =>
	{
		const smoother = createTokenSmoother();
		smoother.update(1000, 0);
		expect([0, 600, 1200, 5000].map((now) => smoother.valueAt(now))).toStrictEqual([0, 500, 1000, 1000]);
	});

	it("ramps from the shown value to a new target over the gap since the last update", () =>
	{
		const smoother = createTokenSmoother();
		smoother.update(1000, 0);
		smoother.update(2000, 1200);
		expect([1200, 1800, 2400].map((now) => smoother.valueAt(now))).toStrictEqual([1000, 1500, 2000]);
	});

	it("clamps the ramp to 300ms after a quick update and 3000ms after a long gap", () =>
	{
		const quick = createTokenSmoother();
		quick.update(1000, 0);
		quick.update(1000 + 300, 100);
		const slow = createTokenSmoother();
		slow.update(1000, 0);
		slow.update(4000, 10_000);
		expect([
			quick.valueAt(100),
			quick.valueAt(250),
			quick.valueAt(400),
			slow.valueAt(11_500),
			slow.valueAt(13_000),
		]).toStrictEqual([83, 691, 1300, 2500, 4000]);
	});

	it("snaps down to a lower count", () =>
	{
		const smoother = createTokenSmoother();
		smoother.update(1000, 0);
		smoother.update(500, 2000);
		expect(smoother.valueAt(2000)).toStrictEqual(500);
	});

	it("clears on undefined and jumps on snapTo", () =>
	{
		const smoother = createTokenSmoother();
		smoother.update(1000, 0);
		smoother.update(undefined, 100);
		const cleared = smoother.valueAt(100);
		smoother.snapTo(42, 200);
		expect([cleared, smoother.valueAt(200)]).toStrictEqual([undefined, 42]);
	});

	it("ignores the same target twice, so the ramp end does not move", () =>
	{
		const smoother = createTokenSmoother();
		smoother.update(1000, 0);
		smoother.update(1000, 600);
		expect([smoother.valueAt(600), smoother.valueAt(1200)]).toStrictEqual([500, 1000]);
	});

	it("floors mid-ramp values", () =>
	{
		const smoother = createTokenSmoother();
		smoother.update(3, 0);
		expect(smoother.valueAt(1)).toStrictEqual(0);
	});

	it("is undefined with no target", () =>
	{
		expect(createTokenSmoother().valueAt(0)).toStrictEqual(undefined);
	});
});

describe("seedsAtCurrent", () =>
{
	it("seeds a positive count unless a running turn first turned positive within 5s, as upstream's nSe", () =>
	{
		const now = 100_000;
		expect(
			[
				{
					tokens: 0,
					running: false,
					firstPositiveAt: undefined,
				},
				{
					tokens: 10,
					running: false,
					firstPositiveAt: now,
				},
				{
					tokens: 10,
					running: true,
					firstPositiveAt: undefined,
				},
				{
					tokens: 10,
					running: true,
					firstPositiveAt: now - 4999,
				},
				{
					tokens: 10,
					running: true,
					firstPositiveAt: now - 5001,
				},
			].map((input) =>
				seedsAtCurrent(
					{
						...input,
						now,
					},
				),
			),
		).toStrictEqual([false, true, true, false, true]);
	});
});
