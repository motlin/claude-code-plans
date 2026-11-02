import {type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState} from "react";

import {useFizzyLake} from "../lib/fizzy-lake";
import {useReducedMotion} from "../lib/reduced-motion";
import {pinnedHeightCache} from "./page-header-pinned-height";
import {findScrollContainer, toObserverRoot} from "./scroll-container";

/**
 * claude.ai/code's compact list-page header (Scheduled tasks, Artifacts, Projects): a 24/32 serif
 * title at y=32 (y=48 below sm, past the sidebar trigger), then a row with the tabs on the left and the toolbar right-aligned on it.
 *
 * With `sticky`, it renders upstream's cds Page header band: an `h-0` sentinel, then a
 * `sticky top-0` band (z 20) holding the content-width `box` (with `pb-6`), under panels a frosted
 * `data-cds-part=page-header-ground` (85% page colour + 12px blur, in globals.css; `bg-page` without panels), and a
 * separator: under fizzy-lake panels a 1px `data-cds-part=line` border at the band's bottom edge,
 * otherwise a `data-cds-part=fade` strip that hangs 32px below it. The separator stays invisible
 * until the sentinel scrolls out of the scroller, i.e. until the band pins over scrolled content. The sentinel
 * (and so the band) rises over RootTopRow's empty 36px (48px phone) spacer and pads it back, so pinned it keeps the
 * whitespace upstream's 64px title row has above the title instead of pinning the title flush at the top.
 */
export function CodePageHeader({
	title,
	subtitle,
	tabs,
	toolbar,
	sticky,
	searchOpen,
	children,
}: {
	title: string;
	/** A 13px muted caption under the title, such as a list's item count. */
	subtitle?: ReactNode;
	tabs?: ReactNode;
	toolbar?: ReactNode;
	/**
	 * Pin the header with a scroll fade; `box` is the content-width wrapper's classes. `onTitleTravel` hears how far the
	 * title scrolls away before the tabs row pins (0 when the whole header pins), for upstream's `contentGap: lg` pt-5.
	 */
	sticky?:
	{
		box: string;
		onTitleTravel?: (px: number) => void;
	};
	/** Mark the toolbar `data-search-open` so an open ToolbarSearch takes the row (all of it below a 640px header). */
	searchOpen?: boolean;
	/** Extras under the header, such as a live status line. */
	children?: ReactNode;
})
{
	const panels = useFizzyLake("panels");
	// Upstream's tall band with a tabs row (cf35aed38 PageHeader + c193cfc9b Page): from md (where the title travels away) it
	// lays out as the live 116px header, a 64px bottom-aligned title row, 24px to a 28px tabs row, so it pins 44px.
	const tabsRow = panels && tabs !== undefined;
	const tallTabs = tabsRow && sticky !== undefined;
	const heading = <h1 className="min-w-0 font-voice text-[24px]/[32px] font-medium text-primary">{title}</h1>;
	const caption = subtitle !== undefined && <p className="mt-1 text-[13px] text-t6">{subtitle}</p>;
	const header = (
		<header
			data-cds="PageHeader"
			data-band="tall"
			className={
				sticky === undefined
					? "@container flex flex-col pb-4 sm:-mt-1"
					: tallTabs
						? "@container flex flex-col sm:-mt-1 md:mt-0"
						: "@container flex flex-col sm:-mt-1"
			}
		>
			{panels ? (
				<div data-cds-part="page-title-motion" className={TITLE_MOTION_CLASS}>
					<div data-cds-part="title-row" className={tallTabs ? TALL_TITLE_ROW_CLASS : undefined}>
						{heading}
					</div>
					{caption}
				</div>
			) : (
				<>
					{heading}
					{caption}
				</>
			)}
			{(tabs !== undefined || toolbar !== undefined) && (
				<div
					className={
						tabsRow ? TABS_HEADER_ROW_CLASS : "mt-5 flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2"
					}
				>
					{tabsRow ? (
						<div data-cds-part="tabs-row" className={TABS_ROW_CLASS}>
							{tabs}
						</div>
					) : (
						tabs
					)}
					{toolbar !== undefined && (
						<div
							data-cds-part="controls"
							data-search-open={searchOpen === true ? "" : undefined}
							className={CONTROLS_CLASS}
						>
							{toolbar}
						</div>
					)}
				</div>
			)}
			{children}
		</header>
	);
	if (sticky === undefined) return header;
	return (
		<StickyBand
			box={sticky.box}
			tallTabs={tallTabs}
			onTitleTravel={sticky.onTitleTravel}
			cacheKey={`tall|content|lg|${subtitle !== undefined}|${tabs !== undefined}`}
		>
			{header}
		</StickyBand>
	);
}

/**
 * Upstream cf35aed38 PageHeader `ce`/`le` under panels: the title block PageHeaderMotion fades (opacity var, upstream's
 * duration-fast) and the tabs row it shifts past the collapsed sidebar toggle. Local Tabs have no `-mx-2 px-2` bleed,
 * so the tabs row takes the plain margin pair rather than upstream's `calc(var(...) - 0.5rem)` variant for bare Tabs.
 */
const TITLE_MOTION_CLASS =
	"flex min-w-0 flex-col basis-full origin-left opacity-[var(--cds-page-header-title-opacity,1)] transition-opacity duration-150 rtl:origin-right";
const TABS_ROW_CLASS =
	"flex min-w-0 items-center ms-[var(--cds-page-header-tabs-shift-start,0px)] me-[var(--cds-page-header-tabs-shift-end,0px)]";
/**
 * Upstream cf35aed38 title row `flex min-h-12 min-w-0 items-center … md:min-h-16 md:items-end` for the tall band. Below md
 * local keeps the bare 32px row under the box's RootTopRow padding instead of upstream's min-h-12.
 */
const TALL_TITLE_ROW_CLASS = "flex min-w-0 md:min-h-16 md:items-end";
/**
 * The row holding the tabs-row and controls: upstream's header `gap-y-4` plus the tabs row's tall `mt-0 md:mt-2`, with no
 * 32px floor, so it is as tall as the 28px tabs and controls.
 */
const TABS_HEADER_ROW_CLASS = "mt-4 md:mt-6 flex flex-wrap items-center gap-x-4 gap-y-2";

/** Upstream's PageHeader controls: an open search grows the row (grow-[3] basis-0), or takes all of it below a 640px header. */
const CONTROLS_CLASS =
	"ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2 [&[data-search-open]]:min-w-min [&[data-search-open]]:flex-nowrap @min-[640px]:[&[data-search-open]]:grow-[3] @min-[640px]:[&[data-search-open]]:basis-0 @max-[640px]:[&[data-search-open]]:basis-full @max-[640px]:[&[data-search-open]>:not([role=search])]:hidden";

/** Upstream's `page-fade-t` strip; `transition-[opacity,visibility]` runs at the default 150ms (upstream's duration-fast). */
const FADE_CLASS = "page-fade-t absolute inset-x-0 -bottom-8 h-8 transition-[opacity,visibility]";
/** Upstream c193cfc9b cds Page `data-cds-part: E ? "line" : "fade"`: the panels separator, a 1px `--cds-border-line` rule. */
const LINE_CLASS =
	"pointer-events-none absolute inset-x-0 bottom-0 border-b border-[color:var(--color-border-line)] transition-[opacity,visibility]";

const TABS_ROW_SELECTOR = '[data-cds-part="tabs-row"]';
const CONTROLS_SELECTOR = '[data-cds-part="controls"]';
const BARE_TABS_SELECTOR = ":scope > [data-cds=Tabs]:not([data-orientation=vertical])";
/** Upstream `fe`: the tabs-arrive travel's ceiling. */
const MAX_TABS_TRAVEL = 140;
const START_CLEARANCE_WIDTH = "max(0px, var(--cds-page-header-start-clearance, 0px))";
const PINNED_HEIGHT_VAR = "--cds-page-header-pinned-height";
const SCROLL_OFFSET_VAR = "--cds-page-header-scroll-offset";

function StickyBand({
	box,
	tallTabs,
	onTitleTravel,
	cacheKey,
	children,
}: {
	box: string;
	tallTabs: boolean;
	onTitleTravel: ((px: number) => void) | undefined;
	cacheKey: string;
	children: ReactNode;
})
{
	const sentinelRef = useRef<HTMLDivElement>(null);
	const stuckMarkRef = useRef<HTMLDivElement>(null);
	const levelMarkRef = useRef<HTMLDivElement>(null);
	const bandRef = useRef<HTMLDivElement>(null);
	const [scrolled, setScrolled] = useState(false);
	const [rowIsLevel, setRowIsLevel] = useState(false);
	const [sentinelGone, setSentinelGone] = useState(false);
	const panels = useFizzyLake("panels");
	useEffect(() =>
	{
		// Upstream c193cfc9b Page: under panels the stuck-mark is the "stuck" sentinel, the level-mark reports rowIsLevel and the
		// h-0 sentinel titleGone; without panels the h-0 sentinel alone is "stuck".
		const stuckTarget = (panels ? stuckMarkRef : sentinelRef).current;
		if (stuckTarget === null || typeof IntersectionObserver === "undefined") return undefined;
		const levelMark = levelMarkRef.current;
		const sentinel = panels ? sentinelRef.current : null;
		const observer = new IntersectionObserver(
			(entries) =>
			{
				for (const entry of entries)
				{
					const set =
						entry.target === levelMark
							? setRowIsLevel
							: entry.target === sentinel
								? setSentinelGone
								: setScrolled;
					set(!entry.isIntersecting);
				}
			},
			{
				root: toObserverRoot(findScrollContainer(stuckTarget)),
			},
		);
		observer.observe(stuckTarget);
		for (const target of [levelMark, sentinel]) if (target !== null) observer.observe(target);
		return () =>
		{
			observer.disconnect();
		};
	}, [panels]);

	const [height, setHeight] = useState(0);
	const [travel, setTravel] = useState(0);
	const [shift, setShift] = useState(0);
	const [tabsRowHeight, setTabsRowHeight] = useState(0);
	const [tabsAreBare, setTabsAreBare] = useState(false);
	useEffect(() =>
	{
		const band = bandRef.current;
		if (band === null || typeof ResizeObserver === "undefined") return undefined;
		let observedTabsRow: Element | null = null;
		const measure = () =>
		{
			setHeight(band.offsetHeight);
			const tabsRow = panels ? band.querySelector(TABS_ROW_SELECTOR) : null;
			if (tabsRow !== null && tabsRow !== observedTabsRow)
			{
				observer.observe(tabsRow);
				observedTabsRow = tabsRow;
				if (levelMarkRef.current !== null) observer.observe(levelMarkRef.current);
			}
			const view = tabsRow === null ? null : band.ownerDocument.defaultView;
			const clearanceWidth = levelMarkRef.current?.offsetWidth ?? 0;
			const clearance = clearanceWidth > 0 && clearanceWidth * 2 < band.offsetWidth ? clearanceWidth : 0;
			const tabsRect =
				typeof view?.matchMedia === "function" && view.matchMedia("(min-width: 48rem)").matches
					? tabsRow?.getBoundingClientRect()
					: undefined;
			const headerRect =
				tabsRect === undefined
					? undefined
					: band.querySelector("[data-cds=PageHeader]")?.getBoundingClientRect();
			setShift(
				headerRect === undefined || view === null
					? 0
					: Math.max(
							0,
							clearance -
								(view.getComputedStyle(band).direction === "rtl"
									? band.ownerDocument.documentElement.clientWidth - headerRect.right
									: headerRect.left),
						),
			);
			setTabsRowHeight(tabsRect?.height ?? 0);
			setTabsAreBare(tabsRow?.querySelector(BARE_TABS_SELECTOR) != null);
			setTravel(
				tabsRect !== undefined && tabsRect.width > 0
					? Math.max(
							0,
							Math.min(
								tabsRect.top,
								band.querySelector(CONTROLS_SELECTOR)?.getBoundingClientRect().top ?? tabsRect.top,
							) -
								band.getBoundingClientRect().top -
								8,
						)
					: 0,
			);
		};
		const observer = new ResizeObserver(measure);
		measure();
		observer.observe(band);
		return () =>
		{
			observer.disconnect();
		};
	}, [panels]);

	useEffect(() =>
	{
		onTitleTravel?.(travel);
	}, [onTitleTravel, travel]);

	// Upstream c193cfc9b Page root vars `ne`/`te`: the band's pinned height B (all of it, or below the travelled title) and
	// the row scroll offset B+16 (B+48 without panels), which cd75b47e6 maps to --list-header-scroll-offset in the content.
	useEffect(() =>
	{
		const page = bandRef.current?.parentElement?.closest<HTMLElement>('[data-cds="Page"]');
		if (page === null || page === undefined) return undefined;
		const measured = height > 0 ? height - travel : undefined;
		if (measured !== undefined) pinnedHeightCache.set(cacheKey, measured);
		const pinned = measured ?? pinnedHeightCache.get(cacheKey);
		page.style.setProperty(
			SCROLL_OFFSET_VAR,
			pinned === undefined ? (panels ? "8rem" : "10rem") : `${pinned + (panels ? 16 : 48)}px`,
		);
		page.style.setProperty(PINNED_HEIGHT_VAR, pinned === undefined ? "7rem" : `${pinned}px`);
		return () =>
		{
			page.style.removeProperty(SCROLL_OFFSET_VAR);
			page.style.removeProperty(PINNED_HEIGHT_VAR);
		};
	}, [height, travel, panels, cacheKey]);

	const levelHeight = travel > 0 ? Math.max(0, travel + 8 - (tabsRowHeight + 16)) : 0;
	const moves = travel > 0 && shift > 0;

	// Upstream's focus return: keyboard focus moving up into the travelled-away title scrolls the page back to the top.
	useEffect(() =>
	{
		const band = bandRef.current;
		if (band === null || travel <= 0 || !(scrolled || moves)) return undefined;
		const onFocusIn = (event: FocusEvent) =>
		{
			const target = event.target;
			if (!(target instanceof Element)) return;
			const before =
				(band.querySelector(TABS_ROW_SELECTOR)?.compareDocumentPosition(target) ?? 0) &
				Node.DOCUMENT_POSITION_PRECEDING;
			if (before !== 0 && target.matches(":focus-visible"))
				sentinelRef.current?.scrollIntoView(
					{
						block: "nearest",
					},
				);
		};
		band.addEventListener("focusin", onFocusIn);
		return () =>
		{
			band.removeEventListener("focusin", onFocusIn);
		};
	}, [travel, scrolled, moves]);

	return (
		<>
			<div ref={sentinelRef} className="h-0 -mt-9 max-sm:-mt-12" />
			{/* Upstream c193cfc9b `Page` stuck-mark/`top:-L`: on desktop the band rises by the title's travel L, so only the tabs
			    row pins, and the stuck-mark (L tall) leaves exactly when it does. L comes from the measured rects, so it already
			    covers the -mt-9/pt-9 RootTopRow compensation. */}
			{panels ? (
				<div
					ref={stuckMarkRef}
					data-cds-part="stuck-mark"
					className="pointer-events-none shrink-0"
					style={
					{
						height: travel,
						marginBottom: -travel,
					}}
				/>
			) : null}
			{panels ? (
				<div
					ref={levelMarkRef}
					data-cds-part="level-mark"
					className="pointer-events-none max-w-full shrink-0"
					style={
					{
						height: levelHeight,
						marginBottom: -levelHeight,
						width: START_CLEARANCE_WIDTH,
					}}
				/>
			) : null}
			{/* Upstream c193cfc9b cds Page `D?"sticky top-0":"sticky top-0 bg-page"` + page-header-ground, with D = translucentHeader &&
			    panels; cd75b47e6 passes `translucentHeader: band !== "compact"`, and the web band is always tall. */}
			<div
				ref={bandRef}
				className={panels ? "sticky top-0" : "sticky top-0 bg-page"}
				style={
				{
					zIndex: 20,
					...(travel > 0
						?
							{
								top: -travel,
							}
						: {}),
				}}
			>
				{/* With a tabs row the title travels exactly from md, so the box takes its static md padding: the 64px title row
				    already holds RootTopRow's 36px (md:pt-0), and upstream's contentGap lg pb-2 never waits for the first measure. */}
				<div
					className={
						tallTabs
							? `${box} pt-9 max-sm:pt-12 md:pt-0 pb-6 md:pb-2`
							: `${box} pt-9 max-sm:pt-12 ${travel > 0 ? "pb-2" : "pb-6"}`
					}
				>
					{children}
				</div>
				{panels ? <div aria-hidden="true" data-cds-part="page-header-ground" /> : null}
				{panels ? (
					<div
						aria-hidden="true"
						data-cds-part="line"
						className={`${LINE_CLASS} ${scrolled ? "opacity-100" : "invisible opacity-0"}`}
					/>
				) : (
					<div
						aria-hidden="true"
						data-cds-part="fade"
						className={`${FADE_CLASS} ${scrolled ? "visible opacity-100" : "invisible opacity-0"}`}
					/>
				)}
			</div>
			{moves ? (
				<PageHeaderMotion
					bandRef={bandRef}
					travel={Math.min(MAX_TABS_TRAVEL, Math.max(1, levelHeight))}
					shift={shift}
					tabsAreBare={tabsAreBare}
					titleGone={sentinelGone}
					rowIsLevel={rowIsLevel}
					isStuck={scrolled}
				/>
			) : null}
		</>
	);
}

const MOTION_ATTRIBUTES = ["data-cds-title-leaves", "data-cds-tabs-arrive", "data-cds-row-level"] as const;
const MOTION_VARS = [
	"--cds-page-header-title-opacity",
	"--cds-page-header-tabs-shift-start",
	"--cds-page-header-tabs-shift-end",
	"--cds-page-header-tabs-pull",
	"--cds-page-header-tabs-travel",
] as const;

/**
 * Upstream c193cfc9b `pe`: with the collapsed sidebar toggle over the header (shift R > 0), drives the globals.css
 * title-leaves / tabs-arrive scroll-timeline animations through attributes and vars on the band. Without a scroll timeline
 * (or under reduced motion) the title fades through its opacity var and the tabs jump to the shifted margin once the row
 * is level with the toggle.
 */
function PageHeaderMotion({
	bandRef,
	travel,
	shift,
	tabsAreBare,
	titleGone,
	rowIsLevel,
	isStuck,
}: {
	bandRef: RefObject<HTMLDivElement | null>;
	travel: number;
	shift: number;
	tabsAreBare: boolean;
	titleGone: boolean;
	rowIsLevel: boolean;
	isStuck: boolean;
})
{
	const reducedMotion = useReducedMotion();
	useLayoutEffect(() =>
	{
		const band = bandRef.current;
		const view = band?.ownerDocument.defaultView ?? null;
		if (band === null || view === null) return;
		const animated = !reducedMotion && view.CSS.supports("animation-timeline: scroll()");
		const arrives = animated && tabsAreBare;
		const arriving = arrives && !isStuck;
		band.toggleAttribute("data-cds-title-leaves", animated);
		band.toggleAttribute("data-cds-tabs-arrive", arriving);
		band.toggleAttribute("data-cds-row-level", animated && rowIsLevel);
		const shifted = arrives || rowIsLevel;
		const vars: Record<(typeof MOTION_VARS)[number], string | undefined> =
		{
			"--cds-page-header-title-opacity": animated ? undefined : titleGone ? "0" : "1",
			"--cds-page-header-tabs-shift-start": `${shifted ? shift : 0}px`,
			"--cds-page-header-tabs-shift-end": `${shifted ? 0 : shift}px`,
			"--cds-page-header-tabs-pull": arriving
				? `${view.getComputedStyle(band).direction === "rtl" ? shift : -shift}px`
				: undefined,
			"--cds-page-header-tabs-travel": arriving ? `${travel}px` : undefined,
		};
		for (const name of MOTION_VARS)
		{
			const value = vars[name];
			if (value === undefined) band.style.removeProperty(name);
			else band.style.setProperty(name, value);
		}
	}, [bandRef, reducedMotion, travel, shift, tabsAreBare, titleGone, rowIsLevel, isStuck]);
	useLayoutEffect(() =>
	{
		const band = bandRef.current;
		return () =>
		{
			for (const name of MOTION_ATTRIBUTES) band?.removeAttribute(name);
			for (const name of MOTION_VARS) band?.style.removeProperty(name);
		};
	}, [bandRef]);
	return null;
}
