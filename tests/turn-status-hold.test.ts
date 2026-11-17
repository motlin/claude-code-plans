import {describe, expect, it} from "vite-plus/test";
import
{
	TURN_STATUS_BUSY_HOLD_MS,
	TURN_STATUS_SETTLE_MS,
	busyLineKey,
	stepHoldMinMs,
	turnStatusHoldOptions,
	turnStatusMinMs,
} from "../src/lib/turn-status-hold";
import type {TurnStatusState} from "../src/lib/working-marker";

const shown = (state: TurnStatusState) => (
{
	state,
});

describe("upstream gR's row hold (Gh, settleMs, xj)", () =>
{
	it("holds busy → busy 2s on a row with steps, the default on a leaf row, and nothing otherwise", () =>
	{
		expect(
			{
				constants: [TURN_STATUS_BUSY_HOLD_MS, TURN_STATUS_SETTLE_MS],
				busyBusyLeaf: turnStatusMinMs("busy", true)(shown("busy")),
				busyBusyGroup: turnStatusMinMs("busy", false)(shown("busy")),
				busyDone: turnStatusMinMs("done", false)(shown("busy")),
				doneBusy: turnStatusMinMs("busy", false)(shown("done")),
				pendingBusy: turnStatusMinMs("busy", true)(shown("pending")),
				busyBlocked: turnStatusMinMs("blocked", true)(shown("busy")),
			},
		).toStrictEqual(
			{
				constants: [2000, 250],
				busyBusyLeaf: undefined,
				busyBusyGroup: 2000,
				busyDone: 0,
				doneBusy: 0,
				pendingBusy: 0,
				busyBlocked: 0,
			},
		);
	});

	it("keys the busy line by its sorted step ids, and none for an empty set", () =>
	{
		expect([busyLineKey([]), busyLineKey(["b", "a"]), busyLineKey(["a"])]).toStrictEqual([undefined, "a\0b", "a"]);
	});

	it("passes the line only on a busy row with steps, with the 250ms settle and restretch", () =>
	{
		const strip = (opts: ReturnType<typeof turnStatusHoldOptions>) => (
		{
			settleMs: opts.settleMs,
			line: opts.line,
			restretch: opts.restretch,
		});
		expect(
			{
				group: strip(turnStatusHoldOptions("busy", false, "a")),
				leaf: strip(turnStatusHoldOptions("busy", true, "a")),
				done: strip(turnStatusHoldOptions("done", false, "a")),
			},
		).toStrictEqual(
			{
				group:
				{
					settleMs: 250,
					line: "a",
					restretch: true,
				},
				leaf:
				{
					settleMs: 250,
					line: undefined,
					restretch: true,
				},
				done:
				{
					settleMs: 250,
					line: undefined,
					restretch: true,
				},
			},
		);
	});
});

describe("upstream wr's step hold", () =>
{
	it("holds a shown busy step the default before busy or done, and nothing otherwise", () =>
	{
		expect(
			{
				busyBusy: stepHoldMinMs("busy")(shown("busy")),
				busyDone: stepHoldMinMs("done")(shown("busy")),
				busyFailed: stepHoldMinMs("failed")(shown("busy")),
				busyStopped: stepHoldMinMs("stopped")(shown("busy")),
				pendingBusy: stepHoldMinMs("busy")(shown("pending")),
				doneBusy: stepHoldMinMs("busy")(shown("done")),
			},
		).toStrictEqual(
			{
				busyBusy: undefined,
				busyDone: undefined,
				busyFailed: 0,
				busyStopped: 0,
				pendingBusy: 0,
				doneBusy: 0,
			},
		);
	});
});
