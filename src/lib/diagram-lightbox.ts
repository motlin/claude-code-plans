import {createContext, useSyncExternalStore} from "react";

/*
 * Upstream's document diagram lightbox store (c59c32499 `Zu`, context `Qu`; dumps/mermaid-diagram-lightbox-expand-
 * bundle-2026-11-18.js.txt). Document prose (c3fde7009) provides one; a mermaid fence under it shows Expand, which
 * hands the store a clone of its drawing, and the document's lightbox dialog shows it.
 */

/** Upstream `Xu`'s result: a detached copy of a drawing and its natural size. */
export interface DiagramFigure
{
	drawing: SVGSVGElement;
	width: number;
	height: number;
}

export interface DiagramLightboxState
{
	diagram: DiagramFigure | null;
	open: boolean;
	show: (diagram: DiagramFigure) => void;
	setOpen: (open: boolean) => void;
	/** Drops the figure once the dialog has finished closing; a reopened dialog keeps it. */
	release: () => void;
}

export interface DiagramLightboxStore
{
	getState: () => DiagramLightboxState;
	subscribe: (listener: () => void) => () => void;
}

/** Upstream `Zu`. */
export function createDiagramLightboxStore(): DiagramLightboxStore
{
	const listeners = new Set<() => void>();
	const set = (update: (state: DiagramLightboxState) => Partial<DiagramLightboxState>) =>
	{
		const next = update(state);
		if (next === state) return;
		state =
		{
			...state,
			...next,
		};
		for (const listener of listeners) listener();
	};
	let state: DiagramLightboxState =
	{
		diagram: null,
		open: false,
		show: (diagram) =>
		{
			set(() => (
			{
				diagram,
				open: true,
			}));
		},
		setOpen: (open) =>
		{
			set(() => (
			{
				open,
			}));
		},
		release: () =>
		{
			set((current) =>
				current.open
					? current
					:
						{
							diagram: null,
						},
			);
		},
	};
	return {
		getState: () => state,
		subscribe: (listener) =>
		{
			listeners.add(listener);
			return () =>
			{
				listeners.delete(listener);
			};
		},
	};
}

/** Upstream `Qu`: the document's lightbox store, or null outside document prose (the transcript). */
export const DiagramLightboxContext = createContext<DiagramLightboxStore | null>(null);

/** Upstream's `K(store, selector)`. */
export function useDiagramLightbox<T>(store: DiagramLightboxStore, select: (state: DiagramLightboxState) => T): T
{
	return useSyncExternalStore(
		store.subscribe,
		() => select(store.getState()),
		() => select(store.getState()),
	);
}

/** Upstream `Yu`: the viewBox size, else the `max-width` the renderer set (at 4:3), else 640×480. */
export function diagramSize(svg: SVGSVGElement):
{
	width: number;
	height: number;
}
{
	const box = svg
		.getAttribute("viewBox")
		?.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (box?.length === 4)
	{
		const [, , width, height] = box;
		if (width !== undefined && height !== undefined && width > 0 && height > 0)
			return {
				width,
				height,
			};
	}
	const maxWidth = /max-width:\s*([\d.]+)px/.exec(svg.getAttribute("style") ?? "");
	const width = maxWidth ? Number(maxWidth[1]) : 640;
	return {
		width,
		height: width * 0.75,
	};
}

/** Upstream `Xu`. */
export function figureOf(svg: SVGSVGElement): DiagramFigure
{
	const drawing = svg.cloneNode(true);
	if (!(drawing instanceof SVGSVGElement)) throw new Error("Cloning an SVGSVGElement produced a non-svg");
	return {
		drawing,
		...diagramSize(svg),
	};
}
