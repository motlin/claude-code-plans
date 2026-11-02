// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

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

describe("acknowledged tool decisions, as upstream's persisted 5-minute store (C1/C0/Iw)", () => {
	const STORAGE_KEY = "acknowledged-tool-decisions";
	type Store = typeof import("../src/lib/answered-approvals");

	async function freshStore(): Promise<Store> {
		vi.resetModules();
		return import("../src/lib/answered-approvals");
	}

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		window.localStorage.clear();
	});

	it("writes upstream's plain-JSON shape and still answers the call after a reload, until 5 minutes pass", async () => {
		vi.useFakeTimers({now: 1_000_000, toFake: ["Date"]});
		const before = await freshStore();
		before.acknowledgeApproval("session-ack-1", "toolu_ack_1", "AskUserQuestion");
		const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");

		const reloaded = await freshStore();
		const afterReload = reloaded.isApprovalAnswered("session-ack-1", "toolu_ack_1");
		vi.setSystemTime(1_000_000 + 300_000);
		const atTtl = reloaded.isApprovalAnswered("session-ack-1", "toolu_ack_1");
		vi.setSystemTime(1_000_000 + 300_001);
		const pastTtl = reloaded.isApprovalAnswered("session-ack-1", "toolu_ack_1");
		const pastReload = (await freshStore()).isApprovalAnswered("session-ack-1", "toolu_ack_1");

		expect({
			stored,
			afterReload,
			atTtl,
			pastTtl,
			pastReload,
			pruned: window.localStorage.getItem(STORAGE_KEY),
		}).toStrictEqual({
			stored: {
				"session-ack-1": {
					toolu_ack_1: {toolUseId: "toolu_ack_1", toolName: "AskUserQuestion", acknowledgedAt: 1_000_000},
				},
			},
			afterReload: true,
			atTtl: true,
			pastTtl: false,
			pastReload: false,
			pruned: "{}",
		});
	});

	it("keeps at most 10 acknowledgements per session, dropping the oldest", async () => {
		vi.useFakeTimers({now: 2_000_000, toFake: ["Date"]});
		const store = await freshStore();
		for (let at = 0; at < 11; at += 1) {
			vi.setSystemTime(2_000_000 + at);
			store.acknowledgeApproval("session-ack-2", `toolu_${at}`, "Bash");
		}
		store.acknowledgeApproval("session-ack-3", "toolu_other", "Bash");
		const reloaded = await freshStore();
		const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, object>;

		expect({
			oldest: reloaded.isApprovalAnswered("session-ack-2", "toolu_0"),
			second: reloaded.isApprovalAnswered("session-ack-2", "toolu_1"),
			newest: reloaded.isApprovalAnswered("session-ack-2", "toolu_10"),
			other: reloaded.isApprovalAnswered("session-ack-3", "toolu_other"),
			kept: Object.keys(stored["session-ack-2"] ?? {}),
		}).toStrictEqual({
			oldest: false,
			second: true,
			newest: true,
			other: true,
			kept: [
				"toolu_1",
				"toolu_2",
				"toolu_3",
				"toolu_4",
				"toolu_5",
				"toolu_6",
				"toolu_7",
				"toolu_8",
				"toolu_9",
				"toolu_10",
			],
		});
	});

	it("re-renders a subscriber when its call is acknowledged", async () => {
		const store = await freshStore();
		const {result} = renderHook(() => store.useApprovalAnswered("session-ack-4", "toolu_ack_4"));
		const before = result.current;
		act(() => {
			store.acknowledgeApproval("session-ack-4", "toolu_ack_4", "Bash");
		});

		expect({before, acknowledged: result.current}).toStrictEqual({before: false, acknowledged: true});
	});

	it("tolerates corrupt or throwing storage, answering in memory for this page", async () => {
		window.localStorage.setItem(STORAGE_KEY, "{not json");
		const corrupt = await freshStore();
		const corruptRead = corrupt.isApprovalAnswered("session-ack-5", "toolu_ack_5");

		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("denied");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("denied");
		});
		const denied = await freshStore();
		denied.acknowledgeApproval("session-ack-5", "toolu_ack_5", "Bash");

		expect({
			corruptRead,
			unmarked: denied.isApprovalAnswered("session-ack-5", "toolu_other"),
			inMemory: denied.isApprovalAnswered("session-ack-5", "toolu_ack_5"),
		}).toStrictEqual({corruptRead: false, unmarked: false, inMemory: true});
	});

	it("drops an acknowledgement with the answered mark, so an id-less hook plan's next prompt can show", async () => {
		const store = await freshStore();
		store.acknowledgeApproval("session-ack-6", "", "ExitPlanMode");
		store.clearApprovalAnswered("session-ack-6", "");

		expect({
			answered: store.isApprovalAnswered("session-ack-6", ""),
			reloaded: (await freshStore()).isApprovalAnswered("session-ack-6", ""),
		}).toStrictEqual({answered: false, reloaded: false});
	});
});
