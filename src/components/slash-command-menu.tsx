import {useLayoutEffect, useRef, useState} from "react";

import {
	highlightMatches,
	isCustomCommand,
	matchingAlias,
	slashCommandLabel,
	type SlashCommand,
} from "../lib/slash-commands";
import {slashCommandOptionId} from "./slash-command-option-id";
import {DENSITY_CLASSES} from "./ui/menu-internals";
import {TOOLTIP_CLASS} from "./ui/tooltip";
import {placeRowTooltip} from "./ui/tooltip-placement";

/* Upstream renders the slash popup in a compact-density portal whatever the account's density. */
const COMPACT = DENSITY_CLASSES.compact;

const POPUP_CLASS = `absolute bottom-full left-0 z-[130] mb-2 flex max-h-96 min-w-60 w-max max-w-[min(32rem,calc(100vw-16px))] flex-col ${COMPACT.popup} bg-[var(--menu-bg)] text-primary shadow-[var(--menu-shadow)] select-none`;

const ROW_CLASS = `flex w-full cursor-pointer ${COMPACT.singleLine} gap-1.5 ${COMPACT.item} ${COMPACT.text} outline-none data-[highlighted]:bg-fill-ghost-hover`;

/* Upstream's shared tooltip box in the slash popup's z-130 positioner, fading and scaling over `duration-snap`. */
const ROW_TOOLTIP_CLASS = `${TOOLTIP_CLASS.replace("z-50", "z-[130]")} text-balance transition-[opacity,scale] duration-150 motion-reduce:transition-none`;

/* Upstream's tooltip detail line under a plugin skill's description, in the dark tooltip's secondary ink. */
const TOOLTIP_DETAIL_CLASS = "block break-words text-[11px]/[14px] text-[var(--tooltip-description-ink)]";

/* Upstream switches the list to `@tanstack/virtual` at 30 items, overscanning 8 rows and keeping 28px of scroll padding around the highlighted row. */
const VIRTUALIZE_AT = 30;
const OVERSCAN = 8;
const SCROLL_PADDING = 28;
/* Compact rows are a fixed `h-6`; the scroller's `p-1` gutter sits above row 0. */
const ROW_HEIGHT = 24;
const GUTTER = 4;
/* The popup's `max-h-96`, used until the scroller has a measured height. */
const FALLBACK_VIEWPORT_HEIGHT = 384;

interface RowWindow {
	start: number;
	end: number;
}

/* The rows intersecting the viewport plus the overscan on each side, as an exclusive range. */
function rowWindow(count: number, scrollTop: number, viewportHeight: number): RowWindow {
	const first = Math.floor(Math.max(0, scrollTop - GUTTER) / ROW_HEIGHT);
	const last = Math.ceil(Math.max(0, scrollTop + viewportHeight - GUTTER) / ROW_HEIGHT);
	return {start: Math.max(0, first - OVERSCAN), end: Math.min(count, last + OVERSCAN)};
}

/* `scrollToIndex(index, {align: "auto"})` with the scroll padding: only scrolls when the row is within the padding of an edge. */
function scrollTopFor(index: number, scrollTop: number, viewportHeight: number): number {
	const rowTop = GUTTER + index * ROW_HEIGHT;
	const rowBottom = rowTop + ROW_HEIGHT;
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
 * The claude.ai/code "/" popup: a compact menu (240px to 32rem wide) above the composer with the
 * highlighted row's description as a dark tooltip 8px past that row. Keyboard focus
 * stays in the editor, which drives `highlighted` and `onAccept`.
 */
export function SlashCommandMenu({
	id,
	commands,
	query,
	highlighted,
	onHighlight,
	onAccept,
}: {
	id: string;
	commands: readonly SlashCommand[];
	query: string;
	highlighted: number;
	onHighlight: (index: number) => void;
	onAccept: (command: SlashCommand) => void;
}) {
	const popupRef = useRef<HTMLDivElement>(null);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);
	const clampRef = useRef<HTMLSpanElement>(null);
	const detailRef = useRef<HTMLSpanElement>(null);
	const [scrollTop, setScrollTop] = useState(0);
	/* Upstream scrolls the active row into view only on keyboard navigation, never under a hovering pointer. */
	const hoverHighlightRef = useRef(false);
	const virtualized = commands.length >= VIRTUALIZE_AT;
	const viewportHeight = () => {
		const height = scrollerRef.current?.clientHeight ?? 0;
		return height > 0 ? height : FALLBACK_VIEWPORT_HEIGHT;
	};
	const range = virtualized
		? rowWindow(commands.length, scrollTop, viewportHeight())
		: {start: 0, end: commands.length};
	const active = commands[highlighted];
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
			const next = scrollTopFor(highlighted, scroller.scrollTop, viewportHeight());
			if (next !== scroller.scrollTop) scroller.scrollTop = next;
			setScrollTop(scroller.scrollTop);
		} else if (!hovered) {
			scroller?.querySelector<HTMLElement>("[data-highlighted]")?.scrollIntoView({block: "nearest"});
		}
		placeTooltip();
	}, [highlighted, commands, virtualized]);

	/* A row mounted by a scroll may be the highlighted one, so the tip follows each window change. */
	useLayoutEffect(placeTooltip, [range.start, range.end]);

	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- cancels mousedown so the composer textarea keeps focus
		<div
			ref={popupRef}
			className={POPUP_CLASS}
			onMouseDown={(e) => {
				e.preventDefault();
			}}
		>
			<div
				ref={scrollerRef}
				id={id}
				role="menu"
				aria-label="Slash commands"
				className="min-h-0 overflow-y-auto overflow-x-hidden rounded-[inherit] p-1"
				onScroll={(e) => {
					if (virtualized) setScrollTop(e.currentTarget.scrollTop);
					placeTooltip();
				}}
			>
				{virtualized && <div aria-hidden style={{height: range.start * ROW_HEIGHT}} className="shrink-0" />}
				{commands.slice(range.start, range.end).map((command, offset) => {
					const index = range.start + offset;
					const alias = matchingAlias(command, query);
					return (
						<div
							key={command.name}
							id={slashCommandOptionId(id, index)}
							role="menuitem"
							tabIndex={-1}
							data-highlighted={index === highlighted ? "" : undefined}
							className={ROW_CLASS}
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
							{isCustomCommand(command.source) && (
								<span className="ml-auto shrink-0 pl-2 text-caption text-muted">Custom command</span>
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
						style={{height: (commands.length - range.end) * ROW_HEIGHT}}
						className="shrink-0"
					/>
				)}
			</div>
			{active !== undefined && (active.description !== "" || activeDetail !== undefined) && (
				<div ref={tooltipRef} role="tooltip" className={ROW_TOOLTIP_CLASS}>
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
