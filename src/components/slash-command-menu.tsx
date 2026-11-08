import {useCallback, useLayoutEffect, useMemo, useRef, useState} from "react";

import {
	highlightMatches,
	matchingAlias,
	slashCommandLabel,
	type SlashCommand,
	type SlashMenuItem,
} from "../lib/slash-commands";
import {useShrinkwrap} from "../hooks/use-shrinkwrap";
import {slashCommandOptionId} from "./slash-command-option-id";
import {type Density, useScopeDensity} from "./ui/density-context";
import {TOOLTIP_CLASS} from "./ui/tooltip-classes";
import {placeRowTooltip} from "./ui/tooltip-placement";

/*
 * Upstream's slash portal copies its opener's density. The epitaxy root is compact unless a
 * coarse pointer, a density override or the fizzy-lake "panels" rollout makes it comfortable.
 * The rows are `h-control` (24px compact, 28px comfortable), not the generic menu's 32px
 * comfortable rows, so this keeps its own map. Heights feed the virtualizer: a section header
 * is `py-1` plus one footnote line per `whitespace-pre-line` line, a separator 1px plus `my-1`
 * (upstream's `mx-2.5` at every density since 2026-11-01), and the gutter is `p-1`/`p-1.5`.
 */
const SLASH_DENSITY = {
	compact: {
		popup: "rounded-r7",
		scroller: "p-1",
		row: "h-6 items-center gap-1.5 rounded-r5 px-2 py-[2.5px] text-[13px]/[19px]",
		header: "px-2 py-1 text-[12px]/[15px] font-medium text-ink-muted whitespace-pre-line",
		separator: "mx-2.5 my-1 h-px bg-border",
		loading: "flex h-6 items-center gap-1.5 px-2",
		rowHeight: 24,
		gutter: 4,
		headerLineHeight: 15,
	},
	comfortable: {
		popup: "rounded-menu-comfortable",
		scroller: "p-1.5",
		row: "h-7 items-center gap-2 rounded-r6 px-2.5 py-1 text-[14px]/[20px]",
		header: "px-2.5 py-1 text-[13px]/[17px] font-medium text-ink-muted whitespace-pre-line",
		separator: "mx-2.5 my-1 h-px bg-border",
		loading: "flex h-7 items-center gap-2 px-2.5",
		rowHeight: 28,
		gutter: 6,
		headerLineHeight: 17,
	},
} as const;

type SlashSizing = (typeof SLASH_DENSITY)[Density];

const POPUP_CLASS =
	"absolute bottom-full left-0 z-[130] mb-2 flex max-h-96 min-w-60 w-max max-w-[min(32rem,calc(100vw-16px))] flex-col bg-[var(--menu-bg)] text-primary shadow-[var(--menu-shadow)] select-none";

const ROW_CLASS = "flex w-full cursor-pointer outline-none data-[highlighted]:bg-fill-ghost-hover";

/* Upstream's shared tooltip box in the slash popup's z-130 positioner, fading and scaling over `duration-snap`. */
const ROW_TOOLTIP_CLASS = `${TOOLTIP_CLASS.replace("z-50", "z-[130]")} text-balance transition-[opacity,scale] duration-150 motion-reduce:transition-none`;

/* Upstream's tooltip detail line under a plugin skill's description, in the dark tooltip's secondary ink. */
const TOOLTIP_DETAIL_CLASS = "block break-words text-[11px]/[14px] text-[var(--tooltip-description-ink)]";

/* Upstream switches the list to `@tanstack/virtual` at 30 items, overscanning 8 rows and keeping 28px of scroll padding around the highlighted row. */
const VIRTUALIZE_AT = 30;
const OVERSCAN = 8;
const SCROLL_PADDING = 28;
const SEPARATOR_HEIGHT = 9;

function itemHeight(item: SlashMenuItem, sizing: SlashSizing): number {
	if (item.type === "section-header") return 8 + sizing.headerLineHeight * item.label.split("\n").length;
	if (item.type === "separator") return SEPARATOR_HEIGHT;
	return sizing.rowHeight;
}

/* Upstream's iconless `loading` row: a cds SkeletonGroup (`Skeleton.Rows` rows:1 icon:false) holding one 120×16 bar (`JO[0]`). */
const LOADING_BAR_CLASS = "max-w-full rounded bg-[var(--skeleton-base)]";
/* The popup's `max-h-96`, used until the scroller has a measured height. */
const FALLBACK_VIEWPORT_HEIGHT = 384;

interface RowWindow {
	start: number;
	end: number;
}

/* Each item's top offset below the gutter, plus the total height as the last entry. */
function itemOffsets(items: readonly SlashMenuItem[], sizing: SlashSizing): number[] {
	const offsets = [0];
	for (const item of items) offsets.push((offsets.at(-1) ?? 0) + itemHeight(item, sizing));
	return offsets;
}

/* The items intersecting the viewport plus the overscan on each side, as an exclusive range. */
function rowWindow(offsets: readonly number[], gutter: number, scrollTop: number, viewportHeight: number): RowWindow {
	const count = offsets.length - 1;
	const top = scrollTop - gutter;
	const bottom = scrollTop + viewportHeight - gutter;
	let first = 0;
	while (first < count && (offsets[first + 1] ?? 0) <= top) first++;
	let last = first;
	while (last < count && (offsets[last] ?? 0) < bottom) last++;
	return {start: Math.max(0, first - OVERSCAN), end: Math.min(count, last + OVERSCAN)};
}

/* `scrollToIndex(index, {align: "auto"})` with the scroll padding: only scrolls when the row is within the padding of an edge. */
function scrollTopFor(
	offsets: readonly number[],
	gutter: number,
	index: number,
	scrollTop: number,
	viewportHeight: number,
): number {
	const rowTop = gutter + (offsets[index] ?? 0);
	const rowBottom = gutter + (offsets[index + 1] ?? 0);
	if (rowBottom >= scrollTop + viewportHeight - SCROLL_PADDING) return rowBottom - viewportHeight + SCROLL_PADDING;
	if (rowTop <= scrollTop + SCROLL_PADDING) return Math.max(0, rowTop - SCROLL_PADDING);
	return scrollTop;
}

/* Labels bold in the row's ink; upstream's default highlight (the alias suffix) also lifts the match to primary. */
function Highlighted({
	text,
	query,
	highlightClassName = "font-semibold",
}: {
	text: string;
	query: string;
	highlightClassName?: string;
}) {
	return highlightMatches(text, query).map((segment, i) =>
		segment.match ? (
			<span key={i} className={highlightClassName}>
				{segment.text}
			</span>
		) : (
			segment.text
		),
	);
}

/**
 * The claude.ai/code "/" popup: a menu in the scope's density (240px to 32rem wide) above the composer with the
 * highlighted row's description as a dark tooltip 8px past that row. Keyboard focus
 * stays in the editor, which drives `highlighted` and `onAccept`.
 */
export function SlashCommandMenu({
	id,
	items,
	query,
	highlighted,
	onHighlight,
	onAccept,
}: {
	id: string;
	items: readonly SlashMenuItem[];
	query: string;
	highlighted: number;
	onHighlight: (index: number) => void;
	onAccept: (command: SlashCommand) => void;
}) {
	const popupRef = useRef<HTMLDivElement>(null);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);
	/* Upstream's row tip is the cds Tooltip popup, which hugs its wrapped text before it is placed. */
	const fitTooltip = useShrinkwrap({immediate: true});
	const tooltipCallbackRef = useCallback(
		(el: HTMLDivElement | null) => {
			tooltipRef.current = el;
			fitTooltip(el);
		},
		[fitTooltip],
	);
	const clampRef = useRef<HTMLSpanElement>(null);
	const detailRef = useRef<HTMLSpanElement>(null);
	const [scrollTop, setScrollTop] = useState(0);
	/* Upstream scrolls the active row into view only on keyboard navigation, never under a hovering pointer. */
	const hoverHighlightRef = useRef(false);
	const sizing = SLASH_DENSITY[useScopeDensity()];
	const virtualized = items.length >= VIRTUALIZE_AT;
	const offsets = useMemo(() => itemOffsets(items, sizing), [items, sizing]);
	const viewportHeight = () => {
		const height = scrollerRef.current?.clientHeight ?? 0;
		return height > 0 ? height : FALLBACK_VIEWPORT_HEIGHT;
	};
	const range = virtualized
		? rowWindow(offsets, sizing.gutter, scrollTop, viewportHeight())
		: {start: 0, end: items.length};
	const activeItem = items[highlighted];
	const active = activeItem?.type === "command" ? activeItem.command : undefined;
	const activeDetail = active?.pluginName === undefined ? undefined : `${active.pluginName} plugin`;

	/* Writes the tip's position straight to the DOM, like upstream's floating positioner, so following the row adds no React commit. */
	const placeTooltip = () => {
		const popup = popupRef.current;
		const row = scrollerRef.current?.querySelector<HTMLElement>("[data-highlighted]");
		const tooltip = tooltipRef.current;
		const clamp = clampRef.current;
		if (!popup || !row || !tooltip || !clamp) return;
		const placement = placeRowTooltip(row.getBoundingClientRect(), popup.getBoundingClientRect());
		tooltip.style.left = `${placement.left}px`;
		tooltip.style.top = `${placement.top}px`;
		clamp.style.maxWidth = placement.maxWidth;
		if (detailRef.current) detailRef.current.style.maxWidth = placement.maxWidth;
	};

	useLayoutEffect(() => {
		const scroller = scrollerRef.current;
		const hovered = hoverHighlightRef.current;
		hoverHighlightRef.current = false;
		if (!hovered && virtualized && scroller && highlighted >= 0) {
			const next = scrollTopFor(offsets, sizing.gutter, highlighted, scroller.scrollTop, viewportHeight());
			if (next !== scroller.scrollTop) scroller.scrollTop = next;
			setScrollTop(scroller.scrollTop);
		} else if (!hovered) {
			scroller?.querySelector<HTMLElement>("[data-highlighted]")?.scrollIntoView({block: "nearest"});
		}
		placeTooltip();
	}, [highlighted, items, offsets, sizing.gutter, virtualized]);

	/* A row mounted by a scroll may be the highlighted one, so the tip follows each window change. */
	useLayoutEffect(placeTooltip, [range.start, range.end]);

	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- cancels mousedown so the composer textarea keeps focus
		<div
			ref={popupRef}
			className={`${POPUP_CLASS} ${sizing.popup}`}
			onMouseDown={(e) => {
				e.preventDefault();
			}}
		>
			<div
				ref={scrollerRef}
				id={id}
				role="menu"
				aria-label="Slash commands"
				className={`relative min-h-0 overflow-y-auto overflow-x-hidden scroll-fade-y rounded-[inherit] ${sizing.scroller}`}
				onScroll={(e) => {
					if (virtualized) setScrollTop(e.currentTarget.scrollTop);
					placeTooltip();
				}}
			>
				{virtualized && <div aria-hidden style={{height: offsets[range.start]}} className="shrink-0" />}
				{items.slice(range.start, range.end).map((item, offset) => {
					const index = range.start + offset;
					/* Upstream draws headers and separators as plain divs: no role, not focusable. */
					if (item.type === "section-header") {
						return (
							<div key={`header:${index}`} className={sizing.header}>
								{item.label}
							</div>
						);
					}
					if (item.type === "separator")
						return <div key={`separator:${index}`} className={sizing.separator} />;
					if (item.type === "loading") {
						return (
							<div key={`loading:${index}`} data-testid="slash-loading-row">
								<div
									data-skeleton-group=""
									data-motion="wave"
									data-hold="none"
									data-hold-reason="overlay"
									role="status"
								>
									<span className="sr-only">Loading</span>
									<div aria-hidden="true" className="contents">
										<div className={sizing.loading}>
											<div
												data-skeleton=""
												className={LOADING_BAR_CLASS}
												style={{width: "120px", height: "16px"}}
											/>
										</div>
									</div>
								</div>
							</div>
						);
					}
					const {command} = item;
					const alias = matchingAlias(command, query);
					return (
						<div
							key={command.shadowsHost === true ? `${command.name}:cli` : command.name}
							id={slashCommandOptionId(id, index)}
							role="menuitem"
							tabIndex={-1}
							data-highlighted={index === highlighted ? "" : undefined}
							className={`${ROW_CLASS} ${sizing.row}`}
							onMouseMove={() => {
								if (index === highlighted) return;
								hoverHighlightRef.current = true;
								onHighlight(index);
							}}
							onMouseDown={(e) => {
								e.preventDefault();
								onAccept(command);
							}}
						>
							<span className="min-w-0 truncate">
								<Highlighted text={slashCommandLabel(command)} query={query} />
							</span>
							{alias !== undefined && (
								<span className="min-w-0 truncate text-ink-muted">
									<Highlighted
										text={`(${alias})`}
										query={query}
										highlightClassName="font-semibold text-primary"
									/>
								</span>
							)}
							{command.shadowsHost === true && (
								<span className="ms-auto shrink-0 ps-2 text-caption text-ink-muted">
									Custom command
								</span>
							)}
							{query !== "" && command.pluginName !== undefined && (
								<span className="ms-auto shrink-0 ps-2 text-caption text-ink-muted">
									{command.pluginName}
								</span>
							)}
						</div>
					);
				})}
				{virtualized && (
					<div
						aria-hidden
						style={{height: (offsets.at(-1) ?? 0) - (offsets[range.end] ?? 0)}}
						className="shrink-0"
					/>
				)}
			</div>
			{active !== undefined && (active.description !== "" || activeDetail !== undefined) && (
				<div ref={tooltipCallbackRef} role="tooltip" className={ROW_TOOLTIP_CLASS}>
					<span className="min-w-0 break-words">
						{/* With no description, upstream shows the plugin line as the tooltip's content. */}
						<span ref={clampRef} className="line-clamp-[10]">
							{active.description === "" ? (
								activeDetail
							) : (
								<Highlighted text={active.description} query={query} />
							)}
						</span>
						{active.description !== "" && activeDetail !== undefined && (
							<span ref={detailRef} data-slash-tooltip-detail="" className={TOOLTIP_DETAIL_CLASS}>
								{activeDetail}
							</span>
						)}
					</span>
				</div>
			)}
		</div>
	);
}
