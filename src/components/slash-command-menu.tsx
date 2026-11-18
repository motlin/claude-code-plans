import {useCallback, useLayoutEffect, useMemo, useRef, useState} from "react";

import
{
	highlightMatches,
	matchingAlias,
	slashCommandLabel,
	slashCommandRowKey,
	type SlashCommand,
	type SlashMenuItem,
} from "../lib/slash-commands";
import {useLazyShrinkwrap} from "../hooks/use-lazy-shrinkwrap";
import {slashCommandOptionId, slashSubmenuOptionId} from "./slash-command-option-id";
import {type Density, useScopeDensity} from "./ui/density-context";
import {TOOLTIP_CLASS} from "./ui/tooltip-classes";
import {placeRowTooltip} from "./ui/tooltip-placement";
import {Icon} from "./ui/icon";

/*
 * Upstream's slash portal copies its opener's density. The epitaxy root is compact unless a
 * coarse pointer, a density override or the fizzy-lake "panels" rollout makes it comfortable.
 * The rows are `h-control` (24px compact, 28px comfortable), not the generic menu's 32px
 * comfortable rows, so this keeps its own map. Heights feed the virtualizer: a section header
 * is `py-1` plus one footnote line per `whitespace-pre-line` line, a separator 1px plus `my-1`
 * (upstream's `mx-2.5` at every density since 2026-11-01), and the gutter is `p-1`/`p-1.5`.
 */
const SLASH_DENSITY =
{
	compact:
	{
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
	comfortable:
	{
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

const POPUP_SURFACE_CLASS =
	"z-[130] flex min-w-60 max-w-[min(32rem,calc(100vw-16px))] flex-col bg-[var(--menu-bg)] text-primary shadow-[var(--menu-shadow)] select-none";

/*
 * Upstream's positioner caps: `maxHeightCap` 384 with the grouped menu's gate off; with it on (`fixedWidth` 260) the
 * grouped empty view has no cap (the available height wins) and a typed query caps at 480.
 */
function popupClass(compactHost: boolean, grouped: boolean): string
{
	const size = compactHost ? (grouped ? "w-[260px]" : "w-[260px] max-h-[480px]") : "w-max max-h-96";
	return `absolute bottom-full left-0 mb-2 ${size} ${POPUP_SURFACE_CLASS}`;
}

/* Upstream's nested submenu `re`: the same popup, `right-start` 8px past the trigger and 4px above it, capped at 384. */
const NESTED_POPUP_CLASS = `absolute w-max max-h-96 ${POPUP_SURFACE_CLASS}`;
const NESTED_OFFSET_X = 8;
const NESTED_OFFSET_Y = -4;

/* Upstream's `Dr` suffix slot, `CaretRight sm` and the inert cds Switch sm (32x18, 14px thumb) of a toggle row. */
const SUFFIX_CLASS = "shrink-0 text-caption text-muted-as-secondary";
const CARET_CLASS = "-me-1 shrink-0 text-muted-as-secondary";
const ROW_SWITCH_TRACK_CLASS =
	"relative inline-flex h-[18px] w-8 shrink-0 rounded-full p-[2px] bg-[var(--menu-switch-track)] data-[checked]:bg-accent-100";
const ROW_SWITCH_KNOB_CLASS =
	"block size-[14px] rounded-full bg-white shadow-[0_1px_2px_0_rgb(11_11_11/0.06),0_2px_8px_0_rgb(0_0_0/0.24)] transition-transform duration-[120ms] ease-[cubic-bezier(0.34,1.3,0.64,1)] motion-reduce:transition-none data-[checked]:translate-x-[14px] rtl:data-[checked]:-translate-x-[14px]";

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

function itemHeight(item: SlashMenuItem, sizing: SlashSizing): number
{
	if (item.type === "section-header") return 8 + sizing.headerLineHeight * item.label.split("\n").length;
	if (item.type === "separator") return SEPARATOR_HEIGHT;
	return sizing.rowHeight;
}

/* Upstream's iconless `loading` row: a cds SkeletonGroup (`Skeleton.Rows` rows:1 icon:false) holding one 120×16 bar (`JO[0]`). */
const LOADING_BAR_CLASS = "max-w-full rounded bg-[var(--skeleton-base)]";
/* The popup's `max-h-96`, used until the scroller has a measured height. */
const FALLBACK_VIEWPORT_HEIGHT = 384;

interface RowWindow
{
	start: number;
	end: number;
}

/* Each item's top offset below the gutter, plus the total height as the last entry. */
function itemOffsets(items: readonly SlashMenuItem[], sizing: SlashSizing): number[]
{
	const offsets = [0];
	for (const item of items) offsets.push((offsets.at(-1) ?? 0) + itemHeight(item, sizing));
	return offsets;
}

/* The items intersecting the viewport plus the overscan on each side, as an exclusive range. */
function rowWindow(offsets: readonly number[], gutter: number, scrollTop: number, viewportHeight: number): RowWindow
{
	const count = offsets.length - 1;
	const top = scrollTop - gutter;
	const bottom = scrollTop + viewportHeight - gutter;
	let first = 0;
	while (first < count && (offsets[first + 1] ?? 0) <= top) first++;
	let last = first;
	while (last < count && (offsets[last] ?? 0) < bottom) last++;
	return {
		start: Math.max(0, first - OVERSCAN),
		end: Math.min(count, last + OVERSCAN),
	};
}

/* `scrollToIndex(index, {align: "auto"})` with the scroll padding: only scrolls when the row is within the padding of an edge. */
function scrollTopFor(
	offsets: readonly number[],
	gutter: number,
	index: number,
	scrollTop: number,
	viewportHeight: number,
): number
{
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
})
{
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

/** Upstream's `Dr`: the trailing value of a host or flyout row. */
function rowSuffix(value: string)
{
	return (
		<span className={SUFFIX_CLASS}>
			<span className="flex items-center gap-xs">
				<span className="max-w-40 truncate">{value}</span>
			</span>
		</span>
	);
}

/** The inert cds Switch sm in a toggle row: the row is the control, so the switch only shows the state. */
function rowSwitch(checked: boolean)
{
	const state = checked
		?
			{
				"data-checked": "",
			}
		:
			{
				"data-unchecked": "",
			};
	return (
		<span inert className="flex shrink-0 items-center">
			<span role="switch" aria-checked={checked} data-size="sm" className={ROW_SWITCH_TRACK_CLASS} {...state}>
				<span className={ROW_SWITCH_KNOB_CLASS} {...state} />
			</span>
		</span>
	);
}

function srSubtitle(subtitle: string | undefined)
{
	return subtitle === undefined || subtitle === "" ? null : <span className="sr-only">{`, ${subtitle}`}</span>;
}

/** A command row's label, `(alias)` suffix and trailing plugin or Custom command subtitle. */
function commandRowContent(command: SlashCommand, label: string | undefined, query: string)
{
	const alias = matchingAlias(command, query);
	// Upstream's `subtitle ?? (query ? pluginLabel : undefined)`: one trailing span at most.
	const subtitle = command.shadowsHost === true ? "Custom command" : query === "" ? undefined : command.pluginName;
	return (
		<>
			<span className="min-w-0 truncate">
				<Highlighted text={label ?? slashCommandLabel(command)} query={query} />
			</span>
			{alias !== undefined && (
				<span className="min-w-0 truncate text-muted-as-secondary">
					<Highlighted text={`(${alias})`} query={query} highlightClassName="font-semibold text-primary" />
				</span>
			)}
			{subtitle !== undefined && (
				<span className="ms-auto shrink-0 ps-2 text-caption text-muted-as-secondary">{subtitle}</span>
			)}
		</>
	);
}

/** The highlighted row's tooltip: a command's description (plus its plugin line), or a host row's subtitle. */
function tooltipFor(item: SlashMenuItem | undefined):
	|
	  {
			description: string;
			detail: string | undefined;
	  }
	| undefined
{
	if (item?.type === "command")
	{
		const detail = item.command.pluginName === undefined ? undefined : `${item.command.pluginName} plugin`;
		return item.command.description === "" && detail === undefined
			? undefined
			:
				{
					description: item.command.description,
					detail,
				};
	}
	if ((item?.type === "host" || item?.type === "toggle") && item.subtitle !== undefined && item.subtitle !== "")
	{
		return {
			description: item.subtitle,
			detail: undefined,
		};
	}
	return undefined;
}

/** The open nested list: which submenu row (by label) and its highlighted row, -1 before the user enters it. */
export interface SlashSubmenuState
{
	label: string;
	highlighted: number;
}

/**
 * The claude.ai/code "/" popup: a menu in the scope's density (240px to 32rem wide, or upstream's fixed 260px under
 * the grouped menu's gate) above the composer with the highlighted row's description as a dark tooltip 8px past that
 * row. An open submenu row draws its nested list beside it. Keyboard focus stays in the editor, which drives
 * `highlighted`, `submenu` and `onAccept`.
 */
export function SlashCommandMenu({
	id,
	items,
	query,
	highlighted,
	onHighlight,
	onAccept,
	compactHost = false,
	grouped = false,
	submenu = null,
	onSubmenuHighlight,
	onActivate,
}: {
	id: string;
	items: readonly SlashMenuItem[];
	query: string;
	highlighted: number;
	onHighlight: (index: number) => void;
	onAccept: (command: SlashCommand) => void;
	/** Upstream's `compactSlashMenuHost` gate: the fixed 260px width and its height caps. */
	compactHost?: boolean;
	/** The grouped empty-query view, which has no height cap. */
	grouped?: boolean;
	submenu?: SlashSubmenuState | null;
	onSubmenuHighlight?: ((index: number) => void) | undefined;
	/** A click on a submenu or toggle row, with the row for a flyout to anchor to. */
	onActivate?: ((index: number, row: HTMLElement) => void) | undefined;
})
{
	const popupRef = useRef<HTMLDivElement>(null);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const nestedRef = useRef<HTMLDivElement>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);
	/* Upstream's row tip is the cds Tooltip popup, which hugs its wrapped text before it is placed. */
	const fitTooltip = useLazyShrinkwrap(
		{
			immediate: true,
		},
	);
	const tooltipCallbackRef = useCallback(
		(el: HTMLDivElement | null) =>
		{
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
	const viewportHeight = () =>
	{
		const height = scrollerRef.current?.clientHeight ?? 0;
		return height > 0 ? height : FALLBACK_VIEWPORT_HEIGHT;
	};
	const range = virtualized
		? rowWindow(offsets, sizing.gutter, scrollTop, viewportHeight())
		:
			{
				start: 0,
				end: items.length,
			};
	const activeItem = items[highlighted];
	const openSubmenu =
		activeItem?.type === "submenu" && activeItem.flyout === undefined && submenu?.label === activeItem.label
			? activeItem
			: undefined;
	/* Inside a submenu the main row keeps its highlight, but the tip belongs to the main list only. */
	const tip =
		openSubmenu !== undefined && submenu !== null && submenu.highlighted >= 0 ? undefined : tooltipFor(activeItem);

	/* Writes the tip's position straight to the DOM, like upstream's floating positioner, so following the row adds no React commit. */
	const placeTooltip = () =>
	{
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

	useLayoutEffect(() =>
	{
		const scroller = scrollerRef.current;
		const hovered = hoverHighlightRef.current;
		hoverHighlightRef.current = false;
		if (!hovered && virtualized && scroller && highlighted >= 0)
		{
			const next = scrollTopFor(offsets, sizing.gutter, highlighted, scroller.scrollTop, viewportHeight());
			if (next !== scroller.scrollTop) scroller.scrollTop = next;
			setScrollTop(scroller.scrollTop);
		}
		else if (!hovered)
		{
			scroller?.querySelector<HTMLElement>("[data-highlighted]")?.scrollIntoView(
				{
					block: "nearest",
				},
			);
		}
		placeTooltip();
	}, [highlighted, items, offsets, sizing.gutter, virtualized]);

	/* A row mounted by a scroll may be the highlighted one, so the tip follows each window change. */
	useLayoutEffect(placeTooltip, [range.start, range.end]);

	/* The nested list sits `right-start` (`left-start` in RTL) of its trigger, shifted up to stay on screen. */
	const nestedHighlighted = submenu?.highlighted ?? -1;
	useLayoutEffect(() =>
	{
		const nested = nestedRef.current;
		const popup = popupRef.current;
		const trigger = scrollerRef.current?.querySelector<HTMLElement>("[data-submenu-trigger][aria-expanded=true]");
		if (!nested || !popup || !trigger) return;
		const triggerRect = trigger.getBoundingClientRect();
		const popupRect = popup.getBoundingClientRect();
		if (getComputedStyle(popup).direction === "rtl")
			nested.style.right = `${popupRect.right - triggerRect.left + NESTED_OFFSET_X}px`;
		else nested.style.left = `${triggerRect.right - popupRect.left + NESTED_OFFSET_X}px`;
		const top = triggerRect.top - popupRect.top + NESTED_OFFSET_Y;
		nested.style.top = `${top}px`;
		const overflow = nested.getBoundingClientRect().bottom - (window.innerHeight - 8);
		if (overflow > 0) nested.style.top = `${top - overflow}px`;
	}, [openSubmenu]);
	useLayoutEffect(() =>
	{
		if (nestedHighlighted < 0) return;
		nestedRef.current?.querySelector<HTMLElement>("[data-highlighted]")?.scrollIntoView(
			{
				block: "nearest",
			},
		);
	}, [nestedHighlighted]);

	const highlightOnMove = (index: number) => () =>
	{
		if (index === highlighted) return;
		hoverHighlightRef.current = true;
		onHighlight(index);
	};

	const renderRow = (item: SlashMenuItem, index: number) =>
	{
		const common =
		{
			id: slashCommandOptionId(id, index),
			"data-highlighted": index === highlighted ? "" : undefined,
			onMouseMove: highlightOnMove(index),
		};
		switch (item.type)
		{
			/* Upstream draws headers and separators as plain divs: no role, not focusable. */
			case "section-header":
				return (
					<div key={`header:${index}`} className={sizing.header}>
						{item.label}
					</div>
				);
			case "separator":
				return <div key={`separator:${index}`} className={sizing.separator} />;
			case "loading":
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
										style={
										{
											width: "120px",
											height: "16px",
										}}
									/>
								</div>
							</div>
						</div>
					</div>
				);
			case "submenu":
				return (
					<div
						key={`submenu:${item.label}`}
						{...common}
						tabIndex={-1}
						role="menuitem"
						aria-haspopup="menu"
						aria-expanded={openSubmenu === item}
						data-submenu-trigger=""
						className={`${ROW_CLASS} ${sizing.row}`}
						onMouseDown={(e) =>
						{
							e.preventDefault();
							onActivate?.(index, e.currentTarget);
						}}
					>
						{/* A flyout row (Model, Environment) keeps the primary ink; a plain submenu is secondary. */}
						<span
							className={`min-w-0 flex-1 truncate${item.flyout === undefined ? " text-secondary" : ""}`}
						>
							<Highlighted text={item.label} query={query} />
						</span>
						{item.value !== undefined && rowSuffix(item.value)}
						<Icon name="CaretRight" size="sm" aria-hidden="true" className={CARET_CLASS} />
					</div>
				);
			case "toggle":
				return (
					<div
						key={`toggle:${item.label}`}
						{...common}
						tabIndex={-1}
						role="menuitemcheckbox"
						aria-checked={item.checked}
						aria-disabled={item.disabled || undefined}
						className={`${ROW_CLASS} ${sizing.row}${item.disabled ? " opacity-disabled" : ""}`}
						onMouseDown={(e) =>
						{
							e.preventDefault();
							if (!item.disabled) onActivate?.(index, e.currentTarget);
						}}
					>
						<span className="min-w-0 flex-1 truncate">
							<Highlighted text={item.label} query={query} />
						</span>
						{srSubtitle(item.subtitle)}
						{rowSwitch(item.checked)}
					</div>
				);
			case "host":
				return (
					<div
						key={`host:${item.label}`}
						{...common}
						tabIndex={-1}
						role="menuitem"
						aria-disabled={item.disabled || undefined}
						className={`${ROW_CLASS} ${sizing.row}${item.disabled && !item.undimmed ? " opacity-disabled" : ""}`}
						onMouseDown={(e) =>
						{
							e.preventDefault();
						}}
					>
						<span className="min-w-0 flex-1 truncate">
							<Highlighted text={item.label} query={query} />
						</span>
						{srSubtitle(item.subtitle)}
						{rowSuffix(item.value)}
					</div>
				);
			default:
				return (
					<div
						key={`${slashCommandRowKey(item.command)}:${item.label ?? ""}`}
						{...common}
						tabIndex={-1}
						role="menuitem"
						className={`${ROW_CLASS} ${sizing.row}`}
						onMouseDown={(e) =>
						{
							e.preventDefault();
							onAccept(item.command);
						}}
					>
						{commandRowContent(item.command, item.label, query)}
					</div>
				);
		}
	};

	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- cancels mousedown so the composer textarea keeps focus
		<div
			ref={popupRef}
			className={`${popupClass(compactHost, grouped)} ${sizing.popup}`}
			onMouseDown={(e) =>
			{
				e.preventDefault();
			}}
		>
			<div
				ref={scrollerRef}
				id={id}
				role="menu"
				aria-label="Slash commands"
				className={`relative min-h-0 overflow-y-auto overflow-x-hidden scroll-fade-y rounded-[inherit] ${sizing.scroller}`}
				onScroll={(e) =>
				{
					if (virtualized) setScrollTop(e.currentTarget.scrollTop);
					placeTooltip();
				}}
			>
				{virtualized && (
					<div
						aria-hidden
						style={
						{
							height: offsets[range.start],
						}}
						className="shrink-0"
					/>
				)}
				{items.slice(range.start, range.end).map((item, offset) => renderRow(item, range.start + offset))}
				{virtualized && (
					<div
						aria-hidden
						style={
						{
							height: (offsets.at(-1) ?? 0) - (offsets[range.end] ?? 0),
						}}
						className="shrink-0"
					/>
				)}
			</div>
			{openSubmenu !== undefined && (
				<div ref={nestedRef} className={`${NESTED_POPUP_CLASS} ${sizing.popup}`} data-slash-submenu="">
					<div
						id={`${id}-submenu`}
						role="menu"
						aria-label={openSubmenu.label}
						className={`relative min-h-0 overflow-y-auto overflow-x-hidden scroll-fade-y rounded-[inherit] ${sizing.scroller}`}
					>
						{openSubmenu.items.map((item, index) =>
							item.type === "command" ? (
								<div
									key={`${slashCommandRowKey(item.command)}:${item.label ?? ""}`}
									id={slashSubmenuOptionId(id, index)}
									role="menuitem"
									tabIndex={-1}
									data-highlighted={index === nestedHighlighted ? "" : undefined}
									className={`${ROW_CLASS} ${sizing.row}`}
									onMouseMove={() =>
									{
										if (index !== nestedHighlighted) onSubmenuHighlight?.(index);
									}}
									onMouseDown={(e) =>
									{
										e.preventDefault();
										onAccept(item.command);
									}}
								>
									{commandRowContent(item.command, item.label, query)}
								</div>
							) : null,
						)}
					</div>
				</div>
			)}
			{tip !== undefined && (
				<div ref={tooltipCallbackRef} role="tooltip" className={ROW_TOOLTIP_CLASS}>
					<span className="min-w-0 break-words">
						{/* With no description, upstream shows the plugin line as the tooltip's content. */}
						<span ref={clampRef} className="line-clamp-[10]">
							{tip.description === "" ? tip.detail : <Highlighted text={tip.description} query={query} />}
						</span>
						{tip.description !== "" && tip.detail !== undefined && (
							<span ref={detailRef} data-slash-tooltip-detail="" className={TOOLTIP_DETAIL_CLASS}>
								{tip.detail}
							</span>
						)}
					</span>
				</div>
			)}
		</div>
	);
}
