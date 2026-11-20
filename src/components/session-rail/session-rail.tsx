import
{
	closestCenter,
	DndContext,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragStartEvent,
} from "@dnd-kit/core";
import
{
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {CSS} from "@dnd-kit/utilities";
import {ChevronRight} from "lucide-react";
import
{
	useCallback,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type MouseEvent,
	type ReactNode,
} from "react";

import {RailAsideClassContext} from "./rail-aside-class";
import {animateRailDrop, blurOnPointerDragStart, lockRailDragToVerticalAxis} from "./rail-drag-physics";
import {RAIL_CARD_CLASS, RAIL_SLOT_CLASS} from "./rail-row";
import {railSectionAccessibility} from "./rail-section-accessibility";
import {usageFillClass} from "./usage-fill";

import
{
	FIRST_CARD_RECORD_DEBOUNCE_MS,
	HIDEABLE_RAIL_SECTIONS,
	isRailSectionOpen,
	isRailSectionsPristine,
	orderRailSections,
	railFirstCardKey,
	RailSectionIdSchema,
	readRailSectionsState,
	recordRailFirstCardHeight,
	reorderRailSections,
	resetRailSections,
	toggleRailSectionHidden,
	RAIL_SECTION_TITLES,
	setRailSectionsOpen,
	toggleRailSection,
	useRailSectionsState,
	type RailSectionId,
	type RailSectionsState,
} from "../../lib/session-rail-store";
import {Icon} from "../ui/icon";
import {TooltipPortalContext} from "../ui/tooltip-portal-context";
import
{
	ContextMenu,
	ContextMenuTrigger,
	MenuCheckboxItem,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuSeparator,
} from "../ui/menu";

/** One card with content; a section with nothing to show passes no card at all. */
export interface RailCard
{
	id: RailSectionId;
	/** Right-aligned header text, e.g. `1 of 3`. */
	summary?: string | undefined;
	/** Upstream's percentage rollup: `N%` plus a 24x10 mini meter, in place of `summary`. */
	rollupPct?: number | undefined;
	/** Upstream's warning rollup: `summary` in the warning colour plus a Warning icon with this alt, in place of the percentage. */
	rollupWarning?: string | undefined;
	body: ReactNode;
}

const RAIL_DRAG_MODIFIERS = [lockRailDragToVerticalAxis];

/** Upstream's `R0`: an open card's caret shows only while its header is hovered, focused within or touched. */
const OPEN_CARET_CLASS =
	"opacity-0 group-hover/railtop:opacity-100 group-focus-within/railtop:opacity-100 touch:opacity-100";

const HEAD_CLASS =
	"group/railhead relative flex min-h-6 w-full min-w-0 cursor-pointer items-center gap-1 rounded-r5 px-2 text-left text-[12px]/[16px] font-medium text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/** Upstream's header menu: a Show checkbox per hideable section, then Reset to defaults. */
function RailHeaderMenu({sessionId, sections}: {sessionId: string; sections: RailSectionsState})
{
	return (
		<MenuContent density="compact">
			<MenuLabel>Show</MenuLabel>
			{HIDEABLE_RAIL_SECTIONS.map((id) => (
				<MenuCheckboxItem
					key={id}
					checked={!sections.hidden.includes(id)}
					onCheckedChange={() =>
					{
						toggleRailSectionHidden(id);
					}}
				>
					{RAIL_SECTION_TITLES[id]}
				</MenuCheckboxItem>
			))}
			<MenuSeparator />
			<MenuItem
				disabled={isRailSectionsPristine(sections, sessionId)}
				onSelect={() =>
				{
					resetRailSections(sessionId);
				}}
			>
				Reset to defaults
			</MenuItem>
		</MenuContent>
	);
}

/** Upstream's header rollup: the rounded percent beside a 24x10 pill meter. */
function RollupSummary({pct}: {pct: number})
{
	const clamped = Math.max(0, Math.min(100, pct));
	return (
		<span className="flex items-center justify-end gap-1.5">
			<span className="tabular-nums">{clamped}%</span>
			<span
				aria-hidden
				data-testid="rail-meter"
				className="flex h-2.5 w-6 shrink-0 rounded-full bg-alpha-2 p-0.5"
			>
				<span
					className={`h-full min-w-1.5 rounded-full ${usageFillClass(clamped)}`}
					style={
					{
						width: `${clamped}%`,
					}}
				/>
			</span>
		</span>
	);
}

/** Upstream's `Ve` (cdbb20c70): the header rollup as a warning, a percentage with its mini meter, or plain text. */
function railSummary(card: RailCard): ReactNode
{
	if (card.rollupWarning !== undefined)
	{
		return (
			<span className="flex items-center justify-end gap-1.5">
				<span className="min-w-0 truncate text-warning">{card.summary}</span>
				<Icon name="Warning" size="xs" className="shrink-0 text-fill-warning" alt={card.rollupWarning} />
			</span>
		);
	}
	return card.rollupPct === undefined ? card.summary : <RollupSummary pct={card.rollupPct} />;
}

/**
 * Upstream's grip: a 2x3 dot grid at 75% inside a 20px frame that takes the
 * focus ring, shown while the header is hovered or the grip has focus.
 */
function GripDots()
{
	return (
		<span
			aria-hidden
			className="flex size-5 items-center justify-center rounded group-focus-visible/railgrip:shadow-focus"
		>
			<span className="grid grid-cols-2 gap-[3px] scale-75">
				{Array.from(
					{
						length: 6,
					},
					(_, index) => (
						<i key={index} className="size-0.5 rounded-full bg-current" />
					),
				)}
			</span>
		</span>
	);
}

/**
 * Upstream's `aF` with `recordHeight`: while the card slot resizes, its height is recorded once it
 * has held still for 1000ms, keyed by the rail config at that moment. Upstream also waits for the
 * session details to answer; local mounts the rail only once the session has loaded.
 */
function useRecordFirstCardHeight(sessionId: string, enabled: boolean): (node: HTMLElement | null) => void
{
	const [node, setNode] = useState<HTMLElement | null>(null);
	useEffect(() =>
	{
		if (!enabled || node === null || typeof ResizeObserver === "undefined") return undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const observer = new ResizeObserver(() =>
		{
			clearTimeout(timer);
			timer = setTimeout(() =>
			{
				recordRailFirstCardHeight(
					sessionId,
					railFirstCardKey(readRailSectionsState(), sessionId),
					node.getBoundingClientRect().height,
				);
			}, FIRST_CARD_RECORD_DEBOUNCE_MS);
		});
		observer.observe(node);
		return () =>
		{
			clearTimeout(timer);
			observer.disconnect();
		};
	}, [sessionId, enabled, node]);
	return setNode;
}

function RailSection({
	sessionId,
	card,
	open,
	sections,
	recordHeight,
	onToggle,
}: {
	sessionId: string;
	card: RailCard;
	open: boolean;
	sections: RailSectionsState;
	/** Upstream's first visible card remembers its height for the next load's skeleton. */
	recordHeight: boolean;
	onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
})
{
	const recordRef = useRecordFirstCardHeight(sessionId, recordHeight);
	const headingId = useId();
	const {attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging} = useSortable(
		{
			id: card.id,
			attributes:
			{
				roleDescription: "Draggable section",
			},
		},
	);
	const title = RAIL_SECTION_TITLES[card.id];
	const slotRef = useCallback(
		(node: HTMLDivElement | null) =>
		{
			setNodeRef(node);
			recordRef(node);
		},
		[setNodeRef, recordRef],
	);
	// Upstream's grip is keyboard-only: pointer drags start from the grab zone inside the header button.
	const keyboardListeners = Object.fromEntries(
		Object.entries(listeners ?? {}).filter(([name]) => name !== "onPointerDown"),
	);
	return (
		// Upstream's `Nj` slot: the sortable node, lifted above its siblings while dragging.
		<div
			ref={slotRef}
			data-rail-card={card.id}
			style={
			{
				transform: CSS.Translate.toString(transform),
				transition,
				zIndex: isDragging ? 1 : undefined,
			}}
			{...(isDragging
				?
					{
						"data-dragging": "",
					}
				: {})}
			className={isDragging ? `${RAIL_SLOT_CLASS} bg-page` : RAIL_SLOT_CLASS}
		>
			<ContextMenu>
				<section
					data-rail-section={card.id}
					{...(open
						?
							{
								"data-open": "",
							}
						: {})}
					aria-labelledby={headingId}
					className={RAIL_CARD_CLASS}
				>
					<ContextMenuTrigger className="group/railtop relative flex min-h-6 min-w-0 items-center gap-1.5 px-1.5">
						<div
							id={headingId}
							className="flex min-w-0 flex-1 rounded group-data-[popup-open]/railtop:bg-alpha-1"
						>
							<button
								type="button"
								aria-expanded={open}
								onClick={onToggle}
								onPointerDown={(event) =>
								{
									// Upstream's grab zone sits inside the trigger: a press there can start a drag, and a click still toggles.
									if (event.target instanceof Element && event.target.closest("[data-rail-grab]"))
									{
										listeners?.["onPointerDown"]?.(event);
									}
								}}
								className={HEAD_CLASS}
							>
								<span className="shrink-0">{RAIL_SECTION_TITLES[card.id]}</span>
								<ChevronRight
									aria-hidden
									className={`size-3 shrink-0 text-ink-muted transition-transform motion-reduce:transition-none ${open ? `rotate-90 ${OPEN_CARET_CLASS}` : ""}`}
								/>
								{(card.summary !== undefined || card.rollupPct !== undefined) && (
									<span
										data-rail-summary=""
										{...(open
											?
												{
													"aria-hidden": true,
												}
											: {})}
										className={`ms-auto min-w-0 truncate ps-sm text-footnote font-normal text-muted-as-secondary group-hover/railtop:opacity-0 group-has-[[data-rail-grip]:focus-visible]/railtop:opacity-0 ${open ? "invisible" : ""}`}
									>
										{railSummary(card)}
									</span>
								)}
								<span
									aria-hidden
									data-rail-grab=""
									className="absolute inset-y-0 end-0 w-20 cursor-grab touch-none active:cursor-grabbing"
								/>
							</button>
						</div>
						<div
							ref={setActivatorNodeRef}
							data-rail-grip=""
							{...attributes}
							{...keyboardListeners}
							aria-label={`Reorder ${title}`}
							className="group/railgrip pointer-events-none absolute inset-y-0 end-0 flex w-20 items-center justify-end pe-2.5 text-ink-muted opacity-0 group-hover/railtop:opacity-100 focus-visible:opacity-100 outline-hidden"
						>
							<GripDots />
						</div>
					</ContextMenuTrigger>
					{open && (
						<div data-rail-body="" className="flex flex-col px-1.5 pt-1">
							{card.body}
						</div>
					)}
				</section>
				<RailHeaderMenu sessionId={sessionId} sections={sections} />
			</ContextMenu>
		</div>
	);
}

/**
 * Upstream's session rail: `<aside aria-label="Session details">` holding
 * collapsible cards, each folded per session. Alt-click on a header sets every
 * card to that card's new state; a header's grip drags it to a new place
 * (after 6px, or with the keyboard), saved for every session.
 */
export function SessionRail({sessionId, cards}: {sessionId: string; cards: readonly RailCard[]})
{
	const sections = useRailSectionsState();
	const sizeClass = useContext(RailAsideClassContext);
	const byId = new Map(cards.map((card) => [card.id, card]));
	const shownIds = orderRailSections(
		cards.filter((card) => !sections.hidden.includes(card.id)).map((card) => card.id),
		sections.order,
	);
	const shown = shownIds.flatMap((id) => byId.get(id) ?? []);
	const sensors = useSensors(
		useSensor(
			PointerSensor,
			{
				activationConstraint:
				{
					distance: 6,
				},
			},
		),
		useSensor(
			KeyboardSensor,
			{
				coordinateGetter: sortableKeyboardCoordinates,
			},
		),
	);
	const listRef = useRef<HTMLDivElement>(null);
	const [drop, setDrop] = useState<
	{
		id: RailSectionId;
		top: number;
	} | null>(null);
	useLayoutEffect(() =>
	{
		if (drop === null) return;
		const element = listRef.current?.querySelector<HTMLElement>(`[data-rail-card="${drop.id}"]`);
		if (element) animateRailDrop(element, drop.top);
	}, [drop]);
	const onDragStart = ({activatorEvent}: DragStartEvent) =>
	{
		blurOnPointerDragStart(activatorEvent);
	};
	const onDragEnd = ({active, over}: DragEndEvent) =>
	{
		const from = RailSectionIdSchema.safeParse(active.id);
		const to = RailSectionIdSchema.safeParse(over?.id);
		if (!from.success) return;
		if (to.success) reorderRailSections(from.data, to.data);
		const dropTop = active.rect.current.translated?.top;
		if (dropTop !== undefined)
			setDrop(
				{
					id: from.data,
					top: dropTop,
				},
			);
	};
	return (
		<aside
			aria-label="Session details"
			tabIndex={-1}
			data-focus-region="session-details"
			className={`relative flex min-h-0 flex-col font-sans outline-none ${sizeClass}`}
		>
			<div
				ref={listRef}
				className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain p-px [scrollbar-width:none] [[data-session-rail-flat]_&]:gap-0 [[data-session-rail-flat]_&]:p-0"
			>
				{/* The list's overflow clips at the rail's edges, so its tooltips portal over the viewport. */}
				<TooltipPortalContext.Provider value>
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						modifiers={RAIL_DRAG_MODIFIERS}
						autoScroll={false}
						onDragStart={onDragStart}
						onDragEnd={onDragEnd}
						accessibility={railSectionAccessibility(shownIds)}
					>
						<SortableContext items={shownIds} strategy={verticalListSortingStrategy}>
							{shown.map((card) =>
							{
								const open = isRailSectionOpen(sections, sessionId, card.id);
								return (
									<RailSection
										key={card.id}
										sessionId={sessionId}
										card={card}
										open={open}
										sections={sections}
										recordHeight={card.id === shown[0]?.id}
										onToggle={(event) =>
										{
											if (event.altKey)
											{
												setRailSectionsOpen(
													sessionId,
													shown.map((each) => each.id),
													!open,
												);
											}
											else
											{
												toggleRailSection(sessionId, card.id);
											}
										}}
									/>
								);
							})}
						</SortableContext>
					</DndContext>
				</TooltipPortalContext.Provider>
			</div>
		</aside>
	);
}
