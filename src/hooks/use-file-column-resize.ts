import
{
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

/** Upstream's cf3dc7910 `m`: the Files tree / Changes file list column widths. */
export const FILE_COLUMN =
{
	DEFAULT: 240,
	MIN: 160,
	MAX: 640,
} as const;
/** Upstream's `ne`: two clicks on the handle within this many ms reset the width. */
export const FILE_COLUMN_DOUBLE_PRESS_MS = 500;
/** Upstream's `re`: the row ResizeObserver's debounce before re-measuring `aria-valuemax`. */
export const FILE_COLUMN_MEASURE_DEBOUNCE_MS = 150;
/** The space upstream always leaves beside the column. */
const ROW_RESERVE = 160;

/** Upstream's `ie`: a column narrower than half the minimum is hidden. */
export function fileColumnShowsAt(width: number): boolean
{
	return width >= FILE_COLUMN.MIN / 2;
}

function clamp(value: number, min: number, max: number): number
{
	return Math.min(max, Math.max(min, value));
}

/** Upstream's `S`: a stored width rounded and clamped to 160–640, or the default when unusable. */
export function clampFileColumnWidth(width: number, fallback: number = FILE_COLUMN.DEFAULT): number
{
	return Number.isFinite(width) ? clamp(Math.round(width), FILE_COLUMN.MIN, FILE_COLUMN.MAX) : fallback;
}

type FileColumnSide = "inline-start" | "inline-end";

interface UseFileColumnResizeOptions
{
	width: number;
	/** Without it the width is read-only, and the column cannot hide either. */
	onWidthChange?: ((width: number) => void) | undefined;
	defaultWidth?: number;
	shown?: boolean;
	/** With `onWidthChange`, lets a click or a drag below 80px hide the column and the edge handle show it. */
	onShownChange?: ((shown: boolean) => void) | undefined;
	/** The column's handle edge; "inline-end" is a column on the left that grows rightward. */
	side?: FileColumnSide;
}

let multiClickGuard: AbortController | undefined;

/**
 * Upstream's shared-120 `n4`: for 500ms after a click hides or shows the column, swallow the rest
 * of a double click (`detail > 1`) so it doesn't land on whatever is now under the pointer. A fresh
 * single press or a window blur ends it early.
 */
function swallowMultiClicks(element: HTMLElement): void
{
	const view = element.ownerDocument.defaultView;
	if (view === null) return;
	multiClickGuard?.abort();
	const controller = new AbortController();
	multiClickGuard = controller;
	let until = performance.now() + FILE_COLUMN_DOUBLE_PRESS_MS;
	const listener = (event: Event) =>
	{
		if (performance.now() >= until)
		{
			controller.abort();
		}
		else if (event instanceof MouseEvent && event.detail > 1)
		{
			event.preventDefault();
			event.stopPropagation();
			if (event.type === "mousedown") until = performance.now() + FILE_COLUMN_DOUBLE_PRESS_MS;
		}
		else if (event.type === "mousedown")
		{
			controller.abort();
		}
	};
	for (const type of ["mousedown", "click", "dblclick"])
	{
		view.addEventListener(
			type,
			listener,
			{
				capture: true,
				signal: controller.signal,
			},
		);
	}
	view.addEventListener(
		"blur",
		() =>
		{
			controller.abort();
		},
		{
			signal: controller.signal,
		},
	);
}

interface RowObserver
{
	row: HTMLElement;
	stop: () => void;
}

/**
 * Upstream's cf3dc7910 `O` (export `m`): the Files tree and Changes file list column. A drag writes
 * the column's `style.width` live and commits the clamped width once on release; dragging below 80px
 * hides the column live, and releasing there hides it (keeping the old width). A click or Enter/Space
 * on the handle hides it and moves focus to a 3px edge handle, whose click, Enter/Space, Arrow toward
 * the viewer, or 80px drag shows it again. A column that cannot hide resets to `defaultWidth` on a
 * double click or Enter/Space. `aria-valuemax` follows the row: `clamp(rowWidth - 160, 0, 640)`.
 */
export function useFileColumnResize({
	width,
	onWidthChange,
	defaultWidth = FILE_COLUMN.DEFAULT,
	shown = true,
	onShownChange,
	side = "inline-end",
}: UseFileColumnResizeOptions)
{
	const setShown = onWidthChange === undefined ? undefined : onShownChange;
	const sign = side === "inline-end" ? 1 : -1;
	const columnRef = useRef<HTMLDivElement>(null);
	const handleRef = useRef<HTMLDivElement>(null);
	const edgeRef = useRef<HTMLDivElement>(null);
	const [max, setMax] = useState<number>(FILE_COLUMN.MAX);
	const observerRef = useRef<RowObserver | null>(null);
	const startWidth = useRef(width);
	const dragging = useRef(false);
	const pressed = useRef(false);
	const lastClick = useRef(Number.NEGATIVE_INFINITY);
	const liveHidden = useRef(false);
	const edgeDrag = useRef(
		{
			showedColumn: false,
			delta: 0,
		},
	);
	const pendingFocus = useRef<RefObject<HTMLDivElement | null> | null>(null);
	const [resizing, setResizing] = useState<"none" | "column" | "edge">("none");

	useEffect(() => () => observerRef.current?.stop(), []);

	// A column shown mid edge-drag mounts at the dragged width, not its stored one.
	useLayoutEffect(() =>
	{
		const column = columnRef.current;
		if (shown && column !== null && edgeDrag.current.showedColumn)
		{
			column.style.width = `${edgeDrag.current.delta}px`;
		}
	}, [shown]);

	// Focus handed between the handles lands once the target has rendered.
	useEffect(() =>
	{
		const target = pendingFocus.current?.current;
		if (target === null || target === undefined) return;
		pendingFocus.current = null;
		target.focus();
	});

	function measure(): void
	{
		const row = columnRef.current?.parentElement ?? observerRef.current?.row;
		if (row === undefined) return;
		if (!row.isConnected)
		{
			observerRef.current?.stop();
			return;
		}
		const rowWidth = row.clientWidth;
		if (rowWidth > 0) setMax(clamp(rowWidth - ROW_RESERVE, 0, FILE_COLUMN.MAX));
		if (row !== observerRef.current?.row) observe(row);
	}

	function observe(row: HTMLElement): void
	{
		observerRef.current?.stop();
		if (typeof ResizeObserver === "undefined") return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const observer = new ResizeObserver(() =>
		{
			clearTimeout(timer);
			timer = setTimeout(measure, FILE_COLUMN_MEASURE_DEBOUNCE_MS);
		});
		observer.observe(row);
		observerRef.current =
		{
			row,
			stop: () =>
			{
				observer.disconnect();
				clearTimeout(timer);
				observerRef.current = null;
			},
		};
	}

	function handOffFocus(from: HTMLElement, to: RefObject<HTMLDivElement | null>): void
	{
		if (from === from.ownerDocument.activeElement) pendingFocus.current = to;
	}

	function setLiveHidden(hidden: boolean): void
	{
		liveHidden.current = hidden;
		const column = columnRef.current;
		if (column !== null) column.style.display = hidden ? "none" : "";
	}

	/** Upstream's `B`: the live width, or a live hide below 80px when the column can hide. */
	function applyWidth(next: number): void
	{
		const column = columnRef.current;
		const hide = setShown !== undefined && !fileColumnShowsAt(next);
		if (!hide && column !== null) column.style.width = `${next}px`;
		if (hide !== liveHidden.current) setLiveHidden(hide);
	}

	/** Upstream's `V`: undoes a live hide, putting back the committed width. */
	function unhide(): boolean
	{
		if (!liveHidden.current) return false;
		setLiveHidden(false);
		const column = columnRef.current;
		if (column !== null) column.style.width = `${width}px`;
		return true;
	}

	/** Upstream's `H`: commits the laid-out width if a move changed it, else puts the committed one back. */
	function commit(moved: boolean): void
	{
		const column = columnRef.current;
		if (column === null || column.style.width === "" || column.offsetWidth === 0) return;
		const laidOut = column.offsetWidth;
		const changed = moved && laidOut !== startWidth.current;
		const next = changed ? clampFileColumnWidth(laidOut) : width;
		column.style.width = `${next}px`;
		if (changed) onWidthChange?.(next);
	}

	function jumpTo(next: number): void
	{
		const column = columnRef.current;
		if (column === null) return;
		startWidth.current = column.offsetWidth;
		column.style.width = `${next}px`;
		commit(true);
	}

	function reset(): void
	{
		onWidthChange?.(defaultWidth);
	}

	function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void
	{
		if (event.button === 0) pressed.current = true;
	}

	const columnStyle: CSSProperties =
	{
		width,
		minWidth: `min(${FILE_COLUMN.MIN}px, 100% - ${ROW_RESERVE}px)`,
		maxWidth: `min(${FILE_COLUMN.MAX}px, 100% - ${ROW_RESERVE}px)`,
	};

	const handleProps =
	{
		ref: handleRef,
		side,
		onResizeStart(): void
		{
			dragging.current = true;
			setResizing("column");
			measure();
			const column = columnRef.current;
			if (column !== null) startWidth.current = column.offsetWidth;
		},
		onResize(delta: number): void
		{
			applyWidth(startWidth.current + sign * delta);
		},
		onResizeEnd(moved: boolean): void
		{
			dragging.current = false;
			setResizing("none");
			const wasPressed = pressed.current;
			pressed.current = false;
			const handle = handleRef.current;
			if (unhide())
			{
				if (handle !== null) setShown?.(false);
				return;
			}
			if (setShown !== undefined && handle !== null && !moved)
			{
				handOffFocus(handle, edgeRef);
				setShown(false);
				if (wasPressed) swallowMultiClicks(handle);
				return;
			}
			if (wasPressed && !moved)
			{
				const now = performance.now();
				if (now - lastClick.current < FILE_COLUMN_DOUBLE_PRESS_MS)
				{
					lastClick.current = Number.NEGATIVE_INFINITY;
					reset();
					return;
				}
				lastClick.current = now;
			}
			commit(moved);
		},
		onPointerDown,
		onFocus: measure,
		onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void
		{
			if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || dragging.current) return;
			if (event.key === "Enter" || event.key === " ")
			{
				if (setShown === undefined && !event.repeat) reset();
				return;
			}
			if (event.key === "Home" || event.key === "End")
			{
				event.preventDefault();
				if (event.repeat) return;
				measure();
				jumpTo(event.key === "Home" ? FILE_COLUMN.MIN : FILE_COLUMN.MAX);
			}
		},
		"aria-valuenow": Math.min(width, max),
		"aria-valuemin": Math.min(FILE_COLUMN.MIN, max),
		"aria-valuemax": max,
	};

	const edgeHandleProps =
		setShown !== undefined && (!shown || resizing === "edge")
			?
				{
					ref: edgeRef,
					side,
					onResizeStart(): void
					{
						measure();
						edgeDrag.current =
						{
							showedColumn: false,
							delta: 0,
						};
						startWidth.current = 0;
						setResizing("edge");
					},
					onResize(delta: number): void
					{
						const travelled = sign * delta;
						const drag = edgeDrag.current;
						drag.delta = travelled;
						if (!pressed.current) return;
						if (!drag.showedColumn)
						{
							if (!fileColumnShowsAt(travelled)) return;
							drag.showedColumn = true;
							setShown(true);
						}
						applyWidth(travelled);
					},
					onResizeEnd(moved: boolean): void
					{
						setResizing("none");
						const wasPressed = pressed.current;
						pressed.current = false;
						const {showedColumn, delta} = edgeDrag.current;
						edgeDrag.current.showedColumn = false;
						const edge = edgeRef.current;
						if (edge === null)
						{
							unhide();
							return;
						}
						if (showedColumn)
						{
							if (unhide()) setShown(false);
							else commit(moved);
							return;
						}
						const clicked = wasPressed && !moved;
						if (clicked || (!wasPressed && (!moved || delta > 0)))
						{
							handOffFocus(edge, handleRef);
							setShown(true);
							if (clicked) swallowMultiClicks(edge);
						}
					},
					onPointerDown,
					onFocus: measure,
					"aria-valuenow": 0,
					"aria-valuemin": 0,
					"aria-valuemax": max,
				}
			: undefined;

	return {
		columnRef,
		columnStyle,
		resizing: resizing !== "none",
		handleProps,
		hidesColumn: setShown !== undefined,
		edgeHandleProps,
	};
}
