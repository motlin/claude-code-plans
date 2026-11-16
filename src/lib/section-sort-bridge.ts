import type {PointerEvent} from "react";

/** One sortable section's drag state, pushed by the lazy dnd bindings (upstream `Zp` `setDrag`). */
export interface SectionDrag
{
	/** dnd-kit's pointer-down listener on the header (PointerSensor's activator). */
	readonly onPointerDown: ((event: PointerEvent<HTMLElement>) => void) | undefined;
	readonly setActivatorNodeRef: (element: HTMLElement | null) => void;
	readonly transform: string | undefined;
	readonly transition: string | undefined;
	readonly isDragging: boolean;
}

/**
 * Upstream `Zp`: the bridge between the section wrappers and the lazily loaded dnd-kit bindings.
 * Wrappers register their elements; the bindings sort those elements and push each section's drag
 * state back, so dnd-kit stays out of the entry bundle until there are two sections to sort.
 */
export class SectionSortBridge
{
	private readonly elements = new Map<string, HTMLElement>();
	private readonly drags = new Map<string, SectionDrag>();
	private readonly listeners = new Map<string, Set<() => void>>();

	element(id: string): HTMLElement | null
	{
		return this.elements.get(id) ?? null;
	}

	setElement(id: string, element: HTMLElement | null): void
	{
		if (this.element(id) === element) return;
		if (element === null) this.elements.delete(id);
		else this.elements.set(id, element);
		this.notify(id);
	}

	drag(id: string): SectionDrag | null
	{
		return this.drags.get(id) ?? null;
	}

	setDrag(id: string, drag: SectionDrag | null): void
	{
		if (drag === null) this.drags.delete(id);
		else this.drags.set(id, drag);
		this.notify(id);
	}

	subscribe(id: string, listener: () => void): () => void
	{
		const set = this.listeners.get(id) ?? new Set();
		set.add(listener);
		this.listeners.set(id, set);
		return () =>
		{
			set.delete(listener);
		};
	}

	private notify(id: string): void
	{
		for (const listener of this.listeners.get(id) ?? []) listener();
	}
}
