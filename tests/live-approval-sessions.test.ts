import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import
{
	__liveApprovalTesting,
	liveApprovalIds,
	registerLiveApproval,
	releaseLiveApprovals,
	subscribeLiveApprovals,
} from "../src/lib/live-approval-sessions";

afterEach(() =>
{
	__liveApprovalTesting.reset();
});

describe("live approval sessions", () =>
{
	it("registers a session, notifies once, and holds it past its last dispose until released", () =>
	{
		const listener = vi.fn<() => void>();
		const unsubscribe = subscribeLiveApprovals(listener);
		const dispose = registerLiveApproval("s1");
		const registered = [...liveApprovalIds()];
		const notifiedOnRegister = listener.mock.calls.length;
		dispose();
		const held = [...liveApprovalIds()];
		releaseLiveApprovals(["s2"]);
		const otherReleased = [...liveApprovalIds()];
		releaseLiveApprovals(["s1"]);
		unsubscribe();
		expect(
			{
				registered,
				notifiedOnRegister,
				held,
				otherReleased,
				after: [...liveApprovalIds()],
			},
		).toStrictEqual(
			{
				registered: ["s1"],
				notifiedOnRegister: 1,
				held: ["s1"],
				otherReleased: ["s1"],
				after: [],
			},
		);
	});

	it("counts registrations, and a release drops only the hold, not a mounted card", () =>
	{
		const first = registerLiveApproval("s1");
		const second = registerLiveApproval("s1");
		first();
		releaseLiveApprovals(["s1"]);
		const afterOne = [...liveApprovalIds()];
		second();
		first();
		const afterBoth = [...liveApprovalIds()];
		releaseLiveApprovals(["s1"]);
		expect(
			{
				afterOne,
				afterBoth,
				released: [...liveApprovalIds()],
			},
		).toStrictEqual(
			{
				afterOne: ["s1"],
				afterBoth: ["s1"],
				released: [],
			},
		);
	});

	it("keeps the same empty set while none is registered", () =>
	{
		const before = liveApprovalIds();
		registerLiveApproval("s1")();
		releaseLiveApprovals(["s1"]);
		expect(liveApprovalIds()).toBe(before);
	});
});
