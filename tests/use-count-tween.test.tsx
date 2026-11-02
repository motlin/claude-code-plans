// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {COUNT_TWEEN_MS, easeOutCubic, useCountTween} from "../src/hooks/use-count-tween";
import {type FrameQueue, installFrameQueue, stubReducedMotion} from "./helpers/frame-queue";

let frames: FrameQueue;

beforeEach(() =>
{
	frames = installFrameQueue();
	stubReducedMotion(false);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function mount(initial: number)
{
	return renderHook(
		({value}: {value: number}) => useCountTween(value),
		{
			initialProps:
			{
				value: initial,
			},
		},
	);
}

function runFrame(ts: number)
{
	act(() =>
	{
		frames.frame(ts);
	});
}

describe("easeOutCubic", () =>
{
	it("is upstream's Ze, 1 - (1 - t)^3", () =>
	{
		expect(
			{
				ms: COUNT_TWEEN_MS,
				eased: [0, 0.25, 0.5, 1].map(easeOutCubic),
			},
		).toStrictEqual(
			{
				ms: 400,
				eased: [0, 0.578125, 0.875, 1],
			},
		);
	});
});

describe("useCountTween", () =>
{
	it("shows the real value on mount and queues no frame", () =>
	{
		const {result} = mount(10);
		expect(
			{
				shown: result.current,
				pending: frames.pending(),
			},
		).toStrictEqual(
			{
				shown: 10,
				pending: [],
			},
		);
	});

	it("eases a rise over 400ms and stops queueing once it lands", () =>
	{
		const {result, rerender} = mount(10);
		rerender(
			{
				value: 110,
			},
		);
		const seen: number[] = [result.current];
		for (const ts of [100, 200, 400])
		{
			runFrame(ts);
			seen.push(result.current);
		}
		expect(
			{
				seen,
				pending: frames.pending(),
			},
		).toStrictEqual(
			{
				seen: [10, 68, 98, 110],
				pending: [],
			},
		);
	});

	it("eases a fall the same way", () =>
	{
		const {result, rerender} = mount(110);
		rerender(
			{
				value: 10,
			},
		);
		runFrame(200);
		expect(result.current).toBe(23);
	});

	it("retargets from the painted value, not the old start or target", () =>
	{
		const {result, rerender} = mount(0);
		rerender(
			{
				value: 100,
			},
		);
		runFrame(200);
		const mid = result.current;
		rerender(
			{
				value: 200,
			},
		);
		runFrame(300);
		expect(
			{
				mid,
				next: result.current,
			},
		).toStrictEqual(
			{
				mid: 88,
				next: 153,
			},
		);
	});

	it("queues no frame when re-rendered with the same value", () =>
	{
		const {result, rerender} = mount(10);
		rerender(
			{
				value: 10,
			},
		);
		expect(
			{
				shown: result.current,
				pending: frames.pending(),
			},
		).toStrictEqual(
			{
				shown: 10,
				pending: [],
			},
		);
	});

	it("snaps in the same render under the OS reduced-motion query", () =>
	{
		stubReducedMotion(true);
		const {result, rerender} = mount(10);
		rerender(
			{
				value: 110,
			},
		);
		expect(
			{
				shown: result.current,
				pending: frames.pending(),
			},
		).toStrictEqual(
			{
				shown: 110,
				pending: [],
			},
		);
	});

	it("cancels the pending frame on unmount mid-tween", () =>
	{
		const {rerender, unmount} = mount(10);
		rerender(
			{
				value: 110,
			},
		);
		runFrame(100);
		const [pendingId] = frames.pending();
		unmount();
		expect(
			{
				pendingId,
				cancelled: frames.cancelAnimationFrame.mock.calls,
			},
		).toStrictEqual(
			{
				pendingId: 2,
				cancelled: [[2]],
			},
		);
	});
});
