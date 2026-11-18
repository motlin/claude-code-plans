// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {UsageBars} from "../src/components/usage-bars";
import {staggerIndexes, USAGE_BARS_CROSSFADE, USAGE_BARS_GROW, withinGrowWindow} from "../src/lib/usage-bars-grow";

interface FakeAnimation
{
	finish: ReturnType<typeof vi.fn<() => void>>;
}

let animate: ReturnType<typeof vi.fn<(keyframes: Keyframe[], options: KeyframeAnimationOptions) => FakeAnimation>>;
let now = 1000;

const EASE = "cubic-bezier(0.165, 0.84, 0.44, 1)";

beforeEach(() =>
{
	now = 1000;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	animate = vi.fn<(keyframes: Keyframe[], options: KeyframeAnimationOptions) => FakeAnimation>(() => (
	{
		finish: vi.fn<() => void>(),
	}));
	Object.defineProperty(
		Element.prototype,
		"animate",
		{
			configurable: true,
			writable: true,
			value: animate,
		},
	);
});

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	delete (Element.prototype as Partial<Element>).animate;
	document.documentElement.removeAttribute("data-reduce-motion");
	document.documentElement.removeAttribute("dir");
});

function Row({share = false}: {share?: boolean})
{
	return (
		<div role="meter" aria-valuenow={40}>
			<div data-usage-bar-fill="" />
			{share && <span data-usage-bar-fill="" data-share={10} />}
		</div>
	);
}

function bars(props: {settled?: boolean; enabled?: boolean; children: ReactNode})
{
	return (
		<UsageBars surface="popover" settled={props.settled ?? true} enabled={props.enabled ?? true}>
			{props.children}
		</UsageBars>
	);
}

async function flushObservers(): Promise<void>
{
	await act(async () =>
	{
		await Promise.resolve();
	});
}

function calls(): Array<
{
	transform: unknown;
	delay: unknown;
}>
{
	return animate.mock.calls.map(([keyframes, options]) => (
	{
		transform: keyframes[0]?.["transform"],
		delay: options.delay,
	}));
}

describe("UsageBars slide-in (upstream c37952aed, gate __gb__1500379757)", () =>
{
	it("ships the gate on locally and copies upstream's timings", () =>
	{
		expect(
			{
				enabled: USAGE_BARS_CROSSFADE,
				grow: USAGE_BARS_GROW,
			},
		).toStrictEqual(
			{
				enabled: true,
				grow:
				{
					durationMs: 450,
					staggerMs: 60,
					easing: EASE,
					firstPlayWindowMs: 10_000,
					afterFirstPlayWindowMs: 3_000,
				},
			},
		);
	});

	it("slides each meter in from fully hidden, 60ms apart, and marks the wrapper for the crossfade", () =>
	{
		const {container} = render(
			bars(
				{
					children: (
						<>
							<Row />
							<Row />
						</>
					),
				},
			),
		);
		expect(
			{
				crossfade: container.querySelector("[data-usage-bars]")?.getAttribute("data-usage-bars-crossfade"),
				keyframes: animate.mock.calls.map(([keyframes]) => keyframes),
				options: animate.mock.calls.map(([, options]) => options),
			},
		).toStrictEqual(
			{
				crossfade: "",
				keyframes: [
					[
						{
							offset: 0,
							transform: "translateX(-100%)",
						},
					],
					[
						{
							offset: 0,
							transform: "translateX(-100%)",
						},
					],
				],
				options: [
					{
						duration: 450,
						delay: 0,
						easing: EASE,
						fill: "backwards",
					},
					{
						duration: 450,
						delay: 60,
						easing: EASE,
						fill: "backwards",
					},
				],
			},
		);
	});

	it("moves a fill and its share overlay together", () =>
	{
		render(
			bars(
				{
					children: (
						<>
							<Row share />
							<Row />
						</>
					),
				},
			),
		);
		expect(calls()).toStrictEqual([
			{
				transform: "translateX(-100%)",
				delay: 0,
			},
			{
				transform: "translateX(-100%)",
				delay: 0,
			},
			{
				transform: "translateX(-100%)",
				delay: 60,
			},
		]);
	});

	it("slides in from the right in an RTL wrapper", () =>
	{
		vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string)
		{
			return selector === ":dir(rtl)";
		});
		render(
			bars(
				{
					children: <Row />,
				},
			),
		);
		expect(calls()).toStrictEqual([
			{
				transform: "translateX(100%)",
				delay: 0,
			},
		]);
	});

	it("falls back to LTR when :dir() throws", () =>
	{
		vi.spyOn(Element.prototype, "matches").mockImplementation(() =>
		{
			throw new SyntaxError(":dir");
		});
		render(
			bars(
				{
					children: <Row />,
				},
			),
		);
		expect(calls()).toStrictEqual([
			{
				transform: "translateX(-100%)",
				delay: 0,
			},
		]);
	});

	it("stays still and unmarked with the gate off", () =>
	{
		const {container} = render(
			bars(
				{
					enabled: false,
					children: <Row />,
				},
			),
		);
		expect(
			{
				crossfade: container.querySelector("[data-usage-bars]")?.hasAttribute("data-usage-bars-crossfade"),
				calls: calls(),
			},
		).toStrictEqual(
			{
				crossfade: false,
				calls: [],
			},
		);
	});

	it("never animates fills that rendered before the data settled, but does animate later rows", async () =>
	{
		const {rerender} = render(
			bars(
				{
					settled: false,
					children: <Row />,
				},
			),
		);
		rerender(
			bars(
				{
					settled: true,
					children: <Row />,
				},
			),
		);
		const beforeLateRow = calls();
		rerender(
			bars(
				{
					settled: true,
					children: (
						<>
							<Row />
							<Row />
						</>
					),
				},
			),
		);
		await flushObservers();
		expect(
			{
				beforeLateRow,
				after: calls(),
			},
		).toStrictEqual(
			{
				beforeLateRow: [],
				after: [
					{
						transform: "translateX(-100%)",
						delay: 0,
					},
				],
			},
		);
	});

	it("does nothing under reduced motion (Settings ▸ Motion or the OS)", () =>
	{
		document.documentElement.setAttribute("data-reduce-motion", "true");
		render(
			bars(
				{
					children: <Row />,
				},
			),
		);
		cleanup();
		document.documentElement.removeAttribute("data-reduce-motion");
		vi.stubGlobal("matchMedia", (query: string) => (
		{
			matches: query === "(prefers-reduced-motion: reduce)",
			media: query,
			onchange: null,
			addEventListener: () =>
			{
			},
			removeEventListener: () =>
			{
			},
			addListener: () =>
			{
			},
			removeListener: () =>
			{
			},
			dispatchEvent: () => false,
		}));
		render(
			bars(
				{
					children: <Row />,
				},
			),
		);
		expect(calls()).toStrictEqual([]);
	});

	it("finishes every running slide when reduced motion turns on mid-play", async () =>
	{
		render(
			bars(
				{
					children: (
						<>
							<Row />
							<Row />
						</>
					),
				},
			),
		);
		const animations = animate.mock.results.map((result) => result.value as FakeAnimation);
		document.documentElement.setAttribute("data-reduce-motion", "true");
		await flushObservers();
		expect(animations.map((animation) => animation.finish.mock.calls.length)).toStrictEqual([1, 1]);
	});

	it("stops picking up new rows 3s after the first slide", async () =>
	{
		const {rerender} = render(
			bars(
				{
					children: <Row />,
				},
			),
		);
		now += 3_001;
		rerender(
			bars(
				{
					children: (
						<>
							<Row />
							<Row />
						</>
					),
				},
			),
		);
		await flushObservers();
		expect(calls()).toStrictEqual([
			{
				transform: "translateX(-100%)",
				delay: 0,
			},
		]);
	});
});

describe("staggerIndexes", () =>
{
	it("gives each distinct parent the next index in first-seen order", () =>
	{
		const first = document.createElement("div");
		const second = document.createElement("div");
		const fills = [first, first, second, first].map((parent) => parent.appendChild(document.createElement("div")));
		expect(staggerIndexes(fills)).toStrictEqual([0, 0, 1, 0]);
	});
});

describe("withinGrowWindow", () =>
{
	it("allows 10s after the decision until the first slide, then 3s after it", () =>
	{
		expect([
			withinGrowWindow(
				{
					now: 11_000,
					decidedAt: 1_000,
					firstPlayedAt: null,
				},
			),
			withinGrowWindow(
				{
					now: 11_001,
					decidedAt: 1_000,
					firstPlayedAt: null,
				},
			),
			withinGrowWindow(
				{
					now: 5_000,
					decidedAt: 1_000,
					firstPlayedAt: 2_000,
				},
			),
			withinGrowWindow(
				{
					now: 5_001,
					decidedAt: 1_000,
					firstPlayedAt: 2_000,
				},
			),
		]).toStrictEqual([true, false, true, false]);
	});
});
