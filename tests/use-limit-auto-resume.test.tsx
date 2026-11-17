// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import type {DeliveryResult} from "../src/hooks/use-composer-queue";
import {AUTO_RESUME_NUDGE, type LimitAutoResumeOptions, useLimitAutoResume} from "../src/hooks/use-limit-auto-resume";
import
{
	AUTO_RESUME_OPT_IN_KEY,
	getAutoResumeEntry,
	resetAutoResumeStore,
	toggleAutoResume,
} from "../src/lib/limit-auto-resume";
import type {ParkDecision} from "../src/lib/parked-prompts";
import {processTranscript, type SessionLine} from "../src/lib/transcript";

const SESSION = "session-limit";
const T0 = Date.UTC(2026, 10, 17, 3, 0);
const RESETS_AT = T0 / 1000 + 600;
/** Reset + 90 s floor + the 2 s jitter a zero random gives. */
const DUE_MS = 600_000 + 90_000 + 2000;

const PROMPT =
{
	type: "user",
	uuid: "u-1",
	timestamp: "2026-11-17T02:59:00.000Z",
	message:
	{
		role: "user",
		content: "hello",
	},
};

function limitRecord(uuid: string, rateLimitType = "five_hour", resetsAt = RESETS_AT)
{
	return {
		type: "assistant",
		uuid,
		timestamp: "2026-11-17T02:59:30.000Z",
		message:
		{
			role: "assistant",
			model: "<synthetic>",
			content: [
				{
					type: "text",
					text: "You've hit your session limit · resets 3:10am (UTC)",
				},
			],
		},
		isApiErrorMessage: true,
		apiErrorStatus: 429,
		apiError: "usage_limit_reached",
		apiErrorParams:
		{
			rate_limit_info:
			{
				status: "rejected",
				resetsAt,
				rateLimitType,
				overageStatus: "rejected",
				overageDisabledReason: "",
				isUsingOverage: false,
			},
		},
	};
}

const OVERLOADED =
{
	type: "assistant",
	uuid: "a-529",
	timestamp: "2026-11-17T02:59:40.000Z",
	message:
	{
		role: "assistant",
		model: "<synthetic>",
		content: [
			{
				type: "text",
				text: "API Error: 529 Overloaded.",
			},
		],
	},
	isApiErrorMessage: true,
	apiErrorStatus: 529,
};

function lines(...records: unknown[]): SessionLine[]
{
	return processTranscript(records).lines;
}

const LIMITED = lines(PROMPT, limitRecord("a-1"));

function setup(overrides: Partial<LimitAutoResumeOptions> = {})
{
	const send = vi.fn<(prompt: string) => Promise<DeliveryResult>>(async () => Promise.resolve("sent"));
	const initial: LimitAutoResumeOptions =
	{
		sessionId: SESSION,
		lines: LIMITED,
		retryable: true,
		send,
		composerText: () => "",
		parked: (): ParkDecision => false,
		random: () => 0,
		...overrides,
	};
	const hook = renderHook(
		(props: LimitAutoResumeOptions) => useLimitAutoResume(props),
		{
			initialProps: initial,
		},
	);
	return {
		send,
		hook,
		initial,
	};
}

beforeEach(() =>
{
	vi.useFakeTimers();
	vi.setSystemTime(T0);
	localStorage.clear();
	resetAutoResumeStore();
});

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
	localStorage.clear();
	resetAutoResumeStore();
});

describe("useLimitAutoResume", () =>
{
	it("arms a 5-hour limit and types the nudge once at reset + 90 s + jitter, then announces it", async () =>
	{
		const {send, hook} = setup();
		expect(getAutoResumeEntry(SESSION)).toStrictEqual(
			{
				resetsAt: RESETS_AT,
				attempt: 0,
				optedIn: true,
				armed: true,
			},
		);

		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(DUE_MS - 1);
		});
		expect(send.mock.calls).toStrictEqual([]);

		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(
			{
				calls: send.mock.calls,
				announcement: hook.result.current,
			},
		).toStrictEqual(
			{
				calls: [[AUTO_RESUME_NUDGE]],
				announcement: "",
			},
		);

		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(50);
		});
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(3_600_000);
		});
		expect(
			{
				calls: send.mock.calls.length,
				announcement: hook.result.current,
				entry: getAutoResumeEntry(SESSION),
				nudge: AUTO_RESUME_NUDGE,
			},
		).toStrictEqual(
			{
				calls: 1,
				announcement: "Limits reset — resuming session",
				entry:
				{
					resetsAt: RESETS_AT,
					attempt: 1,
					optedIn: true,
					armed: false,
				},
				nudge: "I hit my usage limit while you were working, but it has reset now. Please continue from where you left off.",
			},
		);
	});

	it("declines and disarms when the composer has a draft at fire time", async () =>
	{
		const {send} = setup(
			{
				composerText: () => "half-typed",
			},
		);
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(DUE_MS);
		});
		expect(
			{
				calls: send.mock.calls,
				armed: getAutoResumeEntry(SESSION)?.armed,
			},
		).toStrictEqual(
			{
				calls: [],
				armed: false,
			},
		);
	});

	it("declines while the session can't take a retry, or messages are parked", async () =>
	{
		const busy = setup(
			{
				retryable: false,
			},
		);
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(DUE_MS);
		});
		cleanup();
		resetAutoResumeStore();
		const parked = setup(
			{
				parked: () => "holds",
			},
		);
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(DUE_MS);
		});
		expect([busy.send.mock.calls, parked.send.mock.calls, getAutoResumeEntry(SESSION)?.armed]).toStrictEqual([
			[],
			[],
			false,
		]);
	});

	it("never fires once unchecked, and a saved opt-out leaves the next limit unchecked", async () =>
	{
		const {send} = setup();
		act(() =>
		{
			toggleAutoResume(SESSION, false, Date.now());
		});
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(DUE_MS);
		});
		expect(
			{
				calls: send.mock.calls,
				pref: localStorage.getItem(AUTO_RESUME_OPT_IN_KEY),
			},
		).toStrictEqual(
			{
				calls: [],
				pref: "false",
			},
		);

		cleanup();
		resetAutoResumeStore();
		setup();
		expect(getAutoResumeEntry(SESSION)?.armed).toBe(false);
	});

	it("supersedes the entry when a later non-limit error ends the transcript", async () =>
	{
		const {send, hook, initial} = setup();
		hook.rerender(
			{
				...initial,
				lines: lines(PROMPT, limitRecord("a-1"), OVERLOADED),
			},
		);
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(DUE_MS);
		});
		expect(
			{
				calls: send.mock.calls,
				entry: getAutoResumeEntry(SESSION),
			},
		).toStrictEqual(
			{
				calls: [],
				entry:
				{
					resetsAt: RESETS_AT,
					attempt: 0,
					optedIn: true,
					armed: false,
					superseded: true,
				},
			},
		);
	});

	it("gives up after three nudges in the same window", async () =>
	{
		const {send, hook, initial} = setup();
		for (const uuid of ["a-2", "a-3", "a-4"])
		{
			await act(async () =>
			{
				await vi.advanceTimersByTimeAsync(DUE_MS);
			});
			hook.rerender(
				{
					...initial,
					lines: lines(PROMPT, limitRecord(uuid)),
				},
			);
		}
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(DUE_MS);
		});
		expect(
			{
				calls: send.mock.calls.length,
				entry: getAutoResumeEntry(SESSION),
			},
		).toStrictEqual(
			{
				calls: 3,
				entry:
				{
					resetsAt: RESETS_AT,
					attempt: 3,
					optedIn: true,
					armed: false,
				},
			},
		);
	});

	it("offers nothing for a weekly limit", () =>
	{
		setup(
			{
				lines: lines(PROMPT, limitRecord("a-1", "seven_day")),
			},
		);
		expect(getAutoResumeEntry(SESSION)).toBeUndefined();
	});
});
