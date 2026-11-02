// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {describe, expect, it, vi} from "vite-plus/test";
import {useTimedFlag} from "../src/hooks/use-timed-flag";

describe("useTimedFlag", () =>
{
	it("stays on for the window, restarting it on a second raise", () =>
	{
		vi.useFakeTimers();
		const {result} = renderHook(() => useTimedFlag(1000));
		act(() =>
		{
			result.current[1]();
		});
		act(() =>
		{
			vi.advanceTimersByTime(600);
			result.current[1]();
		});
		act(() =>
		{
			vi.advanceTimersByTime(600);
		});
		const afterRestart =
		{
			on: result.current[0],
			timers: vi.getTimerCount(),
		};
		act(() =>
		{
			vi.advanceTimersByTime(400);
		});

		expect(
			{
				afterRestart,
				afterWindow:
				{
					on: result.current[0],
					timers: vi.getTimerCount(),
				},
			},
		).toStrictEqual(
			{
				afterRestart:
				{
					on: true,
					timers: 1,
				},
				afterWindow:
				{
					on: false,
					timers: 0,
				},
			},
		);
	});

	it("leaves no timer when raised after unmount, as a clipboard write resolving late would", () =>
	{
		vi.useFakeTimers();
		const {result, unmount} = renderHook(() => useTimedFlag(1000));
		const raise = result.current[1];
		unmount();

		raise();

		expect(vi.getTimerCount()).toBe(0);
	});
});
