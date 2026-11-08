// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {Gauge} from "lucide-react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {NoticeBanner} from "../src/components/notice-banner";
import {DensityOverride, DensityScope} from "../src/components/ui/density";
import {FizzyLakeContext, type FizzyLakePart} from "../src/lib/fizzy-lake";
import {CompactScope, PanelsOff} from "./fizzy-lake-off";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const WITHOUT_COLOR: readonly FizzyLakePart[] = ["panels", "type"];

function metrics(wrap: (banner: ReactNode) => ReactNode, keyline?: "glyph" | "text") {
	const {container} = render(
		wrap(
			<NoticeBanner icon={<Gauge />} onDismiss={() => {}} {...(keyline === undefined ? {} : {keyline})}>
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
		scope: banner?.closest("[data-density]")?.getAttribute("data-density") ?? null,
	};
}

const LEAD = "flex items-start gap-xs";
const TYPE = "font-sans text-body font-normal break-words px-md rounded-composer";
const FIZZY_SURFACE = "bg-page shadow-card-ring text-primary [--card-ring-color:var(--banner-line)] @container";
const ICON_SLOT = "flex min-h-[1lh] shrink-0 items-center ms-[4px] -me-[4px]";
const BODY = "flex min-w-0 flex-wrap items-start gap-y-sm gap-x-md flex-1";
const GLYPH_BODY = `${BODY} ms-[6px] compact:ms-[6px] comfortable:ms-[4px]`;
const PANELS = {
	keyline: "glyph",
	root: `${LEAD} py-[calc(var(--cds-pad-md)+2px)] ${TYPE} ${FIZZY_SURFACE}`,
	iconSlot: `${ICON_SLOT} text-secondary`,
	body: GLYPH_BODY,
	dismissSlot: "-me-[2px] flex h-[1lh] shrink-0 items-center",
};
const BASE = {
	keyline: "glyph",
	root: `${LEAD} py-md ${TYPE} ${FIZZY_SURFACE}`,
	iconSlot: `${ICON_SLOT} text-secondary`,
	body: GLYPH_BODY,
	dismissSlot: "-me-[4px] flex h-[1lh] shrink-0 items-center",
};

describe("NoticeBanner composer keyline", () => {
	// Upstream's dock cards always pass composerCalibration (`rB()`), so `ah` takes its keyline branch:
	// px-md, rounded-composer, the icon and body offsets and the keyline Dismiss margins.
	it("takes upstream's panels keyline Banner under comfortable density: pad-md+2px block padding and the -2px Dismiss margin", () => {
		expect(metrics((banner): ReactNode => banner)).toStrictEqual({...PANELS, scope: null});
	});

	it("keeps py-md and the glyph -4px Dismiss margin in the compact column with panels off", () => {
		expect(metrics((banner) => <CompactScope>{banner}</CompactScope>)).toStrictEqual({...BASE, scope: "compact"});
	});

	it("keeps py-md and the glyph -4px Dismiss margin in a comfortable scope with panels off", () => {
		expect(
			metrics((banner) => (
				<PanelsOff>
					<DensityScope density="comfortable">{banner}</DensityScope>
				</PanelsOff>
			)),
		).toStrictEqual({...BASE, scope: "comfortable"});
	});

	it("takes the panels block padding at compact tokens when an override forces compact", () => {
		expect(
			metrics((banner) => (
				<DensityOverride density="compact">
					<DensityScope>{banner}</DensityScope>
				</DensityOverride>
			)),
		).toStrictEqual({...PANELS, scope: "compact"});
	});

	it("uses the text keyline's body offset and Dismiss margin for a composer with no leading item", () => {
		expect(metrics((banner) => <CompactScope>{banner}</CompactScope>, "text")).toStrictEqual({
			...BASE,
			keyline: "text",
			body: `${BODY} ms-[4px] compact:ms-[4px] comfortable:ms-[2px]`,
			dismissSlot: "-me-[2px] compact:-me-[2px] comfortable:-me-[4px] flex h-[1lh] shrink-0 items-center",
			scope: "compact",
		});
	});
});

describe("NoticeBanner neutral surface", () => {
	it("layers upstream's alpha-1 neutral tint over surface-1 and leaves the icon untinted with fizzy-lake color off", () => {
		expect(
			metrics((banner) => <FizzyLakeContext.Provider value={WITHOUT_COLOR}>{banner}</FizzyLakeContext.Provider>),
		).toStrictEqual({
			...PANELS,
			root: `${LEAD} py-[calc(var(--cds-pad-md)+2px)] ${TYPE} bg-surface-1 bg-[linear-gradient(var(--color-alpha-1)_0_0)] shadow-card-ring text-primary @container`,
			iconSlot: ICON_SLOT,
			scope: null,
		});
	});

	it("passes a test id through to the Banner root", () => {
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

const ACTION_BASE =
	"flex shrink-0 items-center gap-xs min-h-[var(--cds-h-control)] my-[calc((1lh-var(--cds-h-control))/2)] -ms-[2px]";
const IQ_GLYPH =
	"me-[calc(8px-var(--cds-pad-md))] compact:me-[calc(8px-var(--cds-pad-md))] comfortable:me-[calc(4px-var(--cds-pad-md))]";

function actionMetrics(banner: ReactNode) {
	const {container} = render(banner);
	const root = container.querySelector('[data-cds="Banner"]');
	const body = root?.querySelector(":scope > div");
	return {
		role: root?.getAttribute("role"),
		keyline: root?.getAttribute("data-composer-keyline") ?? null,
		ctaLayout: root?.getAttribute("data-cta-layout"),
		root: root?.className,
		iconSlot: root?.children[0]?.tagName === "SPAN" ? root.children[0].className : null,
		body: body?.className,
		bodyChildren: [...(body?.children ?? [])].map((child) => `${child.tagName.toLowerCase()}.${child.className}`),
	};
}

const textDiv = "div.max-w-full min-w-0 flex-auto";

describe("NoticeBanner action slot", () => {
	it("puts upstream's inline action span after the body text in the keyline card, beside a Dismiss", () => {
		expect(
			actionMetrics(
				<CompactScope>
					<NoticeBanner icon={<Gauge />} onDismiss={() => {}} action={<button type="button">A</button>}>
						Notice
					</NoticeBanner>
				</CompactScope>,
			),
		).toStrictEqual({
			role: "none",
			keyline: "glyph",
			ctaLayout: "inline",
			root: BASE.root,
			iconSlot: BASE.iconSlot,
			body: GLYPH_BODY,
			bodyChildren: [textDiv, `span.${ACTION_BASE}`],
		});
	});

	it("gives a keyline action with no Dismiss upstream's Iq end margin, and -2px under panels", () => {
		const withoutDismiss = (wrap: (banner: ReactNode) => ReactNode) =>
			actionMetrics(
				wrap(
					<NoticeBanner icon={<Gauge />} action={<button type="button">A</button>}>
						Notice
					</NoticeBanner>,
				),
			).bodyChildren[1];
		expect(withoutDismiss((banner) => <CompactScope>{banner}</CompactScope>)).toBe(
			`span.${ACTION_BASE} ${IQ_GLYPH}`,
		);
		expect(withoutDismiss((banner): ReactNode => banner)).toBe(`span.${ACTION_BASE} -me-[2px]`);
	});

	it("draws the uncalibrated Banner (px-lg, rounded-card, P9 action margin) with a role override", () => {
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
		).toStrictEqual({
			role: "status",
			keyline: null,
			ctaLayout: "inline",
			root: `${LEAD} py-md font-sans text-body font-normal break-words px-lg rounded-card ${FIZZY_SURFACE}`,
			iconSlot: "flex min-h-[1lh] shrink-0 items-center text-secondary",
			body: BODY,
			bodyChildren: [textDiv, `span.${ACTION_BASE} -me-[calc(var(--cds-pad-md)-2px)]`],
		});
	});

	it("takes upstream's panels !py-lg and b9 action margin on the uncalibrated Banner", () => {
		const metrics = actionMetrics(
			<NoticeBanner icon={<Gauge />} keyline={null} action={<button type="button">Try again</button>}>
				x
			</NoticeBanner>,
		);
		expect({root: metrics.root, action: metrics.bodyChildren[1]}).toStrictEqual({
			root: `${LEAD} !py-lg font-sans text-body font-normal break-words px-lg rounded-card ${FIZZY_SURFACE}`,
			action: `span.${ACTION_BASE} -me-[calc(var(--cds-pad-md)-6px)]`,
		});
	});
});

/** A ResizeObserver stub plus layout stubs: the action span sits `actionDrop` px below the text, the root is `width` wide. */
function stubLayout() {
	const layout = {actionDrop: 0, width: 600};
	const observers = new Set<() => void>();
	vi.stubGlobal(
		"ResizeObserver",
		class {
			readonly callback: () => void;
			constructor(callback: () => void) {
				this.callback = callback;
			}
			observe() {
				observers.add(this.callback);
			}
			disconnect() {
				observers.delete(this.callback);
			}
		},
	);
	vi.spyOn(window, "getComputedStyle").mockImplementation(
		() => ({lineHeight: "20px"}) as unknown as CSSStyleDeclaration,
	);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
		const top = this.tagName === "SPAN" ? layout.actionDrop : 0;
		return {top, bottom: top + 20, height: 20, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({})};
	});
	vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(() => layout.width);
	const resize = (next: Partial<typeof layout>) => {
		Object.assign(layout, next);
		act(() => {
			for (const callback of observers) callback();
		});
	};
	return {layout, resize};
}

describe("NoticeBanner CTA wrap measurement", () => {
	it("marks an uncalibrated card wrapped when the action drops more than half a line: pb-lg and a wrapping action", () => {
		const {layout} = stubLayout();
		layout.actionDrop = 30;
		const metrics = actionMetrics(
			<CompactScope>
				<NoticeBanner
					icon={<Gauge />}
					keyline={null}
					onDismiss={() => {}}
					action={<button type="button">A</button>}
				>
					Notice
				</NoticeBanner>
			</CompactScope>,
		);
		expect({ctaLayout: metrics.ctaLayout, root: metrics.root, action: metrics.bodyChildren[1]}).toStrictEqual({
			ctaLayout: "wrapped",
			root: `${LEAD} py-md font-sans text-body font-normal break-words px-lg pb-lg rounded-card ${FIZZY_SURFACE}`,
			action: "span.flex shrink-0 items-center gap-xs max-w-full flex-wrap",
		});
	});

	it("stays inline when the action sits within half a line of the text", () => {
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

	it("stacks a wrapped keyline card, hides its neutral icon, and un-stacks only past 64px of growth", () => {
		const {layout, resize} = stubLayout();
		layout.actionDrop = 30;
		const banner = (
			<CompactScope>
				<NoticeBanner icon={<Gauge />} onDismiss={() => {}} action={<button type="button">A</button>}>
					Notice
				</NoticeBanner>
			</CompactScope>
		);
		const {container} = render(banner);
		const read = () => {
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
		const stacked = {
			ctaLayout: "stacked",
			root: BASE.root,
			first: "DIV",
			body: "flex min-w-0 flex-wrap items-start gap-y-xs gap-x-md flex-1 ms-[6px] compact:ms-[6px] comfortable:ms-[4px]",
			action: "flex shrink-0 items-center gap-xs max-w-full flex-wrap basis-full -ms-[6px] compact:-ms-[6px] comfortable:-ms-[4px]",
		};
		expect(read()).toStrictEqual(stacked);
		resize({width: 640, actionDrop: 0});
		expect(read()).toStrictEqual(stacked);
		resize({width: 670, actionDrop: 0});
		expect(read()).toStrictEqual({
			ctaLayout: "inline",
			root: BASE.root,
			first: "SPAN",
			body: GLYPH_BODY,
			action: ACTION_BASE,
		});
	});

	it("adds the stacked panels top padding and body end margin when there is no Dismiss", () => {
		const {layout} = stubLayout();
		layout.actionDrop = 30;
		const metrics = actionMetrics(
			<NoticeBanner icon={<Gauge />} action={<button type="button">A</button>}>
				Notice
			</NoticeBanner>,
		);
		expect({root: metrics.root, body: metrics.body, action: metrics.bodyChildren[1]}).toStrictEqual({
			root: `${LEAD} py-[calc(var(--cds-pad-md)+2px)] font-sans text-body font-normal break-words px-md pt-[calc(var(--cds-pad-md)-2px)] rounded-composer ${FIZZY_SURFACE}`,
			body: "flex min-w-0 flex-wrap items-start gap-y-xs gap-x-md flex-1 me-[2px] ms-[6px] compact:ms-[6px] comfortable:ms-[4px]",
			action: "span.flex shrink-0 items-center gap-xs max-w-full flex-wrap basis-full -me-[2px]",
		});
	});
});
