import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import
{
	__liveApprovalTesting,
	liveApprovalIds,
	registerLiveApproval,
	subscribeLiveApprovals,
} from "../src/lib/live-approval-sessions";

afterEach(() =>
{
	__liveApprovalTesting.reset();
});

describe("live approval sessions", () =>
{
	it("registers a session, notifies once, and removes it on dispose", () =>
	{
		const listener = vi.fn<() => void>();
		const unsubscribe = subscribeLiveApprovals(listener);
		const dispose = registerLiveApproval("s1");
		const registered = [...liveApprovalIds()];
		const notifiedOnRegister = listener.mock.calls.length;
		dispose();
		unsubscribe();
		expect(
			{
				registered,
				notifiedOnRegister,
				after: [...liveApprovalIds()],
			},
		).toStrictEqual(
			{
				registered: ["s1"],
				notifiedOnRegister: 1,
				after: [],
			},
		);
	});

	it("counts registrations, so two need two disposes", () =>
	{
		const first = registerLiveApproval("s1");
		const second = registerLiveApproval("s1");
		first();
		const afterOne = [...liveApprovalIds()];
		second();
		first();
		expect(
			{
				afterOne,
				afterBoth: [...liveApprovalIds()],
			},
		).toStrictEqual(
			{
				afterOne: ["s1"],
				afterBoth: [],
			},
		);
	});

	it("keeps the same empty set while none is registered", () =>
	{
		const before = liveApprovalIds();
		registerLiveApproval("s1")();
		expect(liveApprovalIds()).toBe(before);
	});
});
