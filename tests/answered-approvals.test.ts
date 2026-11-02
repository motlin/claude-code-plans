// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {describe, expect, it} from "vite-plus/test";

import {
	clearApprovalAnswered,
	isApprovalAnswered,
	markApprovalAnswered,
	useApprovalAnswered,
	useForgetAnsweredHookPlan,
} from "../src/lib/answered-approvals";

function hookPlanProps(id: string | null): {id: string | null} {
	return {id};
}

describe("answered approvals, as upstream's answered set keyed by session and tool call", () => {
	it("marks a session's tool call answered until the mark is cleared", () => {
		markApprovalAnswered("session-answered-1", "toolu_answered_1");
		const marked = {
			same: isApprovalAnswered("session-answered-1", "toolu_answered_1"),
			otherSession: isApprovalAnswered("session-answered-2", "toolu_answered_1"),
			otherCall: isApprovalAnswered("session-answered-1", "toolu_answered_2"),
		};
		clearApprovalAnswered("session-answered-1", "toolu_answered_1");

		expect({marked, cleared: isApprovalAnswered("session-answered-1", "toolu_answered_1")}).toStrictEqual({
			marked: {same: true, otherSession: false, otherCall: false},
			cleared: false,
		});
	});

	it("re-renders a subscriber when its call is marked and cleared", () => {
		const {result} = renderHook(() => useApprovalAnswered("session-answered-3", "toolu_answered_3"));
		const before = result.current;
		act(() => {
			markApprovalAnswered("session-answered-3", "toolu_answered_3");
		});
		const marked = result.current;
		act(() => {
			clearApprovalAnswered("session-answered-3", "toolu_answered_3");
		});

		expect({before, marked, cleared: result.current}).toStrictEqual({before: false, marked: true, cleared: false});
	});

	it("reads a missing key as unanswered", () => {
		const {result} = renderHook(() => useApprovalAnswered("session-answered-4", null));

		expect(result.current).toStrictEqual(false);
	});

	it("forgets an id-less hook plan's mark once the hook stops reporting it, so a later id-less plan shows", () => {
		const {rerender} = renderHook(
			({id}: {id: string | null}) => {
				useForgetAnsweredHookPlan("session-hook-plan", id);
			},
			{initialProps: hookPlanProps("")},
		);
		markApprovalAnswered("session-hook-plan", "");
		markApprovalAnswered("session-hook-plan", "toolu_hook_plan");
		const reported = isApprovalAnswered("session-hook-plan", "");
		rerender({id: null});
		expect({
			reported,
			cleared: isApprovalAnswered("session-hook-plan", ""),
			// A real tool call id is never reused, so its mark stays until its record lands.
			kept: isApprovalAnswered("session-hook-plan", "toolu_hook_plan"),
		}).toStrictEqual({reported: true, cleared: false, kept: true});
		clearApprovalAnswered("session-hook-plan", "toolu_hook_plan");
	});
});
