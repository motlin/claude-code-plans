// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import type {DeliveryResult} from "../src/hooks/use-composer-queue";
import {type ParkedPromptsOptions, resetParkedPrompts, useParkedPrompts} from "../src/hooks/use-parked-prompts";
import {clearComposerQueues, dispatchComposerQueue, newQueuedPrompt} from "../src/lib/composer-queue";
import type {UsageSummary} from "../src/lib/usage";

const T0 = Date.UTC(2026, 10, 6, 7, 0);
const RESETS_AT = T0 / 1000 + 60;
const DUE = 150_000;
const SESSION = "session-parked";

function spent(resetsAt = RESETS_AT): UsageSummary
{
	return {
		fiveHour:
		{
			usedPct: 100,
			resetsAt,
		},
		sevenDay: null,
		updatedAt: null,
		scoped: null,
	};
}

const CLEAR: UsageSummary =
{
	fiveHour:
	{
		usedPct: 40,
		resetsAt: RESETS_AT,
	},
	sevenDay: null,
	updatedAt: null,
	scoped: null,
};

beforeEach(() =>
{
	vi.useFakeTimers();
	vi.setSystemTime(T0);
});

afterEach(() =>
{
	cleanup();
	clearComposerQueues();
	resetParkedPrompts();
	vi.useRealTimers();
});

function setup(overrides: Partial<ParkedPromptsOptions> = {}, results: DeliveryResult[] = [])
{
	// A sent prompt starts a turn, as the live pane's pending send does.
	const deliver = vi.fn<(text: string) => Promise<DeliveryResult>>(async () =>
	{
		const result = results.shift() ?? "sent";
		if (result === "sent")
			rerender(
				{
					busy: true,
				},
			);
		return Promise.resolve(result);
	});
	const initial: ParkedPromptsOptions =
	{
		sessionId: SESSION,
		usage: spent(),
		busy: false,
		blocked: false,
		archived: false,
		interruptedAt: null,
		deliver,
		jitter: () => 0,
		...overrides,
	};
	const hook = renderHook(
		(props: ParkedPromptsOptions) => useParkedPrompts(props),
		{
			initialProps: initial,
		},
	);
	function rerender(next: Partial<ParkedPromptsOptions>)
	{
		Object.assign(initial, next);
		hook.rerender(
			{
				...initial,
			},
		);
	}
	return {
		...hook,
		deliver,
		rerender,
	};
}

async function advanceTo(ms: number)
{
	await act(async () =>
	{
		await vi.advanceTimersByTimeAsync(T0 + ms - Date.now());
	});
}

function texts(
	items: readonly
	{
		text: string;
	}[],
): string[]
{
	return items.map((item) => item.text);
}

describe("useParkedPrompts", () =>
{
	it("parks a send while the limit is spent instead of delivering it", () =>
	{
		const {result, deliver} = setup();
		let parked = false;
		act(() =>
		{
			parked = result.current.park("Alice's follow-up");
		});
		expect(
			{
				parked,
				items: result.current.items.map((item) => (
				{
					text: item.text,
					parked: item.parked,
				})),
				delivered: deliver.mock.calls,
				willAutoSend: result.current.willAutoSend,
				windowResetsAt: result.current.windowResetsAt,
			},
		).toStrictEqual(
			{
				parked: true,
				items: [
					{
						text: "Alice's follow-up",
						parked:
						{
							parkedAtMs: T0,
							parkedForResetsAt: RESETS_AT,
						},
					},
				],
				delivered: [],
				willAutoSend: true,
				windowResetsAt: RESETS_AT,
			},
		);
	});

	it("parks behind held messages even once the limit clears, and sends normally without holds", () =>
	{
		const {result, rerender} = setup(
			{
				usage: CLEAR,
			},
		);
		const clearDecision = result.current.decision();
		const clearSend = result.current.park("not held");
		rerender(
			{
				usage: spent(),
			},
		);
		const spentDecision = result.current.decision();
		act(() =>
		{
			result.current.park("Alice's follow-up");
		});
		rerender(
			{
				usage: CLEAR,
			},
		);
		const heldDecision = result.current.decision();
		rerender(
			{
				archived: true,
			},
		);
		const archivedDecision = result.current.decision();
		rerender(
			{
				archived: false,
			},
		);
		let second = false;
		act(() =>
		{
			second = result.current.park("Bob's follow-up");
		});
		expect(
			{
				decisions: [clearDecision, spentDecision, heldDecision, archivedDecision],
				clearSend,
				second,
				items: texts(result.current.items),
			},
		).toStrictEqual(
			{
				decisions: [false, "verdict", "holds", "suspended"],
				clearSend: false,
				second: true,
				items: ["Alice's follow-up", "Bob's follow-up"],
			},
		);
	});

	it("auto-sends at the reset plus the 90 s floor and the jitter, not a moment before", async () =>
	{
		const {result, deliver} = setup();
		act(() =>
		{
			result.current.park("Alice's follow-up");
		});
		await advanceTo(DUE - 1);
		const before = deliver.mock.calls.length;
		await advanceTo(DUE);
		expect(
			{
				before,
				after: deliver.mock.calls,
				items: result.current.items,
				flushing: result.current.flushing,
			},
		).toStrictEqual(
			{
				before: 0,
				after: [["Alice's follow-up"]],
				items: [],
				flushing: false,
			},
		);
	});

	it("never auto-sends past the 30 min late window", async () =>
	{
		const {result, deliver, rerender} = setup();
		act(() =>
		{
			result.current.park("Alice's follow-up");
		});
		rerender(
			{
				busy: true,
			},
		);
		await advanceTo(DUE + 1_800_001);
		rerender(
			{
				busy: false,
			},
		);
		await advanceTo(DUE + 1_900_000);
		expect(
			{
				delivered: deliver.mock.calls,
				willAutoSend: result.current.willAutoSend,
			},
		).toStrictEqual(
			{
				delivered: [],
				willAutoSend: false,
			},
		);
	});

	it("retries a not-ready machine run 45 s later, at most three runs per window", async () =>
	{
		const {result, deliver} = setup({}, ["not-ready", "not-ready", "not-ready"]);
		act(() =>
		{
			result.current.park("Alice's follow-up");
		});
		await advanceTo(DUE);
		await advanceTo(DUE + 44_999);
		const afterFirst = deliver.mock.calls.length;
		await advanceTo(DUE + 45_000);
		await advanceTo(DUE + 90_000);
		await advanceTo(DUE + 200_000);
		expect(
			{
				afterFirst,
				runs: deliver.mock.calls.length,
				items: texts(result.current.items),
				willAutoSend: result.current.willAutoSend,
			},
		).toStrictEqual(
			{
				afterFirst: 1,
				runs: 3,
				items: ["Alice's follow-up"],
				willAutoSend: false,
			},
		);
	});

	it("forfeits the window when a machine send fails past the floor, as upstream's ej does", async () =>
	{
		const {result, deliver} = setup({}, ["failed"]);
		act(() =>
		{
			result.current.park("Alice's follow-up");
		});
		await advanceTo(DUE + 200_000);
		expect(
			{
				delivered: deliver.mock.calls.length,
				items: texts(result.current.items),
				willAutoSend: result.current.willAutoSend,
			},
		).toStrictEqual(
			{
				delivered: 1,
				items: ["Alice's follow-up"],
				willAutoSend: false,
			},
		);
	});

	it("sends at once on Send anyway, one held message per idle", async () =>
	{
		const {result, deliver, rerender} = setup();
		act(() =>
		{
			result.current.park("Alice's follow-up");
			result.current.park("Bob's follow-up");
		});
		rerender(
			{
				usage: CLEAR,
			},
		);
		await act(async () =>
		{
			result.current.sendAnyway();
			await Promise.resolve();
		});
		const whileBusy = deliver.mock.calls.length;
		rerender(
			{
				busy: false,
			},
		);
		await act(async () =>
		{
			await Promise.resolve();
		});
		expect(
			{
				whileBusy,
				delivered: deliver.mock.calls,
				items: result.current.items,
			},
		).toStrictEqual(
			{
				whileBusy: 1,
				delivered: [["Alice's follow-up"], ["Bob's follow-up"]],
				items: [],
			},
		);
	});

	it("stops the flush when the limit is spent again after the first send", async () =>
	{
		const {result, deliver, rerender} = setup();
		act(() =>
		{
			result.current.park("Alice's follow-up");
			result.current.park("Bob's follow-up");
		});
		await act(async () =>
		{
			result.current.sendAnyway();
			await Promise.resolve();
		});
		rerender(
			{
				busy: true,
				usage: spent(RESETS_AT + 5 * 3600),
			},
		);
		rerender(
			{
				busy: false,
			},
		);
		await act(async () =>
		{
			await Promise.resolve();
		});
		expect(
			{
				delivered: deliver.mock.calls,
				items: texts(result.current.items),
				flushing: result.current.flushing,
			},
		).toStrictEqual(
			{
				delivered: [["Alice's follow-up"]],
				items: ["Bob's follow-up"],
				flushing: false,
			},
		);
	});

	it("forfeits the window when the user stops the auto-sent turn", async () =>
	{
		const {result, deliver, rerender} = setup();
		act(() =>
		{
			result.current.park("Alice's follow-up");
			result.current.park("Bob's follow-up");
		});
		await advanceTo(DUE);
		rerender(
			{
				busy: true,
			},
		);
		rerender(
			{
				interruptedAt: Date.now(),
			},
		);
		rerender(
			{
				busy: false,
			},
		);
		await advanceTo(DUE + 200_000);
		expect(
			{
				delivered: deliver.mock.calls,
				items: texts(result.current.items),
				willAutoSend: result.current.willAutoSend,
			},
		).toStrictEqual(
			{
				delivered: [["Alice's follow-up"]],
				items: ["Bob's follow-up"],
				willAutoSend: false,
			},
		);
	});

	it("keeps the window on a Stop before the promised time with no run yet", () =>
	{
		const {result, rerender} = setup();
		act(() =>
		{
			result.current.park("Alice's follow-up");
		});
		rerender(
			{
				interruptedAt: Date.now(),
			},
		);
		expect(result.current.willAutoSend).toBe(true);
	});

	it("never fires for an archived session", async () =>
	{
		dispatchComposerQueue(
			SESSION,
			{
				type: "enqueue",
				item:
				{
					...newQueuedPrompt("Alice's follow-up"),
					parked:
					{
						parkedAtMs: T0,
						parkedForResetsAt: RESETS_AT,
					},
				},
			},
		);
		const {result, deliver} = setup(
			{
				archived: true,
			},
		);
		await advanceTo(DUE + 60_000);
		expect(
			{
				delivered: deliver.mock.calls,
				willAutoSend: result.current.willAutoSend,
				parksWhileArchived: result.current.park("Bob's follow-up"),
			},
		).toStrictEqual(
			{
				delivered: [],
				willAutoSend: false,
				parksWhileArchived: true,
			},
		);
	});

	it("spaces fires across sessions by 12 s", async () =>
	{
		const first = setup();
		const second = setup(
			{
				sessionId: "session-other",
			},
		);
		act(() =>
		{
			first.result.current.park("Alice's follow-up");
			second.result.current.park("Bob's follow-up");
		});
		await advanceTo(DUE);
		const atDue = first.deliver.mock.calls.length + second.deliver.mock.calls.length;
		await advanceTo(DUE + 11_999);
		const beforeSlot = first.deliver.mock.calls.length + second.deliver.mock.calls.length;
		await advanceTo(DUE + 12_000);
		expect(
			{
				atDue,
				beforeSlot,
				afterSlot: first.deliver.mock.calls.length + second.deliver.mock.calls.length,
			},
		).toStrictEqual(
			{
				atDue: 1,
				beforeSlot: 1,
				afterSlot: 2,
			},
		);
	});
});
