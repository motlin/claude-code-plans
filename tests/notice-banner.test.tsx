// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {Gauge} from "lucide-react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {NoticeBanner} from "../src/components/notice-banner";
import {DensityOverride, DensityScope} from "../src/components/ui/density";
import {FizzyLakeContext, type FizzyLakePart} from "../src/lib/fizzy-lake";
import {CompactScope, PanelsOff} from "./fizzy-lake-off";

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const WITHOUT_COLOR: readonly FizzyLakePart[] = ["panels", "type"];

function metrics(wrap: (banner: ReactNode) => ReactNode, keyline?: "glyph" | "text")
{
	const {container} = render(
		wrap(
			<NoticeBanner
				icon={<Gauge />}
				onDismiss={() =>
				{
				}}
				{...(keyline === undefined
					? {}
					:
						{
							keyline,
						})}
			>
				Notice
			</NoticeBanner>,
		),
	);
	const banner = container.querySelector('[data-cds="Banner"]');
	return {
		keyline: banner?.getAttribute("data-composer-keyline"),
		root: banner?.className,
		iconSlot: banner?.children[0]?.className,
		body: banner?.children[1]?.className,
		dismissSlot: banner?.lastElementChild?.className,
		dismiss: banner?.querySelector('button[aria-label="Dismiss"]')?.className,
		scope: banner?.closest("[data-density]")?.getAttribute("data-density") ?? null,
	};
}

const LEAD = "flex items-start gap-xs";
const TYPE = "font-sans text-body font-normal break-words px-md rounded-composer";
const FIZZY_SURFACE = "bg-page shadow-[inset_0_0_0_1px_var(--banner-line)] text-primary @container";
const ICON_SLOT = "flex min-h-[1lh] shrink-0 items-center ms-[4px] -me-[4px] text-secondary";
const BODY = "flex min-w-0 flex-wrap items-start gap-y-sm gap-x-md flex-1";
const GLYPH_BODY = `${BODY} ms-[4px]`;
const CARD =
{
	keyline: "glyph",
	root: `${LEAD} py-[calc(var(--cds-pad-md)+2px)] ${TYPE} ${FIZZY_SURFACE}`,
	iconSlot: ICON_SLOT,
	body: GLYPH_BODY,
	dismissSlot: "-me-[2px] flex h-[1lh] shrink-0 items-center",
	// Upstream's cds ghost iconOnly Button: control-high square, the cds radius, text-secondary ink.
	dismiss:
		"inline-flex h-control w-control aspect-square shrink-0 cursor-pointer items-center justify-center rounded-[var(--upstream-radius)] px-0 text-secondary transition-colors hover:bg-fill-ghost-hover stacks:hover:bg-fill-button-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus",
};

describe("NoticeBanner composer keyline", () =>
{
	// Upstream's dock cards always pass composerCalibration (`rB()`), so `ah` takes its keyline branch.
	// The current `ah` reads neither fizzy-lake panels, colour nor density: one card in every scope.
	it("draws upstream's one keyline card whatever the panels, colour and density", () =>
	{
		const wraps: Record<string, (banner: ReactNode) => ReactNode> =
		{
			default: (banner): ReactNode => banner,
			compactPanelsOff: (banner) => <CompactScope>{banner}</CompactScope>,
			comfortablePanelsOff: (banner) => (
				<PanelsOff>
					<DensityScope density="comfortable">{banner}</DensityScope>
				</PanelsOff>
			),
			compactOverride: (banner) => (
				<DensityOverride density="compact">
					<DensityScope>{banner}</DensityScope>
				</DensityOverride>
			),
			colorOff: (banner) => <FizzyLakeContext.Provider value={WITHOUT_COLOR}>{banner}</FizzyLakeContext.Provider>,
		};
		expect(Object.fromEntries(Object.entries(wraps).map(([name, wrap]) => [name, metrics(wrap)]))).toStrictEqual(
			{
				default:
				{
					...CARD,
					scope: null,
				},
				compactPanelsOff:
				{
					...CARD,
					scope: "compact",
				},
				comfortablePanelsOff:
				{
					...CARD,
					scope: "comfortable",
				},
				compactOverride:
				{
					...CARD,
					scope: "compact",
				},
				colorOff:
				{
					...CARD,
					scope: null,
				},
			},
		);
	});

	it("uses the text keyline's body offset for a composer with no leading item, panels off", () =>
	{
		expect(metrics((banner) => <CompactScope>{banner}</CompactScope>, "text")).toStrictEqual(
			{
				...CARD,
				keyline: "text",
				body: `${BODY} ms-[2px]`,
				scope: "compact",
			},
		);
	});

	it("passes a test id through to the Banner root", () =>
	{
		const {container} = render(
			<NoticeBanner icon={null} data-testid="usage-limit-reached-card">
				Notice
			</NoticeBanner>,
		);
		expect(container.querySelector('[data-cds="Banner"]')?.getAttribute("data-testid")).toBe(
			"usage-limit-reached-card",
		);
	});
});

const ACTION_BASE = "flex shrink-0 items-center gap-xs min-h-control my-[calc((1lh-var(--cds-h-control))/2)] ms-auto";
/* Upstream's wrapped/stacked action: its cds Buttons grow to wrap their label. */
const ACTION_CHILD_BUTTONS =
	"cds-child-Button:h-auto cds-child-Button:min-h-control cds-child-Button:shrink cds-child-Button:py-[calc((var(--cds-h-control)-1lh)/2)] cds-child-Button:text-balance cds-child-Button:wrap-anywhere cds-child-Button:whitespace-normal";
const WRAPPED_DISMISSIBLE_ACTION = `flex shrink-0 items-center gap-xs flex-wrap max-w-[calc(100%+var(--cds-h-control))] ${ACTION_CHILD_BUTTONS}`;

function actionMetrics(banner: ReactNode)
{
	const {container} = render(banner);
	const root = container.querySelector('[data-cds="Banner"]');
	const body = root?.querySelector(":scope > div");
	return {
		role: root?.getAttribute("role"),
		variant: root?.getAttribute("data-banner-variant"),
		parts: [...(root?.querySelectorAll("[data-cds-part]") ?? [])].map((part) => part.getAttribute("data-cds-part")),
		keyline: root?.getAttribute("data-composer-keyline") ?? null,
		ctaLayout: root?.getAttribute("data-cta-layout"),
		root: root?.className,
		iconSlot: root?.children[0]?.tagName === "SPAN" ? root.children[0].className : null,
		body: body?.className,
		bodyChildren: [...(body?.children ?? [])].map((child) => `${child.tagName.toLowerCase()}.${child.className}`),
	};
}

const textDiv = "div.max-w-full min-w-0 flex-auto";

describe("NoticeBanner action slot", () =>
{
	it("puts upstream's inline action span after the body text in the keyline card, beside a Dismiss", () =>
	{
		expect(
			actionMetrics(
				<CompactScope>
					<NoticeBanner
						icon={<Gauge />}
						onDismiss={() =>
						{
						}}
						action={<button type="button">A</button>}
					>
						Notice
					</NoticeBanner>
				</CompactScope>,
			),
		).toStrictEqual(
			{
				role: "none",
				variant: "neutral",
				parts: ["action", "dismiss"],
				keyline: "glyph",
				ctaLayout: "inline",
				root: CARD.root,
				iconSlot: CARD.iconSlot,
				body: GLYPH_BODY,
				bodyChildren: [textDiv, `span.${ACTION_BASE}`],
			},
		);
	});

	it("gives a keyline action with no Dismiss the -2px end margin, panels on or off", () =>
	{
		const withoutDismiss = (wrap: (banner: ReactNode) => ReactNode) =>
			actionMetrics(
				wrap(
					<NoticeBanner icon={<Gauge />} action={<button type="button">A</button>}>
						Notice
					</NoticeBanner>,
				),
			).bodyChildren[1];
		expect(withoutDismiss((banner) => <CompactScope>{banner}</CompactScope>)).toBe(`span.${ACTION_BASE} -me-[2px]`);
		expect(withoutDismiss((banner): ReactNode => banner)).toBe(`span.${ACTION_BASE} -me-[2px]`);
	});

	it("draws the uncalibrated Banner (px-lg, rounded-card, !py-lg, b9 action margin) with a role override, panels off", () =>
	{
		expect(
			actionMetrics(
				<CompactScope>
					<NoticeBanner
						icon={<Gauge />}
						keyline={null}
						role="status"
						action={<button type="button">Try again</button>}
					>
						Couldn’t load this.
					</NoticeBanner>
				</CompactScope>,
			),
		).toStrictEqual(
			{
				role: "status",
				variant: "neutral",
				parts: ["action"],
				keyline: null,
				ctaLayout: "inline",
				root: `${LEAD} !py-lg font-sans text-body font-normal break-words px-lg rounded-card ${FIZZY_SURFACE}`,
				iconSlot: "flex min-h-[1lh] shrink-0 items-center text-secondary",
				body: BODY,
				bodyChildren: [textDiv, `span.${ACTION_BASE} -me-[calc(var(--cds-pad-md)-6px)]`],
			},
		);
	});
});

/** A ResizeObserver stub plus layout stubs: the action span sits `actionDrop` px below the text, the root is `width` wide. */
function stubLayout()
{
	const layout =
	{
		actionDrop: 0,
		width: 600,
	};
	const observers = new Set<() => void>();
	vi.stubGlobal(
		"ResizeObserver",
		class
		{
			readonly callback: () => void;
			constructor(callback: () => void)
			{
				this.callback = callback;
			}
			observe()
			{
				observers.add(this.callback);
			}
			disconnect()
			{
				observers.delete(this.callback);
			}
		},
	);
	vi.spyOn(window, "getComputedStyle").mockImplementation(
		() =>
			(
			{
				lineHeight: "20px",
			}) as unknown as CSSStyleDeclaration,
	);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement)
	{
		const top = this.tagName === "SPAN" ? layout.actionDrop : 0;
		return {
			top,
			bottom: top + 20,
			height: 20,
			left: 0,
			right: 0,
			width: 0,
			x: 0,
			y: top,
			toJSON: () => ({}),
		};
	});
	vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(() => layout.width);
	const resize = (next: Partial<typeof layout>) =>
	{
		Object.assign(layout, next);
		act(() =>
		{
			for (const callback of observers) callback();
		});
	};
	return {
		layout,
		resize,
	};
}

describe("NoticeBanner CTA wrap measurement", () =>
{
	it("marks an uncalibrated card wrapped when the action drops more than half a line: pb-lg and a wrapping action", () =>
	{
		const {layout} = stubLayout();
		layout.actionDrop = 30;
		const metrics = actionMetrics(
			<CompactScope>
				<NoticeBanner
					icon={<Gauge />}
					keyline={null}
					onDismiss={() =>
					{
					}}
					action={<button type="button">A</button>}
				>
					Notice
				</NoticeBanner>
			</CompactScope>,
		);
		expect(
			{
				ctaLayout: metrics.ctaLayout,
				root: metrics.root,
				action: metrics.bodyChildren[1],
			},
		).toStrictEqual(
			{
				ctaLayout: "wrapped",
				root: `${LEAD} !py-lg font-sans text-body font-normal break-words px-lg pb-lg rounded-card ${FIZZY_SURFACE}`,
				action: `span.${WRAPPED_DISMISSIBLE_ACTION}`,
			},
		);
	});

	it("stays inline when the action sits within half a line of the text", () =>
	{
		const {layout} = stubLayout();
		layout.actionDrop = 8;
		expect(
			actionMetrics(
				<NoticeBanner icon={<Gauge />} keyline={null} action={<button type="button">A</button>}>
					Notice
				</NoticeBanner>,
			).ctaLayout,
		).toBe("inline");
	});

	it("stacks a wrapped keyline card, keeps its passed icon, and re-measures whenever it outgrows its widest stacking width", () =>
	{
		const {layout, resize} = stubLayout();
		layout.actionDrop = 30;
		const banner = (
			<CompactScope>
				<NoticeBanner
					icon={<Gauge />}
					onDismiss={() =>
					{
					}}
					action={<button type="button">A</button>}
				>
					Notice
				</NoticeBanner>
			</CompactScope>
		);
		const {container} = render(banner);
		const read = () =>
		{
			const root = container.querySelector('[data-cds="Banner"]');
			const body = root?.querySelector(":scope > div");
			return {
				ctaLayout: root?.getAttribute("data-cta-layout"),
				root: root?.className,
				first: root?.children[0]?.tagName,
				body: body?.className,
				action: body?.children[1]?.className,
			};
		};
		const stacked =
		{
			ctaLayout: "stacked",
			root: CARD.root,
			first: "SPAN",
			body: "flex min-w-0 flex-wrap items-start gap-y-xs gap-x-md flex-1 ms-[4px]",
			action: `${WRAPPED_DISMISSIBLE_ACTION} basis-full`,
		};
		expect(read()).toStrictEqual(stacked);
		// Not wider than the stacking width: no re-measure, even though the action would now fit.
		resize(
			{
				width: 600,
				actionDrop: 0,
			},
		);
		expect(read()).toStrictEqual(stacked);
		// Wider: re-measure, still wraps, so it stays stacked and records the new width.
		resize(
			{
				width: 620,
				actionDrop: 30,
			},
		);
		expect(read()).toStrictEqual(stacked);
		resize(
			{
				width: 620,
				actionDrop: 0,
			},
		);
		expect(read()).toStrictEqual(stacked);
		resize(
			{
				width: 621,
				actionDrop: 0,
			},
		);
		expect(read()).toStrictEqual(
			{
				ctaLayout: "inline",
				root: CARD.root,
				first: "SPAN",
				body: GLYPH_BODY,
				action: ACTION_BASE,
			},
		);
	});

	it("adds the stacked panels top padding and body end margin when there is no Dismiss", () =>
	{
		const {layout} = stubLayout();
		layout.actionDrop = 30;
		const metrics = actionMetrics(
			<NoticeBanner icon={<Gauge />} action={<button type="button">A</button>}>
				Notice
			</NoticeBanner>,
		);
		expect(
			{
				root: metrics.root,
				body: metrics.body,
				action: metrics.bodyChildren[1],
			},
		).toStrictEqual(
			{
				root: `${LEAD} py-[calc(var(--cds-pad-md)+2px)] font-sans text-body font-normal break-words px-md pt-[calc(var(--cds-pad-md)-2px)] rounded-composer ${FIZZY_SURFACE}`,
				body: "flex min-w-0 flex-wrap items-start gap-y-xs gap-x-md flex-1 me-[2px] ms-[4px]",
				action: `span.flex shrink-0 items-center gap-xs flex-wrap max-w-full ${ACTION_CHILD_BUTTONS} basis-full -me-[2px]`,
			},
		);
	});
});
