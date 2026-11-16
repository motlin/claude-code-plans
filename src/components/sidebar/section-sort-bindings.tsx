import
{
	type CollisionDetection,
	DndContext,
	type DragEndEvent,
	type DragStartEvent,
	type Modifier,
	PointerSensor,
	type UniqueIdentifier,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {SortableContext, useSortable, verticalListSortingStrategy} from "@dnd-kit/sortable";
import {CSS} from "@dnd-kit/utilities";
import {type PointerEvent, useLayoutEffect, useMemo, useRef, useSyncExternalStore} from "react";

import {isMotionReduced} from "../../lib/reduced-motion";
import type {SectionSortBridge} from "../../lib/section-sort-bridge";
import
{
	clampSectionDrag,
	liftedInsets,
	type SectionDragBounds,
	sectionDragBounds,
	sectionSlotForOffset,
} from "../../lib/section-sort-physics";
import {cssDurationMs} from "../../lib/segmented-flip";
import {LIFTED_CLASS} from "./sortable-section-classes";

const POINTER_SENSOR_OPTIONS =
{
	activationConstraint:
	{
		distance: 8,
	},
};
const ACCESSIBILITY =
{
	screenReaderInstructions:
	{
		draggable: "",
	},
};

function scrollParent(element: Element): Element | null
{
	for (let node = element.parentElement; node !== null; node = node.parentElement)
	{
		if (/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) return node;
	}
	return null;
}

function writeLiftedInsets(element: HTMLElement): void
{
	const label = element.querySelector("[data-sidebar-group-label]");
	const name = element.querySelector("[data-group-name]");
	if (label === null || name === null) return;
	const insets = liftedInsets(
		element.getBoundingClientRect(),
		label.getBoundingClientRect(),
		name.getBoundingClientRect(),
		parseFloat(getComputedStyle(label).paddingInlineStart) || 0,
	);
	element.style.setProperty("--lifted-top", `${insets.top}px`);
	element.style.setProperty("--lifted-x", `${insets.x}px`);
	element.style.setProperty("--lifted-bottom", `${insets.bottom}px`);
}

/**
 * Upstream `E` + `Kr`: once the dropped section has re-rendered in its new slot, slide it there
 * from where it was let go over `--cds-dur-base` (200ms; none under reduced motion) with
 * `--cds-ease-out`, still lifted, unless a new drag has picked it up meanwhile.
 */
function animateSectionDrop(element: HTMLElement, from: DOMRect, draggingAgain: () => boolean): void
{
	const style = getComputedStyle(element);
	const duration = isMotionReduced() ? 0 : cssDurationMs(style, "--cds-dur-base") || 200;
	const easing = style.getPropertyValue("--cds-ease-out").trim() || "ease-out";
	requestAnimationFrame(() =>
	{
		const delta = from.top - element.getBoundingClientRect().top;
		if (delta === 0 || duration === 0 || typeof element.animate !== "function") return;
		element.classList.add(LIFTED_CLASS);
		element.style.zIndex = "1";
		const animation = element.animate(
			[
				{
					transform: `translate3d(0, ${delta}px, 0)`,
				},
				{
					transform: "none",
				},
			],
			{
				duration,
				easing,
			},
		);
		const settle = () =>
		{
			if (draggingAgain()) return;
			element.classList.remove(LIFTED_CLASS);
			element.style.zIndex = "";
		};
		animation.onfinish = settle;
		animation.oncancel = settle;
	});
}

/**
 * Upstream's collision detection over the sortable sections in top order: the dragged section
 * lands in the slot whose midpoint its top (moving up) or bottom (moving down) has crossed.
 */
const collisionDetection: CollisionDetection = ({active, collisionRect, droppableRects, droppableContainers}) =>
{
	const activeRect = droppableRects.get(active.id);
	const ordered = droppableContainers
		.flatMap(({id}) =>
		{
			const rect = droppableRects.get(id);
			return rect === undefined
				? []
				: [
						{
							id,
							rect,
						},
					];
		})
		.toSorted((left, right) => left.rect.top - right.rect.top);
	const index = ordered.findIndex(({id}) => id === active.id);
	if (activeRect === undefined || index === -1) return [];
	const tops = ordered.map(({rect}) => rect.top);
	const heights = ordered.map(({rect}) => rect.height);
	tops[index] = activeRect.top;
	heights[index] = activeRect.height;
	const slot = sectionSlotForOffset(tops, heights, index, collisionRect.top - activeRect.top);
	const target = ordered[slot];
	return target === undefined
		? []
		: [
				{
					id: target.id,
				},
			];
};

/** Upstream's headless `S`: one section's `useSortable`, its node the bridge's wrapper, its state pushed back. */
function SectionBinding({id, bridge}: {id: string; bridge: SectionSortBridge})
{
	const {setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging} = useSortable(
		{
			id,
		},
	);
	const element = useSyncExternalStore(
		(listener) => bridge.subscribe(id, listener),
		() => bridge.element(id),
		() => null,
	);
	useLayoutEffect(() =>
	{
		setNodeRef(element);
	}, [element, setNodeRef]);
	const translate = CSS.Translate.toString(transform);
	const listener = listeners?.["onPointerDown"];
	const onPointerDown = useMemo(
		() =>
			listener === undefined
				? undefined
				: (event: PointerEvent<HTMLElement>) =>
					{
						// dnd-kit types its synthetic listeners as bare `Function`s.
						Reflect.apply(listener, undefined, [event]);
					},
		[listener],
	);
	useLayoutEffect(() =>
	{
		bridge.setDrag(
			id,
			{
				onPointerDown,
				setActivatorNodeRef,
				transform: translate,
				transition,
				isDragging,
			},
		);
	}, [bridge, id, onPointerDown, setActivatorNodeRef, translate, transition, isDragging]);
	useLayoutEffect(
		() => () =>
		{
			bridge.setDrag(id, null);
		},
		[bridge, id],
	);
	return null;
}

/**
 * Upstream `ProjectReorderBindings` (lazy `sidebar_project_reorder_dnd`): the manual sections as a
 * dnd-kit sortable list. A header pressed and moved 8px lifts its whole section in place, y-only and
 * clamped between the first manual section's top and the last one's bottom, while the others slide
 * aside; it drops into the slot whose midpoint it crossed. Pinned and Recents are never part of it.
 */
export default function SectionSortBindings({
	bridge,
	sectionIds,
	onMove,
}: {
	bridge: SectionSortBridge;
	sectionIds: readonly string[];
	/** Commits a drop: the dragged section takes the place of the one it was dropped over. */
	onMove: (activeId: string, overId: string) => void;
})
{
	const dragging = useRef<string | null>(null);
	const bounds = useRef<
		SectionDragBounds &
		{
			scrollTop: number;
		}
	>(
		{
			up: 0,
			down: 0,
			scrollTop: 0,
		},
	);
	const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));
	const modifiers = useMemo<Modifier[]>(
		() => [
			({transform, scrollableAncestors}) =>
				clampSectionDrag(
					transform,
					bounds.current,
					scrollableAncestors[0]?.scrollTop ?? bounds.current.scrollTop,
				),
		],
		[],
	);

	const onDragStart = ({active}: DragStartEvent) =>
	{
		const id = String(active.id);
		dragging.current = id;
		document.documentElement.setAttribute("data-session-dragging", "");
		const element = bridge.element(id);
		if (element === null) return;
		if (typeof element.getAnimations === "function")
		{
			for (const animation of element.getAnimations()) animation.cancel();
		}
		writeLiftedInsets(element);
		bounds.current =
		{
			...sectionDragBounds(
				element.getBoundingClientRect(),
				sectionIds.flatMap((each) => bridge.element(each)?.getBoundingClientRect() ?? []),
			),
			scrollTop: scrollParent(element)?.scrollTop ?? 0,
		};
	};
	const endDrag = (activeId: UniqueIdentifier) =>
	{
		const id = String(activeId);
		dragging.current = null;
		document.documentElement.removeAttribute("data-session-dragging");
		const element = bridge.element(id);
		if (element !== null)
			animateSectionDrop(element, element.getBoundingClientRect(), () => dragging.current === id);
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={collisionDetection}
			modifiers={modifiers}
			accessibility={ACCESSIBILITY}
			onDragStart={onDragStart}
			onDragEnd={({active, over}: DragEndEvent) =>
			{
				endDrag(active.id);
				if (over !== null && over.id !== active.id) onMove(String(active.id), String(over.id));
			}}
			onDragCancel={({active}) =>
			{
				endDrag(active.id);
			}}
		>
			<SortableContext items={[...sectionIds]} strategy={verticalListSortingStrategy}>
				{sectionIds.map((id) => (
					<SectionBinding key={id} id={id} bridge={bridge} />
				))}
			</SortableContext>
		</DndContext>
	);
}
