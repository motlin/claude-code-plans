// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {LABEL_HOLD_DEFAULT_MS, type HeldLabelOptions, useHeldLabel} from "../src/hooks/use-held-label";

interface Props<T>
{
	value: T;
	labelKey: string;
	opts: HeldLabelOptions<T>;
}

function mount<T>(initial: Props<T>)
{
	return renderHook(
		(props: Props<T>) => useHeldLabel(props.value, props.labelKey, props.opts),
		{
			initialProps: initial,
		},
	);
}

function advance(ms: number): void
{
	act(() =>
	{
		vi.advanceTimersByTime(ms);
	});
}

const ROW =
{
	minMs: 2000,
	settleMs: 250,
	restretch: true,
} as const;

describe("useHeldLabel (upstream shared-frame Ky)", () =>
{
	beforeEach(() =>
	{
		vi.useFakeTimers(
			{
				toFake: ["setTimeout", "clearTimeout", "performance"],
			},
		);
	});

	afterEach(() =>
	{
		cleanup();
		vi.useRealTimers();
	});

	it("uses upstream's 650ms default hold (e4)", () =>
	{
		expect(LABEL_HOLD_DEFAULT_MS).toBe(650);
	});

	it("waits only the settle for the first change after mount, then holds for minMs from shownAt", () =>
	{
		const {result, rerender} = mount<string>(
			{
				value: "A",
				labelKey: "a",
				opts: ROW,
			},
		);
		expect(result.current).toBe("A");

		rerender(
			{
				value: "B",
				labelKey: "b",
				opts: ROW,
			},
		);
		advance(249);
		expect(result.current).toBe("A");
		advance(1);
		expect(result.current).toBe("B");

		advance(150);
		rerender(
			{
				value: "C",
				labelKey: "c",
				opts: ROW,
			},
		);
		// B shown at 250: max(250 + 2000, 400 + 250) = 2250.
		advance(2249 - 400);
		expect(result.current).toBe("B");
		advance(1);
		expect(result.current).toBe("C");
	});

	it("swaps in the same render when minMs is 0, and the restretched value waits only the settle next", () =>
	{
		const minMs = (shown: string): number | undefined => (shown === "busy" ? 2000 : 0);
		const opts =
		{
			minMs,
			settleMs: 250,
			restretch: true,
		};
		const {result, rerender} = mount<string>(
			{
				value: "done",
				labelKey: "done",
				opts,
			},
		);

		rerender(
			{
				value: "busy",
				labelKey: "busy",
				opts,
			},
		);
		expect(result.current).toBe("busy");
		expect(vi.getTimerCount()).toBe(0);

		rerender(
			{
				value: "busy2",
				labelKey: "busy2",
				opts:
				{
					...opts,
					minMs: () => 0,
				},
			},
		);
		expect(result.current).toBe("busy2");

		const held =
		{
			...ROW,
		};
		rerender(
			{
				value: "busy3",
				labelKey: "busy3",
				opts: held,
			},
		);
		advance(249);
		expect(result.current).toBe("busy2");
		advance(1);
		expect(result.current).toBe("busy3");
	});

	it("waits only the settle when the line is unchanged, and the full minimum when it changes", () =>
	{
		const same =
		{
			...ROW,
			line: "x",
		};
		const {result, rerender} = mount<string>(
			{
				value: "A",
				labelKey: "a",
				opts: same,
			},
		);
		rerender(
			{
				value: "B",
				labelKey: "b",
				opts: same,
			},
		);
		advance(250);
		expect(result.current).toBe("B");

		rerender(
			{
				value: "C",
				labelKey: "c",
				opts: same,
			},
		);
		advance(249);
		expect(result.current).toBe("B");
		advance(1);
		expect(result.current).toBe("C");

		const other =
		{
			...ROW,
			line: "y",
		};
		rerender(
			{
				value: "D",
				labelKey: "d",
				opts: other,
			},
		);
		advance(1999);
		expect(result.current).toBe("C");
		advance(1);
		expect(result.current).toBe("D");
	});

	it("never shows a pending value when the key flips back before the timer fires", () =>
	{
		const {result, rerender} = mount<string>(
			{
				value: "A",
				labelKey: "a",
				opts: ROW,
			},
		);
		rerender(
			{
				value: "B",
				labelKey: "b",
				opts: ROW,
			},
		);
		advance(100);
		expect(result.current).toBe("A");
		rerender(
			{
				value: "A",
				labelKey: "a",
				opts: ROW,
			},
		);
		expect(result.current).toBe("A");
		advance(5000);
		expect(result.current).toBe("A");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("restarts the settle when the pending key changes but keeps the minimum from the shown value", () =>
	{
		const {result, rerender} = mount<string>(
			{
				value: "A",
				labelKey: "a",
				opts: ROW,
			},
		);
		rerender(
			{
				value: "B",
				labelKey: "b",
				opts: ROW,
			},
		);
		advance(200);
		rerender(
			{
				value: "C",
				labelKey: "c",
				opts: ROW,
			},
		);
		advance(249);
		expect(result.current).toBe("A");
		advance(1);
		expect(result.current).toBe("C");

		rerender(
			{
				value: "D",
				labelKey: "d",
				opts: ROW,
			},
		);
		advance(1900);
		rerender(
			{
				value: "E",
				labelKey: "e",
				opts: ROW,
			},
		);
		// C shown at 450: min ends at 2450, but E arrived at 2350 so its settle ends at 2600.
		advance(249);
		expect(result.current).toBe("C");
		advance(1);
		expect(result.current).toBe("E");
	});

	it("falls back to 650ms when minMs returns undefined", () =>
	{
		const opts =
		{
			minMs: (): number | undefined => undefined,
			settleMs: 0,
		};
		const {result, rerender} = mount<string>(
			{
				value: "A",
				labelKey: "a",
				opts,
			},
		);
		rerender(
			{
				value: "B",
				labelKey: "b",
				opts,
			},
		);
		expect(result.current).toBe("B");
		rerender(
			{
				value: "C",
				labelKey: "c",
				opts,
			},
		);
		advance(649);
		expect(result.current).toBe("B");
		advance(1);
		expect(result.current).toBe("C");
	});

	it("treats a bare number as minMs: the first change is immediate, the next waits shownAt + minMs", () =>
	{
		const {result, rerender} = mount<string>(
			{
				value: "A",
				labelKey: "a",
				opts: 650,
			},
		);
		rerender(
			{
				value: "B",
				labelKey: "b",
				opts: 650,
			},
		);
		expect(result.current).toBe("B");
		advance(100);
		rerender(
			{
				value: "C",
				labelKey: "c",
				opts: 650,
			},
		);
		advance(549);
		expect(result.current).toBe("B");
		advance(1);
		expect(result.current).toBe("C");
	});

	it("holds the newest same-key value while a new key is pending", () =>
	{
		type V =
		{
			k: string;
			n: number;
		};
		const first: V =
		{
			k: "a",
			n: 1,
		};
		const second: V =
		{
			k: "a",
			n: 2,
		};
		const next: V =
		{
			k: "b",
			n: 0,
		};
		const {result, rerender} = mount<V>(
			{
				value: first,
				labelKey: "a",
				opts: ROW,
			},
		);
		rerender(
			{
				value: second,
				labelKey: "a",
				opts: ROW,
			},
		);
		expect(result.current).toBe(second);
		rerender(
			{
				value: next,
				labelKey: "b",
				opts: ROW,
			},
		);
		expect(result.current).toBe(second);
		advance(250);
		expect(result.current).toBe(next);
	});

	it("clears its timer on unmount", () =>
	{
		const {rerender, unmount} = mount<string>(
			{
				value: "A",
				labelKey: "a",
				opts: ROW,
			},
		);
		rerender(
			{
				value: "B",
				labelKey: "b",
				opts: ROW,
			},
		);
		expect(vi.getTimerCount()).toBe(1);
		unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
});
