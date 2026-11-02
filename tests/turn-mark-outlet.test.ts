// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import
{
	markedRowBelowTailSlot,
	moveInto,
	OUTLET_LATE_NOTICE_MS,
	REOPEN_LOOP_COUNT,
	REOPEN_STREAK_MS,
	REOPEN_WINDOW_MS,
	TurnMarkOutletStore,
} from "../src/lib/turn-mark-outlet";

describe("markedRowBelowTailSlot, as upstream's pf", () =>
{
	it("follows upstream's truth table", () =>
	{
		const cases = [
			[true, false, false],
			[true, false, true],
			[true, true, false],
			[true, true, true],
			[false, true, false],
			[false, true, true],
			[false, false, false],
			[false, false, true],
		] as const;
		expect(
			cases.map(([cardHoldsTail, planHoldsLoader, heldRedialReported]) =>
				markedRowBelowTailSlot(
					{
						cardHoldsTail,
						planHoldsLoader,
						heldRedialReported,
					},
				),
			),
		).toStrictEqual(["card", "card", false, false, "plan", false, false, false]);
	});

	it("keeps upstream's constants", () =>
	{
		expect(
			{
				OUTLET_LATE_NOTICE_MS,
				REOPEN_WINDOW_MS,
				REOPEN_STREAK_MS,
				REOPEN_LOOP_COUNT,
			},
		).toStrictEqual(
			{
				OUTLET_LATE_NOTICE_MS: 250,
				REOPEN_WINDOW_MS: 50,
				REOPEN_STREAK_MS: 5000,
				REOPEN_LOOP_COUNT: 30,
			},
		);
	});
});

describe("TurnMarkOutletStore", () =>
{
	beforeEach(() =>
	{
		vi.useFakeTimers(
			{
				now: Date.parse("2026-11-09T12:00:00.000Z"),
			},
		);
	});
	afterEach(() =>
	{
		vi.useRealTimers();
		vi.restoreAllMocks();
		document.body.replaceChildren();
	});

	function outletEl(): HTMLDivElement
	{
		const el = document.createElement("div");
		document.body.append(el);
		return el;
	}

	it("tells listeners at once on open, but only after the late-close window on close", () =>
	{
		const store = new TurnMarkOutletStore();
		const el = outletEl();
		const heard = vi.fn<() => void>();
		store.subscribeOutlet(heard);
		store.openOutlet(el);
		const afterOpen =
		{
			outlet: store.outlet()?.el === el,
			calls: heard.mock.calls.length,
		};
		store.closeOutlet(el);
		const afterClose =
		{
			outlet: store.outlet(),
			calls: heard.mock.calls.length,
		};
		vi.advanceTimersByTime(OUTLET_LATE_NOTICE_MS);
		expect(
			{
				afterOpen,
				afterClose,
				later: heard.mock.calls.length,
			},
		).toStrictEqual(
			{
				afterOpen:
				{
					outlet: true,
					calls: 1,
				},
				afterClose:
				{
					outlet: null,
					calls: 1,
				},
				later: 2,
			},
		);
	});

	it("cancels the late close notice when the outlet reopens inside the window", () =>
	{
		const store = new TurnMarkOutletStore();
		const el = outletEl();
		store.openOutlet(el);
		const heard = vi.fn<() => void>();
		store.subscribeOutlet(heard);
		store.closeOutlet(el);
		store.openOutlet(el);
		vi.advanceTimersByTime(OUTLET_LATE_NOTICE_MS * 2);
		expect(
			{
				calls: heard.mock.calls.length,
				open: store.outlet()?.el === el,
			},
		).toStrictEqual(
			{
				calls: 1,
				open: true,
			},
		);
	});

	it("ignores a close for an outlet that isn't the open one", () =>
	{
		const store = new TurnMarkOutletStore();
		const el = outletEl();
		store.openOutlet(el);
		store.closeOutlet(outletEl());
		expect(store.outlet()?.el === el).toBe(true);
	});

	it("gives the outlet to the newest claimer and hands it back when that claim ends", () =>
	{
		const store = new TurnMarkOutletStore();
		const releaseA = store.claimOutlet("a");
		const releaseB = store.claimOutlet("b");
		const newest = store.outletOwner();
		releaseB();
		const afterB = store.outletOwner();
		releaseA();
		expect(
			{
				newest,
				afterB,
				none: store.outletOwner(),
			},
		).toStrictEqual(
			{
				newest: "b",
				afterB: "a",
				none: undefined,
			},
		);
	});

	it("records whether the outlet sits under a plan and tells listeners of a change", () =>
	{
		const store = new TurnMarkOutletStore();
		const heard = vi.fn<() => void>();
		store.subscribeOutlet(heard);
		store.setOutletUnderPlan(false);
		store.setOutletUnderPlan(true);
		expect(
			{
				underPlan: store.outletUnderPlan(),
				calls: heard.mock.calls.length,
			},
		).toStrictEqual(
			{
				underPlan: true,
				calls: 1,
			},
		);
	});

	it("sends a carried box home when its outlet closes", () =>
	{
		const store = new TurnMarkOutletStore();
		const el = outletEl();
		const home = document.createElement("div");
		document.body.append(home);
		const box = document.createElement("div");
		el.append(box);
		store.openOutlet(el);
		const dispose = store.carry(box, () => home);
		store.closeOutlet(el);
		dispose();
		expect(
			{
				inHome: box.parentNode === home,
				outletEmpty: el.childElementCount,
			},
		).toStrictEqual(
			{
				inHome: true,
				outletEmpty: 0,
			},
		);
	});

	function cycle(store: TurnMarkOutletStore, el: HTMLElement, reopens: number): void
	{
		store.openOutlet(el);
		for (let i = 0; i < reopens; i++)
		{
			store.closeOutlet(el);
			vi.advanceTimersByTime(10);
			store.openOutlet(el);
		}
	}

	it("warns once about a render loop after 30 quick reopens", () =>
	{
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const store = new TurnMarkOutletStore();
		cycle(store, outletEl(), REOPEN_LOOP_COUNT + 5);
		expect(warn.mock.calls).toStrictEqual([
			[
				"Claude Code transcript: turn-mark outlet removed and re-added 30 times in 5 s (likely a render loop; nothing fell back)",
			],
		]);
	});

	it("stays quiet after 29 quick reopens", () =>
	{
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const store = new TurnMarkOutletStore();
		cycle(store, outletEl(), REOPEN_LOOP_COUNT - 1);
		expect(warn.mock.calls).toStrictEqual([]);
	});
});

describe("moveInto, as upstream's yf", () =>
{
	afterEach(() =>
	{
		document.body.replaceChildren();
	});

	it("uses moveBefore when the parent has it and both nodes are connected", () =>
	{
		const from = document.createElement("div");
		const to = document.createElement("div");
		const node = document.createElement("span");
		from.append(node);
		document.body.append(from, to);
		const moveBefore = vi.fn<(node: Node, child: Node | null) => void>();
		Object.assign(
			to,
			{
				moveBefore,
			},
		);
		moveInto(node, to);
		expect(moveBefore.mock.calls).toStrictEqual([[node, null]]);
	});

	it("is a no-op when the node is already in the parent", () =>
	{
		const to = document.createElement("div");
		const node = document.createElement("span");
		to.append(node);
		const moveBefore = vi.fn<(node: Node, child: Node | null) => void>();
		Object.assign(
			to,
			{
				moveBefore,
			},
		);
		moveInto(node, to);
		expect(moveBefore.mock.calls).toStrictEqual([]);
	});

	it("appends without moveBefore and restores focus that fell to the body", async () =>
	{
		const from = document.createElement("div");
		const to = document.createElement("div");
		const node = document.createElement("div");
		const button = document.createElement("button");
		node.append(button);
		from.append(node);
		document.body.append(from, to);
		button.focus();
		moveInto(node, to);
		await Promise.resolve();
		expect(
			{
				parent: node.parentNode === to,
				focused: document.activeElement === button,
			},
		).toStrictEqual(
			{
				parent: true,
				focused: true,
			},
		);
	});
});
