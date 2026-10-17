import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {CSS} from "@dnd-kit/utilities";
import {ChevronRight} from "lucide-react";
import {useId, type MouseEvent, type ReactNode} from "react";

import {RAIL_CARD_CLASS} from "./rail-row";

import {
	HIDEABLE_RAIL_SECTIONS,
	isRailSectionOpen,
	isRailSectionsPristine,
	orderRailSections,
	RailSectionIdSchema,
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
import {
	ContextMenu,
	ContextMenuTrigger,
	MenuCheckboxItem,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuSeparator,
} from "../ui/menu";

/** One card with content; a section with nothing to show passes no card at all. */
export interface RailCard {
	id: RailSectionId;
	/** Right-aligned header text, e.g. `1 of 3`. */
	summary?: string | undefined;
	body: ReactNode;
}

const HEAD_CLASS =
	"group/railhead flex min-h-6.5 w-full min-w-0 cursor-pointer items-center gap-1 rounded-r5 px-1 text-left text-[12px]/[15px] font-medium text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100";

/** Upstream's header menu: a Show checkbox per hideable section, then Reset to defaults. */
function RailHeaderMenu({sections}: {sections: RailSectionsState}) {
	return (
		<MenuContent density="compact" className="w-[152px]">
			<MenuLabel>Show</MenuLabel>
			{HIDEABLE_RAIL_SECTIONS.map((id) => (
				<MenuCheckboxItem
					key={id}
					checked={!sections.hidden.includes(id)}
					onCheckedChange={() => {
						toggleRailSectionHidden(id);
					}}
				>
					{RAIL_SECTION_TITLES[id]}
				</MenuCheckboxItem>
			))}
			<MenuSeparator />
			<MenuItem disabled={isRailSectionsPristine(sections)} onSelect={resetRailSections}>
				Reset to defaults
			</MenuItem>
		</MenuContent>
	);
}

/** Upstream's grip: a 2x3 dot grid at 75%, shown while the header is hovered or the grip has focus. */
function GripDots() {
	return (
		<span aria-hidden className="grid size-5 scale-75 grid-cols-2 content-center justify-center gap-[3px]">
			{Array.from({length: 6}, (_, index) => (
				<span key={index} className="size-[3px] rounded-full bg-current" />
			))}
		</span>
	);
}

function RailSection({
	card,
	open,
	sections,
	onToggle,
}: {
	card: RailCard;
	open: boolean;
	sections: RailSectionsState;
	onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
	const headingId = useId();
	const {attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging} = useSortable({
		id: card.id,
	});
	const title = RAIL_SECTION_TITLES[card.id];
	return (
		<ContextMenu>
			<section
				ref={setNodeRef}
				style={{transform: CSS.Translate.toString(transform), transition}}
				{...(isDragging ? {"data-dragging": ""} : {})}
				data-rail-section={card.id}
				{...(open ? {"data-open": ""} : {})}
				aria-labelledby={headingId}
				className={RAIL_CARD_CLASS}
			>
				<ContextMenuTrigger className="group/railtop relative flex min-h-6.5 min-w-0 items-center gap-1 px-2">
					<h3
						id={headingId}
						className="flex min-w-0 flex-1 rounded group-data-[popup-open]/railtop:bg-alpha-1"
					>
						<button type="button" aria-expanded={open} onClick={onToggle} className={HEAD_CLASS}>
							<span className="shrink-0">{RAIL_SECTION_TITLES[card.id]}</span>
							<ChevronRight
								aria-hidden
								className={`size-3 shrink-0 text-ink-muted transition-transform ${open ? "rotate-90" : ""}`}
							/>
							{card.summary !== undefined && (
								<span
									data-rail-summary=""
									className="ms-auto truncate ps-1.5 text-[12px]/[15px] font-normal text-ink-muted group-hover/railtop:opacity-0 group-has-[[data-rail-grip]:focus-visible]/railtop:opacity-0"
								>
									{card.summary}
								</span>
							)}
						</button>
					</h3>
					<div
						ref={setActivatorNodeRef}
						data-rail-grip=""
						{...attributes}
						{...listeners}
						aria-label={`Reorder ${title}`}
						className="group/railgrip absolute inset-y-0 end-0 flex w-20 cursor-grab touch-none items-center justify-end pe-2.5 text-ink-muted opacity-0 group-hover/railtop:opacity-100 focus-visible:opacity-100 focus-visible:outline-none active:cursor-grabbing"
					>
						<GripDots />
					</div>
				</ContextMenuTrigger>
				{open && (
					<div data-rail-body="" className="px-2">
						{card.body}
					</div>
				)}
			</section>
			<RailHeaderMenu sections={sections} />
		</ContextMenu>
	);
}

/**
 * Upstream's session rail: `<aside aria-label="Session details">` holding
 * collapsible cards, each folded per session. Alt-click on a header sets every
 * card to that card's new state; a header's grip drags it to a new place
 * (after 6px, or with the keyboard), saved for every session.
 */
export function SessionRail({sessionId, cards}: {sessionId: string; cards: readonly RailCard[]}) {
	const sections = useRailSectionsState();
	const byId = new Map(cards.map((card) => [card.id, card]));
	const shownIds = orderRailSections(
		cards.filter((card) => !sections.hidden.includes(card.id)).map((card) => card.id),
		sections.order,
	);
	const shown = shownIds.flatMap((id) => byId.get(id) ?? []);
	const sensors = useSensors(
		useSensor(PointerSensor, {activationConstraint: {distance: 6}}),
		useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates}),
	);
	const onDragEnd = ({active, over}: DragEndEvent) => {
		const from = RailSectionIdSchema.safeParse(active.id);
		const to = RailSectionIdSchema.safeParse(over?.id);
		if (from.success && to.success) reorderRailSections(shownIds, from.data, to.data);
	};
	return (
		<aside
			aria-label="Session details"
			tabIndex={-1}
			className="flex h-full min-h-0 w-[var(--session-rail-w,17.5rem)] flex-col font-sans outline-none"
		>
			<div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain p-px [scrollbar-width:none]">
				<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
					<SortableContext items={shownIds} strategy={verticalListSortingStrategy}>
						{shown.map((card) => {
							const open = isRailSectionOpen(sections, sessionId, card.id);
							return (
								<RailSection
									key={card.id}
									card={card}
									open={open}
									sections={sections}
									onToggle={(event) => {
										if (event.altKey) {
											setRailSectionsOpen(
												sessionId,
												shown.map((each) => each.id),
												!open,
											);
										} else {
											toggleRailSection(sessionId, card.id);
										}
									}}
								/>
							);
						})}
					</SortableContext>
				</DndContext>
			</div>
		</aside>
	);
}
