import {type MouseEvent, type PointerEvent, useRef, useState} from "react";

/** Upstream `_Z` (shared-9): a click on any of these inside open text belongs to that control, not the row. */
const OPEN_TEXT_INTERACTIVE =
	"a, button, input, select, textarea, summary, label, iframe, video, audio, [role='button'], [role='link'], [role='menuitem'], [role='tab'], [role='checkbox'], [role='switch'], [contenteditable]:not([contenteditable='false']), [tabindex]:not([tabindex^='-'])";

/** Upstream `V7`: a mouse/pen pointer that moved this far (Euclidean px) between pointerdown and click dragged. */
const OPEN_TEXT_DRAG_SLOP = 4;

/** Upstream `jp`'s skip list: text in these never counts as the row's first line. */
const FIRST_LINE_SKIP = "[hidden], [aria-hidden='true'], [data-cds-row-toggle]";

const BLOCK_DISPLAY = /^(block|list-item|flow-root)$/;

export interface OpenTextRowProps
{
	"data-cds-open-text"?: "";
	"data-cds-line-hot"?: "";
	onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
	onPointerMove?: (event: PointerEvent<HTMLElement>) => void;
	onPointerLeave?: () => void;
	onClick?: (event: MouseEvent<HTMLElement>) => void;
}

const INACTIVE:
{
	rowProps: OpenTextRowProps;
} = Object.freeze(
	{
		rowProps: Object.freeze({}),
	},
);

function targetElement(target: EventTarget | null): Element | null
{
	if (target instanceof Element) return target;
	if (target instanceof Node) return target.parentElement;
	return null;
}

/** Upstream `jp`: mark the block holding the row's first visible text with `data-cds-first-line`. */
function markFirstLine(row: HTMLElement): void
{
	const start = row.querySelector<HTMLElement>(":scope > [data-cds-row-panel]") ?? row;
	const view = row.ownerDocument.defaultView;
	const walker = row.ownerDocument.createTreeWalker(start, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
	{
		const parent = node.parentElement;
		if (parent === null || !node.textContent?.trim()) continue;
		if (parent.closest(FIRST_LINE_SKIP) !== null) continue;
		let block: Element | null = parent;
		while (block !== null && block !== start && !BLOCK_DISPLAY.test(view?.getComputedStyle(block).display ?? ""))
			block = block.parentElement;
		if (block === null || block === start || block.hasAttribute("data-cds-first-line")) return;
		for (const marked of row.querySelectorAll("[data-cds-first-line]"))
			marked.removeAttribute("data-cds-first-line");
		block.setAttribute("data-cds-first-line", "");
		return;
	}
}

/**
 * Upstream's open-text row (`dp` in shared-9): while a step's text is open in its own row, hovering the text's
 * first line lights it (`data-cds-line-hot`), and a plain click on that line closes the row, first handing focus
 * from inside the row to the row's own toggle so it never falls to the body.
 */
export function useOpenTextRow({active, close}: {active: boolean; close: () => void}):
{
	rowProps: OpenTextRowProps;
}
{
	const [hot, setHot] = useState(false);
	const band = useRef<number | null>(null);
	const focusInside = useRef(false);
	const downAt = useRef<
	{
		x: number;
		y: number;
	} | null>(null);

	if (!active)
	{
		if (hot) setHot(false);
		return INACTIVE;
	}

	const onFirstLine = (row: HTMLElement, clientY: number, target: EventTarget | null): boolean =>
	{
		const element = targetElement(target);
		if (element === null || !row.contains(element)) return false;
		const control = element.closest(OPEN_TEXT_INTERACTIVE);
		if (control !== null && control !== row && row.contains(control)) return false;
		if (band.current === null)
		{
			const style = row.ownerDocument.defaultView?.getComputedStyle(row);
			const lineHeight = parseFloat(style?.lineHeight ?? "");
			band.current =
				(parseFloat(style?.paddingTop ?? "") || 0) +
				(Number.isFinite(lineHeight) ? lineHeight : (parseFloat(style?.fontSize ?? "") || 0) * 1.5);
		}
		const top = row.getBoundingClientRect().top;
		return top <= clientY && clientY <= top + band.current;
	};

	return {
		rowProps:
		{
			"data-cds-open-text": "",
			...(hot
				?
					{
						"data-cds-line-hot": "" as const,
					}
				: {}),
			onPointerDown: (event) =>
			{
				band.current = null;
				const row = event.currentTarget;
				const focused = row.ownerDocument.activeElement;
				focusInside.current = focused !== null && focused !== row && row.contains(focused);
				downAt.current =
					event.pointerType === "touch"
						? null
						:
							{
								x: event.clientX,
								y: event.clientY,
							};
			},
			onPointerMove: (event) =>
			{
				const row = event.currentTarget;
				const next = onFirstLine(row, event.clientY, event.target);
				if (next && !hot) markFirstLine(row);
				if (next !== hot) setHot(next);
			},
			onPointerLeave: () =>
			{
				band.current = null;
				setHot(false);
			},
			onClick: (event) =>
			{
				const row = event.currentTarget;
				if (
					event.defaultPrevented ||
					event.button !== 0 ||
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey ||
					event.detail > 1 ||
					!onFirstLine(row, event.clientY, event.target)
				)
					return;
				const start = downAt.current;
				if (
					start !== null &&
					Math.hypot(event.clientX - start.x, event.clientY - start.y) >= OPEN_TEXT_DRAG_SLOP
				)
					return;
				const selection = row.ownerDocument.getSelection();
				if (selection !== null && !selection.isCollapsed) return;
				if (focusInside.current)
					Array.from(row.children)
						.find(
							(child): child is HTMLElement =>
								child instanceof HTMLElement && child.hasAttribute("data-cds-row-toggle"),
						)
						?.focus(
							{
								preventScroll: true,
							},
						);
				close();
			},
		},
	};
}
