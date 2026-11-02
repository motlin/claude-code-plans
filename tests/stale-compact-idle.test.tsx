// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {useStaleCompactIdle} from "../src/hooks/use-stale-compact-idle";

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const MINUTE = 60_000;

let visibility: DocumentVisibilityState = "visible";

beforeEach(() =>
{
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	visibility = "visible";
	vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() =>
{
	cleanup();
	document.body.innerHTML = "";
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function footerInput(): HTMLInputElement
{
	const footer = document.createElement("div");
	footer.setAttribute("data-session-footer", "");
	const input = document.createElement("input");
	footer.append(input);
	document.body.append(footer);
	return input;
}

function outsideInput(): HTMLInputElement
{
	const input = document.createElement("input");
	document.body.append(input);
	return input;
}

function advance(ms: number): void
{
	act(() =>
	{
		vi.advanceTimersByTime(ms);
	});
}

function fire(target: EventTarget, event: Event): void
{
	act(() =>
	{
		target.dispatchEvent(event);
	});
}

describe("useStaleCompactIdle (upstream nke idle clock)", () =>
{
	it("checks at mount and records an idle stretch past 70 minutes", () =>
	{
		const anchor = NOW - 71 * MINUTE;
		const {result} = renderHook(() =>
			useStaleCompactIdle(
				{
					anchorMs: anchor,
					responding: false,
					hidden: false,
				},
			),
		);
		expect(result.current).toStrictEqual(
			{
				anchor,
				ageMs: 71 * MINUTE,
			},
		);
	});

	it("has no interval: crossing 70 minutes waits for the next focus", () =>
	{
		const anchor = NOW - 69 * MINUTE;
		const {result} = renderHook(() =>
			useStaleCompactIdle(
				{
					anchorMs: anchor,
					responding: false,
					hidden: false,
				},
			),
		);
		expect(result.current).toBeNull();
		advance(2 * MINUTE);
		expect(result.current).toBeNull();
		fire(window, new Event("focus"));
		expect(result.current).toStrictEqual(
			{
				anchor,
				ageMs: 71 * MINUTE,
			},
		);
	});

	it("re-checks on visibilitychange only when visible", () =>
	{
		const anchor = NOW - 69 * MINUTE;
		const {result} = renderHook(() =>
			useStaleCompactIdle(
				{
					anchorMs: anchor,
					responding: false,
					hidden: false,
				},
			),
		);
		advance(2 * MINUTE);
		visibility = "hidden";
		fire(document, new Event("visibilitychange"));
		expect(result.current).toBeNull();
		visibility = "visible";
		fire(document, new Event("visibilitychange"));
		expect(result.current).toStrictEqual(
			{
				anchor,
				ageMs: 71 * MINUTE,
			},
		);
	});

	it.each(["keydown", "focusin"])("re-checks on %s inside the session footer only", (type) =>
	{
		const anchor = NOW - 69 * MINUTE;
		const inside = footerInput();
		const outside = outsideInput();
		const {result} = renderHook(() =>
			useStaleCompactIdle(
				{
					anchorMs: anchor,
					responding: false,
					hidden: false,
				},
			),
		);
		advance(2 * MINUTE);
		fire(
			outside,
			new Event(
				type,
				{
					bubbles: true,
				},
			),
		);
		expect(result.current).toBeNull();
		fire(
			inside,
			new Event(
				type,
				{
					bubbles: true,
				},
			),
		);
		expect(result.current).toStrictEqual(
			{
				anchor,
				ageMs: 71 * MINUTE,
			},
		);
	});

	it("doesn't check while responding", () =>
	{
		const anchor = NOW - 69 * MINUTE;
		const {result} = renderHook(() =>
			useStaleCompactIdle(
				{
					anchorMs: anchor,
					responding: true,
					hidden: false,
				},
			),
		);
		advance(2 * MINUTE);
		fire(window, new Event("focus"));
		expect(result.current).toBeNull();
	});

	it("doesn't check while the scope is hidden, and checks when it shows", () =>
	{
		const anchor = NOW - 71 * MINUTE;
		const {result, rerender} = renderHook(
			({hidden}: {hidden: boolean}) =>
				useStaleCompactIdle(
					{
						anchorMs: anchor,
						responding: false,
						hidden,
					},
				),
			{
				initialProps:
				{
					hidden: true,
				},
			},
		);
		expect(result.current).toBeNull();
		rerender(
			{
				hidden: false,
			},
		);
		expect(result.current).toStrictEqual(
			{
				anchor,
				ageMs: 71 * MINUTE,
			},
		);
	});

	it("keeps the stored anchor when a new one arrives, so the old stretch no longer matches", () =>
	{
		const anchor = NOW - 71 * MINUTE;
		const {result, rerender} = renderHook(
			({anchorMs}: {anchorMs: number}) =>
				useStaleCompactIdle(
					{
						anchorMs,
						responding: false,
						hidden: false,
					},
				),
			{
				initialProps:
				{
					anchorMs: anchor,
				},
			},
		);
		rerender(
			{
				anchorMs: NOW,
			},
		);
		expect(result.current).toStrictEqual(
			{
				anchor,
				ageMs: 71 * MINUTE,
			},
		);
	});

	it("returns the identical object for a re-check in the same minute", () =>
	{
		const anchor = NOW - 71 * MINUTE;
		const {result} = renderHook(() =>
			useStaleCompactIdle(
				{
					anchorMs: anchor,
					responding: false,
					hidden: false,
				},
			),
		);
		const first = result.current;
		advance(20_000);
		fire(window, new Event("focus"));
		expect(result.current).toBe(first);
		advance(MINUTE);
		fire(window, new Event("focus"));
		expect(result.current).toStrictEqual(
			{
				anchor,
				ageMs: 72 * MINUTE + 20_000,
			},
		);
	});

	it("removes its four listeners on unmount", () =>
	{
		const windowRemove = vi.spyOn(window, "removeEventListener");
		const documentRemove = vi.spyOn(document, "removeEventListener");
		const {unmount} = renderHook(() =>
			useStaleCompactIdle(
				{
					anchorMs: NOW - 71 * MINUTE,
					responding: false,
					hidden: false,
				},
			),
		);
		unmount();
		expect(windowRemove.mock.calls.map(([type]) => type)).toContain("focus");
		expect(
			documentRemove.mock.calls.map(([type]) => type).filter((type) => type !== "selectionchange"),
		).toStrictEqual(expect.arrayContaining(["visibilitychange", "focusin", "keydown"]));
	});

	it("does nothing without an anchor", () =>
	{
		const {result} = renderHook(() =>
			useStaleCompactIdle(
				{
					anchorMs: null,
					responding: false,
					hidden: false,
				},
			),
		);
		fire(window, new Event("focus"));
		expect(result.current).toBeNull();
	});
});
