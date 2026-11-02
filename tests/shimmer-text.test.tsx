// @vitest-environment jsdom

import {act, cleanup, render, screen} from "@testing-library/react";
import {useRef} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {ShimmerText} from "../src/components/shimmer-text";
import {SHIMMER_PERIOD_MS, useTimelineShimmerDelay} from "../src/lib/shimmer";

const COMPOSITED_QUERY = "(-webkit-mask-clip: text) and (-webkit-app-region: drag)";

type StyleOverrides = (element: Element) => Record<string, string>;

/**
 * Chrome's composited path: `CSS.supports` passes upstream's query, a ResizeObserver reports
 * on observe, and `getComputedStyle` answers `display`/`-webkit-line-clamp` from `overrides`.
 */
function stubComposited(
	overrides: StyleOverrides = () => (
	{
		display: "block",
	}),
): void
{
	vi.spyOn(CSS, "supports").mockImplementation((query: string) => query === COMPOSITED_QUERY);
	class ImmediateResizeObserver
	{
		readonly #callback: ResizeObserverCallback;
		constructor(callback: ResizeObserverCallback)
		{
			this.#callback = callback;
		}
		observe(): void
		{
			this.#callback([], this);
		}
		unobserve(): void
		{
		}
		disconnect(): void
		{
		}
	}
	vi.stubGlobal("ResizeObserver", ImmediateResizeObserver);
	const real = window.getComputedStyle.bind(window);
	vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element) =>
	{
		const base = real(element);
		const over = overrides(element);
		return {
			display: over["display"] ?? base.display,
			getPropertyValue: (name: string) => over[name] ?? base.getPropertyValue(name),
		} as CSSStyleDeclaration;
	});
}

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("ShimmerText composited", () =>
{
	it("renders upstream's shimmering span with an aria-hidden, find-omitted, inert clone and no default dir", () =>
	{
		stubComposited();
		const {container} = render(<ShimmerText className="truncate min-w-0 text-body">Fetching docs</ShimmerText>);
		expect(container.innerHTML).toBe(
			'<span data-cds="ShimmerText" data-shimmering="true" class="relative truncate min-w-0 text-body">' +
				"Fetching docs" +
				'<span data-cds-shimmer-clone="" aria-hidden="true" data-find-omitted="" inert="">Fetching docs</span>' +
				"</span>",
		);
	});

	it("renders bare relative positioning when no className is given", () =>
	{
		stubComposited();
		const {container} = render(<ShimmerText>X</ShimmerText>);
		expect(container.innerHTML).toBe(
			'<span data-cds="ShimmerText" data-shimmering="true" class="relative">X' +
				'<span data-cds-shimmer-clone="" aria-hidden="true" data-find-omitted="" inert="">X</span></span>',
		);
	});

	it("exposes the text once to assistive technology", () =>
	{
		stubComposited();
		render(<ShimmerText>Stopping</ShimmerText>);
		const visible = screen.getAllByText("Stopping").filter((node) => node.closest("[inert]") === null);
		expect(visible.map((node) => node.getAttribute("data-cds"))).toStrictEqual(["ShimmerText"]);
	});

	it("marks every variant but default, which inks primary", () =>
	{
		stubComposited();
		const variants = (["default", "secondary", "muted", "strong"] as const).map((variant) =>
		{
			const {container} = render(<ShimmerText variant={variant}>x</ShimmerText>);
			const root = container.firstElementChild;
			return {
				variant: root?.getAttribute("data-variant") ?? null,
				shimmering: root?.getAttribute("data-shimmering") ?? null,
				clone: root?.querySelector("[data-cds-shimmer-clone]") !== null,
			};
		});
		expect(variants).toStrictEqual([
			{
				variant: null,
				shimmering: "true",
				clone: true,
			},
			{
				variant: "secondary",
				shimmering: "true",
				clone: true,
			},
			{
				variant: "muted",
				shimmering: "true",
				clone: true,
			},
			{
				variant: "strong",
				shimmering: "true",
				clone: true,
			},
		]);
	});

	it("phase-locks and pauses the clone band through upstream's custom properties", () =>
	{
		stubComposited();
		const {container} = render(
			<ShimmerText paused delay={-500}>
				X
			</ShimmerText>,
		);
		expect(container.firstElementChild?.getAttribute("style")).toBe(
			"--cds-shimmer-text-delay: -500ms; --cds-shimmer-text-play-state: paused;",
		);
	});

	it("passes a caller's dir through", () =>
	{
		stubComposited();
		const {container} = render(<ShimmerText dir="auto">X</ShimmerText>);
		expect(container.firstElementChild?.getAttribute("dir")).toBe("auto");
	});

	it("keeps the same clone element when the text changes, so the band does not jump", () =>
	{
		stubComposited();
		const {container, rerender} = render(<ShimmerText>Reading a</ShimmerText>);
		const clone = container.querySelector("[data-cds-shimmer-clone]");
		rerender(<ShimmerText>Reading b</ShimmerText>);
		expect(
			{
				same: container.querySelector("[data-cds-shimmer-clone]") === clone,
				text: clone?.textContent,
			},
		).toStrictEqual(
			{
				same: true,
				text: "Reading b",
			},
		);
	});

	it("copies the primary ink onto a strong label's clone under fizzy-lake type, unless the text has an emoji", () =>
	{
		stubComposited();
		const inks = ["Forked from Ship it", "Forked from Ship it 🚀"].map((text) =>
		{
			const {container} = render(<ShimmerText variant="strong">{text}</ShimmerText>);
			return container.firstElementChild?.getAttribute("data-cds-shimmer-copy-inks") ?? null;
		});
		expect(inks).toStrictEqual(["", null]);
	});

	it("never copies inks for the other variants", () =>
	{
		stubComposited();
		const {container} = render(<ShimmerText variant="secondary">Ship it</ShimmerText>);
		expect(container.firstElementChild?.hasAttribute("data-cds-shimmer-copy-inks")).toBe(false);
	});
});

describe("ShimmerText fallback", () =>
{
	it("sweeps a background-clip gradient on the span itself, with no clone, without composited support", () =>
	{
		const {container} = render(
			<ShimmerText variant="muted" paused delay={-500} className="truncate">
				X
			</ShimmerText>,
		);
		expect(container.innerHTML).toBe(
			'<span data-cds="ShimmerText" data-shimmering="true" data-variant="muted" data-shimmer-mode="fallback" class="truncate" style="animation-delay: -500ms; animation-play-state: paused;">X</span>',
		);
	});

	it("falls back for an inline span", () =>
	{
		stubComposited(() => (
		{
			display: "inline",
		}));
		const {container} = render(<ShimmerText>Reading</ShimmerText>);
		const root = container.firstElementChild;
		expect(
			{
				mode: root?.getAttribute("data-shimmer-mode") ?? null,
				clone: root?.querySelector("[data-cds-shimmer-clone]") !== null,
			},
		).toStrictEqual(
			{
				mode: "fallback",
				clone: false,
			},
		);
	});

	it("falls back inside a line-clamped box", () =>
	{
		stubComposited((element) =>
			element.tagName === "DIV"
				?
					{
						display: "block",
						"-webkit-line-clamp": "2",
					}
				:
					{
						display: "block",
					},
		);
		const {container} = render(
			<div>
				<ShimmerText>Reading</ShimmerText>
			</div>,
		);
		const root = container.querySelector("[data-cds=ShimmerText]");
		expect(
			{
				mode: root?.getAttribute("data-shimmer-mode") ?? null,
				clone: root?.querySelector("[data-cds-shimmer-clone]") !== null,
			},
		).toStrictEqual(
			{
				mode: "fallback",
				clone: false,
			},
		);
	});
});

describe("ShimmerText inactive", () =>
{
	it("stays mounted with only its className and no clone, positioning or style, as upstream's active:false", () =>
	{
		const {container} = render(
			<ShimmerText active={false} variant="muted" delay={-1500} className="shrink-0 text-secondary">
				Starting workflow
			</ShimmerText>,
		);
		expect(container.innerHTML).toBe(
			'<span data-cds="ShimmerText" data-shimmering="false" data-variant="muted" class="shrink-0 text-secondary">Starting workflow</span>',
		);
	});
});

describe("useTimelineShimmerDelay", () =>
{
	it("locks the delay to the running infinite animation's startTime once it is ready", async () =>
	{
		function Probe()
		{
			const ref = useRef<HTMLSpanElement>(null);
			const delay = useTimelineShimmerDelay(ref);
			return (
				<span ref={ref} data-delay={delay}>
					x
				</span>
			);
		}
		const animation =
		{
			startTime: 7250,
			ready: Promise.resolve(),
			effect:
			{
				getComputedTiming: () => (
				{
					iterations: Infinity,
				}),
			},
		};
		const getAnimations = vi.fn<(options: GetAnimationsOptions) => (typeof animation)[]>(() => [animation]);
		Object.defineProperty(
			HTMLElement.prototype,
			"getAnimations",
			{
				value: getAnimations,
				configurable: true,
			},
		);
		try
		{
			const {container} = render(<Probe />);
			await act(async () =>
			{
				await animation.ready;
			});
			expect(
				{
					delay: container.firstElementChild?.getAttribute("data-delay"),
					calls: getAnimations.mock.calls,
				},
			).toStrictEqual(
				{
					delay: "-1250",
					calls: [
						[
							{
								subtree: true,
							},
						],
					],
				},
			);
		}
		finally
		{
			Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
		}
	});

	it("sweeps on upstream's 3s period", () =>
	{
		expect(SHIMMER_PERIOD_MS).toBe(3000);
	});
});
