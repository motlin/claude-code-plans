// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {useIsOverflowing} from "../src/hooks/use-is-overflowing";

const callbacks: ResizeObserverCallback[] = [];
const observed: Element[] = [];
let disconnects = 0;

class CapturingResizeObserver
{
	constructor(callback: ResizeObserverCallback)
	{
		callbacks.push(callback);
	}
	observe(target: Element)
	{
		observed.push(target);
	}
	unobserve()
	{
	}
	disconnect()
	{
		disconnects += 1;
	}
	takeRecords()
	{
		return [];
	}
}

beforeEach(() =>
{
	callbacks.length = 0;
	observed.length = 0;
	disconnects = 0;
	vi.stubGlobal("ResizeObserver", CapturingResizeObserver);
});

afterEach(() =>
{
	vi.unstubAllGlobals();
	Reflect.deleteProperty(document, "fonts");
});

function probe(widths: {scroll: number; client: number})
{
	const element = document.createElement("div");
	Object.defineProperty(
		element,
		"scrollWidth",
		{
			get: () => widths.scroll,
		},
	);
	Object.defineProperty(
		element,
		"clientWidth",
		{
			get: () => widths.client,
		},
	);
	return element;
}

describe("useIsOverflowing", () =>
{
	it("reports overflow only once scrollWidth passes clientWidth plus the slack", () =>
	{
		const results = [
			[232, 231, 0],
			[231, 231, 0],
			[232, 231, 1],
		].map(
			([scroll = 0, client = 0, slack = 0]) =>
				renderHook(() =>
					useIsOverflowing(
						probe(
							{
								scroll,
								client,
							},
						),
						"full",
						slack,
					),
				).result.current,
		);

		expect(results).toStrictEqual([true, false, false]);
	});

	it("re-measures on resize, once fonts are ready, and when the text changes, then disconnects on unmount", async () =>
	{
		let resolveFonts: (fonts: FontFaceSet) => void = () =>
		{
		};
		const ready = new Promise<FontFaceSet>((resolve) =>
		{
			resolveFonts = resolve;
		});
		Object.defineProperty(
			document,
			"fonts",
			{
				configurable: true,
				value:
				{
					ready,
				},
			},
		);
		const widths =
		{
			scroll: 200,
			client: 231,
		};
		const element = probe(widths);
		const {result, rerender, unmount} = renderHook(
			({text}) => useIsOverflowing(element, text),
			{
				initialProps:
				{
					text: "full",
				},
			},
		);
		const seen = [result.current];

		widths.scroll = 240;
		act(() =>
		{
			callbacks.at(-1)?.([], {} as ResizeObserver);
		});
		seen.push(result.current);

		widths.scroll = 100;
		await act(async () =>
		{
			resolveFonts({} as FontFaceSet);
			await ready;
		});
		seen.push(result.current);

		widths.scroll = 300;
		rerender(
			{
				text: "longer full",
			},
		);
		seen.push(result.current);
		unmount();

		expect(
			{
				seen,
				observedProbe: observed.every((target) => target === element),
				disconnects,
			},
		).toStrictEqual(
			{
				seen: [false, true, false, true],
				observedProbe: true,
				disconnects: 2,
			},
		);
	});

	it("keeps its last answer while frozen and measures again once it thaws", () =>
	{
		const widths =
		{
			scroll: 300,
			client: 231,
		};
		const element = probe(widths);
		const {result, rerender} = renderHook(
			({frozen}) => useIsOverflowing(element, "full", 0, frozen),
			{
				initialProps:
				{
					frozen: false,
				},
			},
		);
		const seen = [result.current];

		widths.scroll = 100;
		rerender(
			{
				frozen: true,
			},
		);
		act(() =>
		{
			callbacks.at(-1)?.([], {} as ResizeObserver);
		});
		seen.push(result.current);

		rerender(
			{
				frozen: false,
			},
		);
		seen.push(result.current);

		expect(seen).toStrictEqual([true, true, false]);
	});
});
