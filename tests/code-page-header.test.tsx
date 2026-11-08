// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {CodePageHeader} from "../src/components/code-page-header";
import {resetPinnedHeightCache} from "../src/components/page-header-pinned-height";
import {PanelsOff} from "./fizzy-lake-off";

afterEach(cleanup);

describe("CodePageHeader", () => {
	it("sets upstream's compact 24/32 serif title over a tab row that carries the toolbar on its right", () => {
		render(
			<CodePageHeader
				title="Artifacts"
				tabs={<div role="tablist" aria-label="Views" />}
				toolbar={<button type="button">Search</button>}
			/>,
		);
		const title = screen.getByRole("heading", {level: 1, name: "Artifacts"});
		const tabs = screen.getByRole("tablist", {name: "Views"});
		const toolbar = screen.getByRole("button", {name: "Search"});
		expect({
			title: title.className
				.split(" ")
				.filter((name) => ["font-voice", "text-[24px]/[32px]", "font-medium"].includes(name)),
			sameRow: tabs.parentElement?.parentElement === toolbar.parentElement?.parentElement,
			toolbarRight: toolbar.parentElement?.className.split(" ").includes("ms-auto"),
		}).toStrictEqual({
			title: ["font-voice", "text-[24px]/[32px]", "font-medium"],
			sameRow: true,
			toolbarRight: true,
		});
	});

	it("pulls the title up only from sm, so at phone width it starts at the 48px band below the sidebar trigger", () => {
		render(<CodePageHeader title="Projects" />);
		expect(screen.getByRole("heading", {level: 1, name: "Projects"}).closest("header")?.className).toBe(
			"@container flex flex-col pb-4 sm:-mt-1",
		);
	});

	it("marks upstream's PageHeader parts under panels: a page-title-motion block around the title row, and a tabs-row whose margins carry the shift vars (cf35aed38)", () => {
		render(
			<CodePageHeader
				title="Artifacts"
				tabs={<div role="tablist" aria-label="Views" />}
				toolbar={<button type="button">Search</button>}
			/>,
		);
		const title = screen.getByRole("heading", {level: 1, name: "Artifacts"});
		const tabsRow = screen.getByRole("tablist", {name: "Views"}).parentElement;
		const controls = screen.getByRole("button", {name: "Search"}).parentElement;
		const header = title.closest("header");
		expect({
			band: {cds: header?.getAttribute("data-cds"), band: header?.getAttribute("data-band")},
			parts: {
				titleRow: title.parentElement?.getAttribute("data-cds-part"),
				titleMotion: title.parentElement?.parentElement?.getAttribute("data-cds-part"),
				tabsRow: tabsRow?.getAttribute("data-cds-part"),
				controlsSibling: tabsRow?.nextElementSibling === controls,
			},
			classes: {
				titleRow: title.parentElement?.getAttribute("class"),
				titleMotion: title.parentElement?.parentElement?.className,
				tabsRow: tabsRow?.className,
				row: tabsRow?.parentElement?.className,
			},
		}).toStrictEqual({
			band: {cds: "PageHeader", band: "tall"},
			parts: {
				titleRow: "title-row",
				titleMotion: "page-title-motion",
				tabsRow: "tabs-row",
				controlsSibling: true,
			},
			classes: {
				titleRow: null,
				titleMotion:
					"flex min-w-0 flex-col basis-full origin-left opacity-[var(--cds-page-header-title-opacity,1)] transition-opacity duration-150 rtl:origin-right",
				tabsRow:
					"flex min-w-0 items-center ms-[var(--cds-page-header-tabs-shift-start,0px)] me-[var(--cds-page-header-tabs-shift-end,0px)]",
				row: "mt-4 md:mt-6 flex flex-wrap items-center gap-x-4 gap-y-2",
			},
		});
	});

	it("keeps the static header without panels: no motion block, no tabs-row, no shift classes", () => {
		const {container} = render(
			<PanelsOff>
				<CodePageHeader
					title="Artifacts"
					tabs={<div role="tablist" aria-label="Views" />}
					toolbar={<button type="button">Search</button>}
				/>
			</PanelsOff>,
		);
		const title = screen.getByRole("heading", {level: 1, name: "Artifacts"});
		expect({
			titleParent: title.parentElement?.tagName,
			tabsParent: screen.getByRole("tablist", {name: "Views"}).parentElement?.className,
			parts: [...container.querySelectorAll("[data-cds-part]")].map((el) => el.getAttribute("data-cds-part")),
		}).toStrictEqual({
			titleParent: "HEADER",
			tabsParent: "mt-5 flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2",
			parts: ["controls"],
		});
	});
});

describe("CodePageHeader sticky", () => {
	let observed: {callback: IntersectionObserverCallback; targets: Element[]; disconnected: boolean}[] = [];
	class TestIntersectionObserver {
		readonly record: (typeof observed)[number];
		constructor(callback: IntersectionObserverCallback) {
			this.record = {callback, targets: [], disconnected: false};
			observed.push(this.record);
		}
		observe(target: Element): void {
			this.record.targets.push(target);
		}
		disconnect(): void {
			this.record.disconnected = true;
		}
	}
	beforeEach(() => {
		observed = [];
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("pins upstream's sticky band over a content box and draws upstream's 1px panels line only once the stuck-mark scrolls away", () => {
		const {container} = render(
			<CodePageHeader title="Artifacts" sticky={{box: "mx-auto w-full max-w-5xl px-2 md:px-8"}} />,
		);
		const header = screen.getByRole("heading", {level: 1, name: "Artifacts"}).closest("header");
		const box = header?.parentElement;
		const band = box?.parentElement;
		const line = container.querySelector('[data-cds-part="line"]');
		const [sentinel, stuckMark, levelMark] = [...container.children];
		const scrolled = (target: Element | undefined, isIntersecting: boolean) => {
			act(() => {
				observed[0]?.callback(
					[{target, isIntersecting} as unknown as IntersectionObserverEntry],
					{} as IntersectionObserver,
				);
			});
			return line?.className.endsWith(" opacity-100");
		};
		expect({
			header: header?.className,
			box: box?.className,
			band: band?.className,
			bandZ: band instanceof HTMLElement ? band.style.zIndex : null,
			bandTop: band instanceof HTMLElement ? band.style.top : null,
			sentinel: sentinel?.className,
			marks: [stuckMark, levelMark].map((mark) => ({
				part: mark?.getAttribute("data-cds-part"),
				cls: mark?.className,
				style: mark?.getAttribute("style"),
			})),
			observes: observed.map((record) => record.targets.map((target) => target.getAttribute("data-cds-part"))),
			lineParent: line?.parentElement === band,
			atRest: line?.className,
			titleGone: scrolled(sentinel, false),
			stuck: scrolled(stuckMark, false),
			backAtTop: scrolled(stuckMark, true),
		}).toStrictEqual({
			header: "@container flex flex-col sm:-mt-1",
			// The sentinel (so the band) rises over RootTopRow's 36px (48px phone) spacer and pads it back, so the pinned band keeps
			// upstream's whitespace above the title (its 64px title row) instead of pinning the title flush at the top.
			box: "mx-auto w-full max-w-5xl px-2 md:px-8 pt-9 max-sm:pt-12 pb-6",
			band: "sticky top-0",
			bandZ: "20",
			bandTop: "",
			sentinel: "h-0 -mt-9 max-sm:-mt-12",
			marks: [
				{part: "stuck-mark", cls: "pointer-events-none shrink-0", style: "height: 0px; margin-bottom: 0px;"},
				{
					part: "level-mark",
					cls: "pointer-events-none max-w-full shrink-0",
					style: "height: 0px; margin-bottom: 0px; width: max(0px, var(--cds-page-header-start-clearance, 0px));",
				},
			],
			observes: [["stuck-mark", "level-mark", null]],
			lineParent: true,
			atRest: "pointer-events-none absolute inset-x-0 bottom-0 border-b border-[color:var(--color-border-line)] transition-[opacity,visibility] invisible opacity-0",
			// The h-0 sentinel leaving is titleGone, not stuck: the line waits for the stuck-mark.
			titleGone: false,
			stuck: true,
			backAtTop: false,
		});
	});

	it("frosts the band under panels: no bg-page, an aria-hidden page-header-ground between the box and the line (upstream c193cfc9b)", () => {
		render(<CodePageHeader title="Artifacts" sticky={{box: "max-w-5xl"}} />);
		const band = screen.getByRole("heading", {level: 1, name: "Artifacts"}).closest(".sticky");
		expect({
			bandClass: band?.className,
			children: [...(band?.children ?? [])].map((child) => ({
				part: child.getAttribute("data-cds-part"),
				hidden: child.getAttribute("aria-hidden"),
				cls: child.getAttribute("class"),
			})),
		}).toStrictEqual({
			bandClass: "sticky top-0",
			children: [
				{part: null, hidden: null, cls: "max-w-5xl pt-9 max-sm:pt-12 pb-6"},
				{part: "page-header-ground", hidden: "true", cls: null},
				{
					part: "line",
					hidden: "true",
					cls: "pointer-events-none absolute inset-x-0 bottom-0 border-b border-[color:var(--color-border-line)] transition-[opacity,visibility] invisible opacity-0",
				},
			],
		});
	});

	it("keeps the opaque bg-page band with no ground without panels", () => {
		const {container} = render(
			<PanelsOff>
				<CodePageHeader title="Artifacts" sticky={{box: "max-w-5xl"}} />
			</PanelsOff>,
		);
		expect({
			bandClass: screen.getByRole("heading", {level: 1, name: "Artifacts"}).closest(".sticky")?.className,
			grounds: container.querySelectorAll('[data-cds-part="page-header-ground"]').length,
		}).toStrictEqual({bandClass: "sticky top-0 bg-page", grounds: 0});
	});

	it("keeps the pre-rollout page-fade-t strip without panels (upstream c193cfc9b cds Page data-cds-part=fade)", () => {
		const {container} = render(
			<PanelsOff>
				<CodePageHeader title="Artifacts" sticky={{box: "mx-auto w-full max-w-5xl px-2 md:px-8"}} />
			</PanelsOff>,
		);
		const header = screen.getByRole("heading", {level: 1, name: "Artifacts"}).closest("header");
		const box = header?.parentElement;
		const band = box?.parentElement;
		const fade = container.querySelector('[data-cds-part="fade"]');
		const sentinel = band?.previousElementSibling;
		const scrolled = (isIntersecting: boolean) => {
			act(() => {
				observed[0]?.callback([{isIntersecting} as IntersectionObserverEntry], {} as IntersectionObserver);
			});
			return fade?.className;
		};
		expect({
			header: header?.className,
			box: box?.className,
			band: band?.className,
			bandZ: band instanceof HTMLElement ? band.style.zIndex : null,
			sentinel: sentinel?.className,
			observes: observed.map((record) => record.targets.map((target) => target === sentinel)),
			fadeParent: fade?.parentElement === band,
			fadeHidden: fade?.getAttribute("aria-hidden"),
			atRest: fade?.className,
			afterScroll: scrolled(false),
			backAtTop: scrolled(true),
		}).toStrictEqual({
			header: "@container flex flex-col sm:-mt-1",
			// The sentinel (so the band) rises over RootTopRow's 36px (48px phone) spacer and pads it back, so the pinned band keeps
			// upstream's whitespace above the title (its 64px title row) instead of pinning the title flush at the top.
			box: "mx-auto w-full max-w-5xl px-2 md:px-8 pt-9 max-sm:pt-12 pb-6",
			band: "sticky top-0 bg-page",
			bandZ: "20",
			sentinel: "h-0 -mt-9 max-sm:-mt-12",
			observes: [[true]],
			fadeParent: true,
			fadeHidden: "true",
			atRest: "page-fade-t absolute inset-x-0 -bottom-8 h-8 transition-[opacity,visibility] invisible opacity-0",
			afterScroll:
				"page-fade-t absolute inset-x-0 -bottom-8 h-8 transition-[opacity,visibility] visible opacity-100",
			backAtTop:
				"page-fade-t absolute inset-x-0 -bottom-8 h-8 transition-[opacity,visibility] invisible opacity-0",
		});
	});
});

describe("CodePageHeader sticky geometry (upstream c193cfc9b Page + pe)", () => {
	type Geometry = {
		desktop: boolean;
		headerLeft: number;
		reduced?: boolean;
		scrollTimeline?: boolean;
		rtl?: boolean;
		/** Upstream's live 2026-11-07 geometry instead: a 124px band whose tabs and controls rows are 28px tall. */
		upstream?: boolean;
	};
	let observed: {callback: IntersectionObserverCallback; targets: Element[]}[] = [];
	class TestIntersectionObserver {
		readonly record: (typeof observed)[number];
		constructor(callback: IntersectionObserverCallback) {
			this.record = {callback, targets: []};
			observed.push(this.record);
		}
		observe(target: Element): void {
			this.record.targets.push(target);
		}
		disconnect(): void {}
	}
	class TestResizeObserver {
		observe(): void {}
		disconnect(): void {}
	}
	const part = (el: Element) => el.getAttribute("data-cds-part");
	const rect = (top: number, left: number, width: number, height: number) =>
		({top, left, width, height, right: left + width, bottom: top + height, x: left, y: top}) as DOMRect;

	/**
	 * Band at y0 140px tall and 900px wide, title above a tabs row at y88 (32px tall, 300px wide) beside the controls at
	 * y88; the level-mark resolves the collapsed clearance to 44px; the PageHeader starts at `headerLeft`. So L = 88-8 =
	 * 80, V = 80+8-(32+16) = 40, and R = 44-headerLeft.
	 */
	function stubGeometry(geometry: Geometry): void {
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
		vi.stubGlobal("ResizeObserver", TestResizeObserver);
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches:
				query === "(min-width: 48rem)"
					? geometry.desktop
					: query === "(prefers-reduced-motion: reduce)" && geometry.reduced === true,
			addEventListener: () => {},
			removeEventListener: () => {},
		}));
		vi.spyOn(CSS, "supports").mockImplementation(
			(query: string) => query === "animation-timeline: scroll()" && geometry.scrollTimeline !== false,
		);
		const rowHeight = geometry.upstream === true ? 28 : 32;
		const bandHeight = geometry.upstream === true ? 124 : 140;
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
			if (part(this) === "tabs-row") return rect(88, geometry.headerLeft, 300, rowHeight);
			if (part(this) === "controls") return rect(88, 700, 100, rowHeight);
			if (this.getAttribute("data-cds") === "PageHeader") {
				return geometry.rtl === true
					? rect(0, 1000 - geometry.headerLeft - 800, 800, 140)
					: rect(0, geometry.headerLeft, 800, 140);
			}
			return rect(0, 0, 900, 140);
		});
		vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
			return this.classList.contains("sticky") ? bandHeight : 0;
		});
		vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
			if (part(this) === "level-mark") return 44;
			return this.classList.contains("sticky") ? 900 : 0;
		});
		vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
		if (geometry.rtl === true) document.documentElement.setAttribute("dir", "rtl");
	}

	beforeEach(() => {
		observed = [];
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		document.documentElement.removeAttribute("dir");
		resetPinnedHeightCache();
	});

	function renderArtifacts(onTitleTravel?: (px: number) => void) {
		const view = render(
			<div data-cds="Page">
				<CodePageHeader
					title="Artifacts"
					subtitle={<button type="button">Count</button>}
					sticky={{box: "max-w-5xl", ...(onTitleTravel === undefined ? {} : {onTitleTravel})}}
					tabs={
						<div data-cds="Tabs" data-orientation="horizontal">
							<div role="tablist" aria-label="Views" />
						</div>
					}
					toolbar={<button type="button">Search</button>}
				/>
			</div>,
		);
		const page = view.container.firstElementChild as HTMLElement;
		const [sentinel, stuckMark, levelMark] = [...page.children];
		const band = page.querySelector<HTMLElement>(":scope > .sticky");
		if (band === null) throw new Error("no sticky band");
		const fire = (target: Element | undefined, isIntersecting: boolean) => {
			act(() => {
				observed[0]?.callback(
					[{target, isIntersecting} as unknown as IntersectionObserverEntry],
					{} as IntersectionObserver,
				);
			});
		};
		return {...view, page, sentinel, stuckMark, levelMark, band, fire};
	}

	const MOTION_VARS = [
		"--cds-page-header-title-opacity",
		"--cds-page-header-tabs-shift-start",
		"--cds-page-header-tabs-shift-end",
		"--cds-page-header-tabs-pull",
		"--cds-page-header-tabs-travel",
	];
	function motion(band: HTMLElement) {
		return {
			attrs: ["data-cds-title-leaves", "data-cds-tabs-arrive", "data-cds-row-level"].filter((name) =>
				band.hasAttribute(name),
			),
			vars: Object.fromEntries(
				MOTION_VARS.flatMap((name) => {
					const value = band.style.getPropertyValue(name);
					return value === "" ? [] : [[name, value]];
				}),
			),
		};
	}

	it("on desktop pins only the tabs row: top:-L, an L-tall stuck-mark, pb-2, and the page's pinned height and scroll offset", () => {
		stubGeometry({desktop: true, headerLeft: 60});
		const travels: number[] = [];
		const {page, stuckMark, levelMark, band} = renderArtifacts((px) => travels.push(px));
		expect({
			bandTop: band.style.top,
			stuckMark: stuckMark?.getAttribute("style"),
			levelMark:
				levelMark instanceof HTMLElement
					? {
							height: levelMark.style.height,
							marginBottom: levelMark.style.marginBottom,
							width: levelMark.style.width,
						}
					: null,
			box: band.firstElementChild?.className,
			pinned: page.style.getPropertyValue("--cds-page-header-pinned-height"),
			offset: page.style.getPropertyValue("--cds-page-header-scroll-offset"),
			travel: travels.at(-1),
			motion: motion(band),
		}).toStrictEqual({
			bandTop: "-80px",
			stuckMark: "height: 80px; margin-bottom: -80px;",
			levelMark: {
				height: "40px",
				marginBottom: "-40px",
				width: "max(0px, var(--cds-page-header-start-clearance, 0px))",
			},
			box: "max-w-5xl pt-9 max-sm:pt-12 md:pt-0 pb-6 md:pb-2",
			pinned: "60px",
			offset: "76px",
			travel: 80,
			// Docked (the PageHeader starts past the 44px clearance): R = 0, so no motion controller.
			motion: {attrs: [], vars: {}},
		});
	});

	it("lays the desktop tabs header out like upstream's live 116px PageHeader: a 64px bottom-aligned title row, 24px to a 28px tabs row, no top padding, so it pins 44px", () => {
		// Upstream 2026-11-07 at 1272px: PageHeader 116 = title row md:min-h-16 (64) + gap-y-4 (16) + tabs-row md:mt-2 (8)
		// + 28px tabs; box pb-2 makes the band 124, L = 88-8 = 80, pinned 124-80 = 44, scroll offset 44+16 = 60.
		stubGeometry({desktop: true, headerLeft: 60, upstream: true});
		const {page, band} = renderArtifacts();
		const header = band.querySelector("header");
		const titleRow = band.querySelector('[data-cds-part="title-row"]');
		expect({
			box: band.firstElementChild?.className,
			header: header?.className,
			titleRow: titleRow?.getAttribute("class"),
			row: band.querySelector('[data-cds-part="tabs-row"]')?.parentElement?.className,
			bandTop: band.style.top,
			pinned: page.style.getPropertyValue("--cds-page-header-pinned-height"),
			offset: page.style.getPropertyValue("--cds-page-header-scroll-offset"),
		}).toStrictEqual({
			// The 36px RootTopRow compensation moves into the 64px title row from md; pb-2 is static from md, where L > 0.
			box: "max-w-5xl pt-9 max-sm:pt-12 md:pt-0 pb-6 md:pb-2",
			header: "@container flex flex-col sm:-mt-1 md:mt-0",
			titleRow: "flex min-w-0 md:min-h-16 md:items-end",
			row: "mt-4 md:mt-6 flex flex-wrap items-center gap-x-4 gap-y-2",
			bandTop: "-80px",
			pinned: "44px",
			offset: "60px",
		});
	});

	it("below 48rem keeps the whole header pinned: no top, a 0px stuck-mark, and the box's below-md pb-6", () => {
		stubGeometry({desktop: false, headerLeft: 20});
		const {page, stuckMark, band} = renderArtifacts();
		expect({
			bandTop: band.style.top,
			stuckMark: stuckMark?.getAttribute("style"),
			box: band.firstElementChild?.className,
			pinned: page.style.getPropertyValue("--cds-page-header-pinned-height"),
			motion: motion(band),
		}).toStrictEqual({
			bandTop: "",
			stuckMark: "height: 0px; margin-bottom: 0px;",
			box: "max-w-5xl pt-9 max-sm:pt-12 md:pt-0 pb-6 md:pb-2",
			pinned: "140px",
			motion: {attrs: [], vars: {}},
		});
	});

	it("scrolls back to the top when keyboard focus moves into the hidden title while the tabs row is pinned", () => {
		stubGeometry({desktop: true, headerLeft: 60});
		const scrolls: {target: Element; options: unknown}[] = [];
		Element.prototype.scrollIntoView = function (this: Element, options?: unknown) {
			scrolls.push({target: this, options});
		};
		const {sentinel, stuckMark, fire} = renderArtifacts();
		const count = screen.getByRole("button", {name: "Count"});
		const search = screen.getByRole("button", {name: "Search"});
		vi.spyOn(count, "matches").mockReturnValue(true);
		vi.spyOn(search, "matches").mockReturnValue(true);
		fireEvent.focusIn(count);
		const beforeStuck = scrolls.length;
		fire(stuckMark, false);
		fireEvent.focusIn(search);
		fireEvent.focusIn(count);
		expect({
			beforeStuck,
			scrolls: scrolls.map((s) => ({sentinel: s.target === sentinel, options: s.options})),
		}).toStrictEqual({
			beforeStuck: 0,
			scrolls: [{sentinel: true, options: {block: "nearest"}}],
		});
	});

	it("with the toggle over the header (R = 24) and a scroll timeline, sets title-leaves and tabs-arrive with the pull and travel", () => {
		stubGeometry({desktop: true, headerLeft: 20});
		const {band, stuckMark, fire} = renderArtifacts();
		const atRest = motion(band);
		fire(stuckMark, false);
		expect({atRest, stuck: motion(band)}).toStrictEqual({
			atRest: {
				attrs: ["data-cds-title-leaves", "data-cds-tabs-arrive"],
				vars: {
					"--cds-page-header-tabs-shift-start": "24px",
					"--cds-page-header-tabs-shift-end": "0px",
					"--cds-page-header-tabs-pull": "-24px",
					"--cds-page-header-tabs-travel": "40px",
				},
			},
			// Once the tabs row pins the arrive ends: the tabs sit at the shifted margin.
			stuck: {
				attrs: ["data-cds-title-leaves"],
				vars: {"--cds-page-header-tabs-shift-start": "24px", "--cds-page-header-tabs-shift-end": "0px"},
			},
		});
	});

	it("pulls the other way in RTL", () => {
		stubGeometry({desktop: true, headerLeft: 20, rtl: true});
		const {band} = renderArtifacts();
		expect(band.style.getPropertyValue("--cds-page-header-tabs-pull")).toBe("24px");
	});

	it("falls back without motion: the title opacity var follows the sentinel and the shift jumps once the row is level", () => {
		stubGeometry({desktop: true, headerLeft: 20, reduced: true});
		const {band, sentinel, levelMark, fire} = renderArtifacts();
		const atRest = motion(band);
		fire(sentinel, false);
		const titleGone = motion(band);
		fire(levelMark, false);
		expect({atRest, titleGone, level: motion(band)}).toStrictEqual({
			atRest: {
				attrs: [],
				vars: {
					"--cds-page-header-title-opacity": "1",
					"--cds-page-header-tabs-shift-start": "0px",
					"--cds-page-header-tabs-shift-end": "24px",
				},
			},
			titleGone: {
				attrs: [],
				vars: {
					"--cds-page-header-title-opacity": "0",
					"--cds-page-header-tabs-shift-start": "0px",
					"--cds-page-header-tabs-shift-end": "24px",
				},
			},
			level: {
				attrs: [],
				vars: {
					"--cds-page-header-title-opacity": "0",
					"--cds-page-header-tabs-shift-start": "24px",
					"--cds-page-header-tabs-shift-end": "0px",
				},
			},
		});
	});

	it("treats a missing scroll timeline like reduced motion", () => {
		stubGeometry({desktop: true, headerLeft: 20, scrollTimeline: false});
		const {band} = renderArtifacts();
		expect(motion(band).attrs).toStrictEqual([]);
	});

	function pageVars(page: HTMLElement) {
		return {
			offset: page.style.getPropertyValue("--cds-page-header-scroll-offset"),
			pinned: page.style.getPropertyValue("--cds-page-header-pinned-height"),
		};
	}
	function unmeasured(): void {
		vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(0);
	}
	function renderPanelsOff() {
		const view = render(
			<PanelsOff>
				<div data-cds="Page">
					<CodePageHeader title="Artifacts" sticky={{box: "max-w-5xl"}} />
				</div>
			</PanelsOff>,
		);
		return view.container.querySelector<HTMLElement>('[data-cds="Page"]')!;
	}

	it("publishes upstream's c193cfc9b Page vars: B+16 under panels, 8rem/7rem before the first measurement", () => {
		stubGeometry({desktop: false, headerLeft: 20});
		const measured = pageVars(renderArtifacts().page);
		cleanup();
		resetPinnedHeightCache();
		unmeasured();
		expect({measured, unmeasured: pageVars(renderArtifacts().page)}).toStrictEqual({
			measured: {offset: "156px", pinned: "140px"},
			unmeasured: {offset: "8rem", pinned: "7rem"},
		});
	});

	it("without panels offsets by B+48, or 10rem before the first measurement", () => {
		stubGeometry({desktop: false, headerLeft: 20});
		const measured = pageVars(renderPanelsOff());
		cleanup();
		resetPinnedHeightCache();
		unmeasured();
		expect({measured, unmeasured: pageVars(renderPanelsOff())}).toStrictEqual({
			measured: {offset: "188px", pinned: "140px"},
			unmeasured: {offset: "10rem", pinned: "7rem"},
		});
	});

	it("paints a remount with the pinned height cached for the same header shape before it measures (upstream `me`)", () => {
		stubGeometry({desktop: false, headerLeft: 20});
		renderArtifacts();
		cleanup();
		unmeasured();
		const cached = pageVars(renderArtifacts().page);
		cleanup();
		// A header without a subtitle or tabs is another key, so it falls back.
		const otherShape = pageVars(
			render(
				<div data-cds="Page">
					<CodePageHeader title="Artifacts" sticky={{box: "max-w-5xl"}} />
				</div>,
			).container.firstElementChild as HTMLElement,
		);
		expect({cached, otherShape}).toStrictEqual({
			cached: {offset: "156px", pinned: "140px"},
			otherShape: {offset: "8rem", pinned: "7rem"},
		});
	});

	it("removes both Page vars on unmount", () => {
		stubGeometry({desktop: false, headerLeft: 20});
		const {page, unmount} = renderArtifacts();
		unmount();
		expect(pageVars(page)).toStrictEqual({offset: "", pinned: ""});
	});

	it("removes every attribute and var on unmount", () => {
		stubGeometry({desktop: true, headerLeft: 20});
		const {band, page, unmount} = renderArtifacts();
		const mounted = motion(band);
		unmount();
		expect({
			mounted: mounted.attrs,
			unmounted: motion(band),
			pinned: page.style.getPropertyValue("--cds-page-header-pinned-height"),
		}).toStrictEqual({
			mounted: ["data-cds-title-leaves", "data-cds-tabs-arrive"],
			unmounted: {attrs: [], vars: {}},
			pinned: "",
		});
	});
});
