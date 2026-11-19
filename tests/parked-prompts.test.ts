import {describe, expect, it} from "vite-plus/test";

import
{
	PARK_FIRE_FLOOR_MS,
	PARK_FIRE_SPACING_MS,
	PARK_LATE_WINDOW_MS,
	PARK_MAX_RUNS,
	PARK_RETRY_MS,
	type ParkWindow,
	autoSendPlan,
	autoSendSkipReason,
	beginRun,
	heldCountText,
	LOCAL_ENVIRONMENTS_ON,
	parkedListInTranscript,
	newParkWindow,
	parkDecision,
	parkJitterMs,
	parkedNoticeMessage,
	parkedResetDetail,
	settleRun,
	stopForfeits,
	windowFor,
} from "../src/lib/parked-prompts";

const RESETS_AT = 1000;
const PROMISED_AT = RESETS_AT * 1000 + 90_000;

function win(overrides: Partial<ParkWindow> = {}): ParkWindow
{
	return {
		...newParkWindow(RESETS_AT, 5000),
		...overrides,
	};
}

const PLAN_CONTEXT =
{
	verdict: "exceeded" as const,
	sawExceeded: true,
	held: [],
	archived: false,
	blocked: false,
};

describe("parked prompt constants", () =>
{
	it("copies upstream's timings", () =>
	{
		expect(
			{
				floor: PARK_FIRE_FLOOR_MS,
				late: PARK_LATE_WINDOW_MS,
				retry: PARK_RETRY_MS,
				runs: PARK_MAX_RUNS,
				spacing: PARK_FIRE_SPACING_MS,
				jitterLow: parkJitterMs(() => 0),
				jitterHigh: parkJitterMs(() => 0.9999),
			},
		).toStrictEqual(
			{
				floor: 90_000,
				late: 1_800_000,
				retry: 45_000,
				runs: 3,
				spacing: 12_000,
				jitterLow: 2000,
				jitterHigh: 7999,
			},
		);
	});
});

describe("parkDecision", () =>
{
	const base =
	{
		limit:
		{
			resetsAt: 2000,
		},
		heldCount: 0,
		flushing: false,
		archived: false,
		nowMs: 1_000_000,
	};
	it("follows upstream's p2 order", () =>
	{
		expect(
			{
				suspended: parkDecision(
					{
						...base,
						archived: true,
						heldCount: 1,
					},
				),
				archivedNoHolds: parkDecision(
					{
						...base,
						archived: true,
					},
				),
				holds: parkDecision(
					{
						...base,
						limit: null,
						heldCount: 2,
					},
				),
				flush: parkDecision(
					{
						...base,
						limit: null,
						flushing: true,
					},
				),
				verdict: parkDecision(base),
				resetPassed: parkDecision(
					{
						...base,
						nowMs: 2_000_000,
					},
				),
				clear: parkDecision(
					{
						...base,
						limit: null,
					},
				),
			},
		).toStrictEqual(
			{
				suspended: "suspended",
				archivedNoHolds: "verdict",
				holds: "holds",
				flush: "flush",
				verdict: "verdict",
				resetPassed: false,
				clear: false,
			},
		);
	});
});

describe("windowFor", () =>
{
	it("reuses a window under an hour away and opens a new one at an hour", () =>
	{
		const prev = win(
			{
				runs: 1,
			},
		);
		expect(
			{
				reused: windowFor(prev, RESETS_AT + 3599, 7000),
				fresh: windowFor(prev, RESETS_AT + 3600, 7000),
				none: windowFor(undefined, RESETS_AT, 7000),
			},
		).toStrictEqual(
			{
				reused:
				{
					...prev,
					resetsAt: RESETS_AT + 3599,
				},
				fresh:
				{
					resetsAt: RESETS_AT + 3600,
					busy: false,
					forfeit: false,
					clearOk: true,
					runs: 0,
					nextRunAt: 0,
					jitterMs: 7000,
				},
				none:
				{
					resetsAt: RESETS_AT,
					busy: false,
					forfeit: false,
					clearOk: true,
					runs: 0,
					nextRunAt: 0,
					jitterMs: 7000,
				},
			},
		);
	});
});

describe("autoSendPlan", () =>
{
	const nowMs = 0;
	it("is due at the reset plus the floor and jitter", () =>
	{
		expect(
			autoSendPlan(
				win(),
				{
					...PLAN_CONTEXT,
					nowMs,
				},
			),
		).toStrictEqual(
			{
				dueAt: 1_095_000,
				promisedAt: PROMISED_AT,
				lateAfter: 1_095_000 + 1_800_000,
			},
		);
	});
	it("returns null when spent, late, forfeit, busy, archived, blocked or from an earlier window", () =>
	{
		const plan = (window: ParkWindow, overrides: Partial<Parameters<typeof autoSendPlan>[1]> = {}) =>
			autoSendPlan(
				window,
				{
					...PLAN_CONTEXT,
					nowMs,
					...overrides,
				},
			);
		expect(
			{
				twoRuns:
					plan(
						win(
							{
								runs: 2,
							},
						),
					) !== null,
				threeRuns: plan(
					win(
						{
							runs: 3,
						},
					),
				),
				atLate:
					plan(
						win(),
						{
							nowMs: 1_095_000 + 1_800_000,
						},
					) !== null,
				pastLate: plan(
					win(),
					{
						nowMs: 1_095_000 + 1_800_001,
					},
				),
				forfeit: plan(
					win(
						{
							forfeit: true,
						},
					),
				),
				busy: plan(
					win(
						{
							busy: true,
						},
					),
				),
				archived: plan(
					win(),
					{
						archived: true,
					},
				),
				blocked: plan(
					win(),
					{
						blocked: true,
					},
				),
				earlierWindow: plan(
					win(),
					{
						held: [
							{
								parkedForResetsAt: RESETS_AT - 3600,
							},
						],
					},
				),
				sameWindow:
					plan(
						win(),
						{
							held: [
								{
									parkedForResetsAt: RESETS_AT - 3599,
								},
								{},
							],
						},
					) !== null,
			},
		).toStrictEqual(
			{
				twoRuns: true,
				threeRuns: null,
				atLate: true,
				pastLate: null,
				forfeit: null,
				busy: null,
				archived: null,
				blocked: null,
				earlierWindow: null,
				sameWindow: true,
			},
		);
	});
	it("fires at once on an early clear verdict and not before ever seeing the limit", () =>
	{
		expect(
			{
				earlyClear: autoSendPlan(
					win(
						{
							jitterMs: 0,
						},
					),
					{
						...PLAN_CONTEXT,
						verdict: "clear",
						nowMs: 500_000,
					},
				),
				lateClear: autoSendPlan(
					win(
						{
							jitterMs: 0,
						},
					),
					{
						...PLAN_CONTEXT,
						verdict: "clear",
						nowMs: 950_000,
					},
				)?.dueAt,
				neverSaw: autoSendPlan(
					win(),
					{
						...PLAN_CONTEXT,
						verdict: "clear",
						sawExceeded: false,
						nowMs,
					},
				),
			},
		).toStrictEqual(
			{
				earlyClear:
				{
					dueAt: 500_000,
					promisedAt: 500_000,
					lateAfter: 2_300_000,
				},
				lateClear: PROMISED_AT,
				neverSaw: null,
			},
		);
	});
	it("waits 45s after a machine run fires, whatever the outcome", () =>
	{
		const fireAt = PROMISED_AT + 5000;
		const settled = settleRun(beginRun(win(), "machine", fireAt), "machine", "drained", fireAt + 1000);
		expect(
			autoSendPlan(
				settled,
				{
					...PLAN_CONTEXT,
					nowMs: fireAt + 1000,
				},
			)?.dueAt,
		).toBe(fireAt + 45_000);
	});
});

describe("beginRun and settleRun", () =>
{
	const now = PROMISED_AT + 10_000;
	it("counts machine runs at fire time and marks the window busy", () =>
	{
		expect(
			{
				machine: beginRun(win(), "machine", now),
				user: beginRun(win(), "user", now),
			},
		).toStrictEqual(
			{
				machine: win(
					{
						busy: true,
						runs: 1,
						nextRunAt: now + 45_000,
					},
				),
				user: win(
					{
						busy: true,
					},
				),
			},
		);
	});
	it("settles each outcome like upstream's ej", () =>
	{
		const running = win(
			{
				busy: true,
				clearOk: false,
				nextRunAt: now + 45_000,
			},
		);
		expect(
			{
				drained: settleRun(running, "machine", "drained", now),
				stopped: settleRun(running, "machine", "stopped", now),
				untouched: settleRun(running, "machine", "untouched", now),
				refused: settleRun(running, "user", "refused", now),
				machineHaltedBeforeFloor: settleRun(running, "machine", "halted", PROMISED_AT - 1),
				machineHaltedAfterFloor: settleRun(running, "machine", "halted", PROMISED_AT),
				userHalted: settleRun(running, "user", "halted", now),
			},
		).toStrictEqual(
			{
				drained:
				{
					...running,
					busy: false,
					clearOk: true,
				},
				stopped:
				{
					...running,
					busy: false,
					clearOk: false,
					forfeit: true,
				},
				untouched:
				{
					...running,
					busy: false,
				},
				refused:
				{
					...running,
					busy: false,
				},
				machineHaltedBeforeFloor:
				{
					...running,
					busy: false,
					nextRunAt: now + 45_000,
				},
				machineHaltedAfterFloor:
				{
					...running,
					busy: false,
					forfeit: true,
				},
				userHalted:
				{
					...running,
					busy: false,
					forfeit: true,
				},
			},
		);
	});
});

describe("stopForfeits", () =>
{
	it("forfeits a Stop at the promised time or after a run, not before", () =>
	{
		expect(
			{
				early: stopForfeits(
					win(),
					{
						nowMs: PROMISED_AT - 1,
						promisedAt: PROMISED_AT,
					},
				),
				promised: stopForfeits(
					win(),
					{
						nowMs: PROMISED_AT,
						promisedAt: PROMISED_AT,
					},
				),
				afterRun: stopForfeits(
					win(
						{
							runs: 1,
						},
					),
					{
						nowMs: 0,
						promisedAt: PROMISED_AT,
					},
				),
				alreadyForfeit: stopForfeits(
					win(
						{
							forfeit: true,
							runs: 1,
						},
					),
					{
						nowMs: PROMISED_AT,
						promisedAt: PROMISED_AT,
					},
				),
			},
		).toStrictEqual(
			{
				early: false,
				promised: true,
				afterRun: true,
				alreadyForfeit: false,
			},
		);
	});
});

describe("autoSendSkipReason", () =>
{
	const lateDeadline = RESETS_AT * 1000 + 90_000 + 5000 + 1_800_000;
	const context =
	{
		headParkedAtMs: 0,
		nowMs: lateDeadline + 1,
		featureOn: true,
		archived: false,
		blocked: false,
		turn: "idle" as const,
		held: [],
	};
	it("reports upstream's ij reasons in order once the late deadline passes", () =>
	{
		expect(
			{
				beforeDeadline: autoSendSkipReason(
					win(),
					{
						...context,
						nowMs: lateDeadline,
					},
				),
				parkedAfter: autoSendSkipReason(
					win(),
					{
						...context,
						headParkedAtMs: lateDeadline + 1,
					},
				),
				noHead: autoSendSkipReason(
					win(),
					{
						...context,
						headParkedAtMs: undefined,
					},
				),
				busyWindow: autoSendSkipReason(
					win(
						{
							busy: true,
						},
					),
					context,
				),
				forfeit: autoSendSkipReason(
					win(
						{
							forfeit: true,
							runs: 3,
						},
					),
					context,
				),
				budget: autoSendSkipReason(
					win(
						{
							runs: 3,
						},
					),
					{
						...context,
						archived: true,
					},
				),
				off: autoSendSkipReason(
					win(),
					{
						...context,
						archived: true,
						held: [
							{
								parkedForResetsAt: RESETS_AT + 3600,
							},
						],
					},
				),
				featureOff: autoSendSkipReason(
					win(),
					{
						...context,
						featureOn: false,
					},
				),
				earlierWindow: autoSendSkipReason(
					win(),
					{
						...context,
						blocked: true,
						held: [
							{
								parkedForResetsAt: RESETS_AT + 3600,
							},
						],
					},
				),
				busy: autoSendSkipReason(
					win(),
					{
						...context,
						turn: "running",
					},
				),
				blocked: autoSendSkipReason(
					win(),
					{
						...context,
						blocked: true,
					},
				),
				tooLate: autoSendSkipReason(win(), context),
			},
		).toStrictEqual(
			{
				beforeDeadline: null,
				parkedAfter: null,
				noHead: null,
				busyWindow: null,
				forfeit: "forfeit",
				budget: "budget",
				off: "off",
				featureOff: "off",
				earlierWindow: "earlier_window",
				busy: "busy",
				blocked: "busy",
				tooLate: "too_late",
			},
		);
	});
});

describe("parked copy", () =>
{
	const timeZone = "America/New_York";
	// 2026-11-06 07:00 UTC is 2:00 AM in New York; the reset at 09:00 UTC is 4:00 AM the same day.
	const nowMs = Date.UTC(2026, 10, 6, 7, 0);
	it("formats the reset detail like upstream's Bn", () =>
	{
		expect(
			{
				today: parkedResetDetail(Date.UTC(2026, 10, 6, 9, 0) / 1000, nowMs, timeZone),
				otherDay: parkedResetDetail(Date.UTC(2026, 10, 7, 9, 0) / 1000, nowMs, timeZone),
				now: parkedResetDetail(nowMs / 1000, nowMs, timeZone),
				past: parkedResetDetail(nowMs / 1000 - 1, nowMs, timeZone),
			},
		).toStrictEqual(
			{
				today: "Resets at 4:00 AM",
				otherDay: "Resets Sat, Nov 7, 4:00 AM",
				now: "Resets at 2:00 AM",
				past: undefined,
			},
		);
	});
	it("copies upstream's band and held-count strings verbatim", () =>
	{
		expect(
			{
				archived: parkedNoticeMessage(
					{
						archived: true,
						willAutoSend: true,
					},
				),
				willAutoSend: parkedNoticeMessage(
					{
						archived: false,
						willAutoSend: true,
					},
				),
				sendAnyway: parkedNoticeMessage(
					{
						archived: false,
						willAutoSend: false,
					},
				),
				oneAuto: heldCountText(1, true),
				twoAuto: heldCountText(2, true),
				oneHeld: heldCountText(1, false),
				twoHeld: heldCountText(2, false),
			},
		).toStrictEqual(
			{
				archived: "This session is archived, so held messages won’t send. Unarchive it to send them.",
				willAutoSend: "You hit your usage limit. Held messages will send when it resets.",
				sendAnyway: "You hit your usage limit. Send anyway sends held messages now.",
				oneAuto: "1 held message will send automatically",
				twoAuto: "2 held messages will send automatically",
				oneHeld: "1 message held",
				twoHeld: "2 messages held",
			},
		);
	});
});

describe("parkedListInTranscript", () =>
{
	it("lists parked prompts in the transcript only with environments on and the transcript mounted; local stays on the dock", () =>
	{
		const gate = (environmentsOn: boolean, inTranscript: boolean) =>
			parkedListInTranscript(
				{
					environmentsOn,
					inTranscript,
				},
			);
		expect(
			{
				both: gate(true, true),
				noEnvironments: gate(false, true),
				noTranscript: gate(true, false),
				local: gate(LOCAL_ENVIRONMENTS_ON, true),
			},
		).toStrictEqual(
			{
				both: true,
				noEnvironments: false,
				noTranscript: false,
				local: false,
			},
		);
	});
});
