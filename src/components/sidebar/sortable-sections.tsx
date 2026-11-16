import
{
	createContext,
	lazy,
	type PointerEvent,
	type ReactNode,
	Suspense,
	useCallback,
	useContext,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";

import {SectionSortBridge} from "../../lib/section-sort-bridge";
import {ignoresSectionActivation} from "../../lib/section-sort-physics";
import {LIFTED_CLASS, SORTABLE_SECTION_CLASS} from "./sortable-section-classes";

// Upstream's `uK` tier-T3 chunk: dnd-kit loads only once there are two sections to sort.
const SectionSortBindings = lazy(async () => await import("./section-sort-bindings"));

/** The header label row's drag hooks: upstream `no`'s activator ref and filtered pointer-down. */
export interface SectionActivator
{
	readonly setActivatorNodeRef: (element: HTMLElement | null) => void;
	readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}

const SectionSortBridgeContext = createContext<SectionSortBridge | null>(null);

/**
 * Upstream `gJ`: the manual sections' sort provider. Its bridge carries each wrapper's element to
 * the lazy dnd-kit bindings and their drag state back; the bindings load only with two or more
 * sections (upstream `count > 1`), so a lone section can't be dragged.
 */
export function SortableSections({
	sectionIds,
	onMove,
	children,
}: {
	sectionIds: readonly string[];
	/** Commits a drop: the dragged section takes the place of the one it was dropped over. */
	onMove: (activeId: string, overId: string) => void;
	children: ReactNode;
})
{
	const [bridge] = useState(() => new SectionSortBridge());
	return (
		<SectionSortBridgeContext.Provider value={bridge}>
			{children}
			{sectionIds.length > 1 && (
				<Suspense fallback={null}>
					<SectionSortBindings bridge={bridge} sectionIds={sectionIds} onMove={onMove} />
				</Suspense>
			)}
		</SectionSortBridgeContext.Provider>
	);
}

const NO_SUBSCRIPTION = () => () =>
{
};

/**
 * Upstream `sx`: one manual section's `df-sortable-section` wrapper, the sortable node, lifted
 * (`df-section-lifted`, z-index 1) while dragged. `children` gets the header's activator.
 */
export function SortableSection({
	id,
	children,
}: {
	id: string;
	children: (activator: SectionActivator | undefined) => ReactNode;
})
{
	const bridge = useContext(SectionSortBridgeContext);
	const subscribe = useCallback(
		(listener: () => void) => (bridge === null ? NO_SUBSCRIPTION() : bridge.subscribe(id, listener)),
		[bridge, id],
	);
	const drag = useSyncExternalStore(
		subscribe,
		() => bridge?.drag(id) ?? null,
		() => null,
	);
	const ref = useCallback(
		(element: HTMLDivElement | null) =>
		{
			bridge?.setElement(id, element);
		},
		[bridge, id],
	);
	const onPointerDown = drag?.onPointerDown;
	const setActivatorNodeRef = drag?.setActivatorNodeRef;
	const activator = useMemo<SectionActivator | undefined>(
		() =>
			onPointerDown === undefined || setActivatorNodeRef === undefined
				? undefined
				:
					{
						setActivatorNodeRef,
						onPointerDown: (event) =>
						{
							if (!ignoresSectionActivation(event.target, event.currentTarget)) onPointerDown(event);
						},
					},
		[onPointerDown, setActivatorNodeRef],
	);
	const isDragging = drag?.isDragging === true;
	return (
		<div
			ref={ref}
			style={
			{
				transform: drag?.transform,
				transition: drag?.transition,
				zIndex: isDragging ? 1 : undefined,
			}}
			className={isDragging ? `${SORTABLE_SECTION_CLASS} ${LIFTED_CLASS}` : SORTABLE_SECTION_CLASS}
			data-gap-after=""
		>
			{children(activator)}
		</div>
	);
}
