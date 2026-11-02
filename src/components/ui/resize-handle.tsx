import
{
	type CSSProperties,
	type HTMLAttributes,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type Ref,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import {useFizzyLake} from "../../lib/fizzy-lake";
import {RESIZE_GRIP_PILL, RESIZE_LINE_PILL, resizePillClass} from "./resize-pill";

export type ResizeHandleSide = "inline-start" | "inline-end" | "top" | "bottom";

/** Upstream's `mF`: travel (px) past which a press counts as a drag. */
const MOVE_THRESHOLD_PX = 3;
/** Upstream's `Gl` / `qk`: the Arrow key step (px), and the Shift+Arrow step. */
const KEY_STEP_PX = 8;
const SHIFT_KEY_STEP_PX = 32;

/** Upstream's `Ud`: the handle straddles its panel's edge, offset by half the onBorder ring. */
const SIDE_CLASS: Record<ResizeHandleSide, string> =
{
	"inline-start": "inset-y-0 start-[calc(-6px_-_(var(--cds-ring-outer,0px)_-_var(--cds-ring-inner,0px))_/_2)]",
	"inline-end": "inset-y-0 end-[calc(-6px_-_(var(--cds-ring-outer,0px)_-_var(--cds-ring-inner,0px))_/_2)]",
	top: "inset-x-0 top-[calc(-6px_-_(var(--cds-ring-outer,0px)_-_var(--cds-ring-inner,0px))_/_2)]",
	bottom: "inset-x-0 bottom-[calc(-6px_-_(var(--cds-ring-outer,0px)_-_var(--cds-ring-inner,0px))_/_2)]",
};

/** Upstream's `dK`: the 1px border the onBorder offset centres on. */
const ON_BORDER_STYLE =
{
	"--cds-ring-outer": "1px",
	"--cds-ring-inner": "0px",
} as CSSProperties;

/** The size and offset utilities a host's className may override, like upstream's tailwind-merge (`cn`). */
const OVERRIDABLE = /^(w|h|start|end|top|bottom)-/;

function overridableGroup(token: string): string | undefined
{
	return token.includes(":") ? undefined : OVERRIDABLE.exec(token)?.[1];
}

/** Drops each base size/offset utility whose group the host's className sets, e.g. `w-[3px]` replaces `w-3`. */
function mergeSizeClasses(base: string, className: string | undefined): string
{
	if (className === undefined || className === "") return base;
	const overridden = new Set(className.split(" ").map(overridableGroup));
	const kept = base.split(" ").filter((token) =>
	{
		const group = overridableGroup(token);
		return group === undefined || !overridden.has(group);
	});
	return `${kept.join(" ")} ${className}`;
}

export interface ResizeHandleProps extends Omit<
	HTMLAttributes<HTMLDivElement>,
	"children" | "role" | "tabIndex" | "onResize"
>
{
	orientation?: "vertical" | "horizontal";
	side?: ResizeHandleSide | undefined;
	onBorder?: boolean;
	/** The cumulative pointer delta (px) from the press point, or one key step. */
	onResize: (delta: number) => void;
	onResizeStart?: () => void;
	/** `moved` is false for a press that never travelled past 3px, and for Enter/Space. */
	onResizeEnd?: (moved: boolean) => void;
	ref?: Ref<HTMLDivElement>;
}

interface Drag
{
	start: number;
	moved: boolean;
}

/**
 * Upstream's cds ResizeHandle (shared-38 `_G`): a 12px `separator` with a focus-ring sibling and a
 * pill (the panels line `IJ`, or the grip `Tw` without panels). A drag reports cumulative deltas,
 * sets `data-dragging` and locks the body cursor; Arrow keys step 8px (Shift 32px) and Enter/Space
 * act as a click. The host's `onKeyDown` runs after these keys, so it can add Home/End or a reset.
 */
export function ResizeHandle({
	orientation = "vertical",
	side,
	onBorder = false,
	onResize,
	onResizeStart,
	onResizeEnd,
	onPointerDown,
	onKeyDown,
	className,
	style,
	ref,
	...rest
}: ResizeHandleProps)
{
	const vertical = orientation === "vertical";
	const pill = useFizzyLake("panels") ? RESIZE_LINE_PILL : RESIZE_GRIP_PILL;
	const [dragging, setDragging] = useState(false);
	const dragRef = useRef<Drag | null>(null);
	const callbacks = useRef(
		{
			onResize,
			onResizeStart,
			onResizeEnd,
		},
	);
	useLayoutEffect(() =>
	{
		callbacks.current =
		{
			onResize,
			onResizeStart,
			onResizeEnd,
		};
	});

	const finishRef = useRef(() =>
	{
		const drag = dragRef.current;
		if (drag === null) return;
		dragRef.current = null;
		setDragging(false);
		callbacks.current.onResizeEnd?.(drag.moved);
	});

	useEffect(() =>
	{
		if (!dragging) return undefined;
		const finish = finishRef.current;
		function onMove(event: PointerEvent): void
		{
			const drag = dragRef.current;
			if (drag === null) return;
			const delta = (vertical ? event.clientX : event.clientY) - drag.start;
			if (Math.abs(delta) > MOVE_THRESHOLD_PX) drag.moved = true;
			callbacks.current.onResize(delta);
		}
		const body = document.body.style;
		body.cursor = vertical ? "col-resize" : "row-resize";
		body.userSelect = "none";
		document.addEventListener("pointermove", onMove);
		document.addEventListener("pointerup", finish);
		document.addEventListener("pointercancel", finish);
		return () =>
		{
			document.removeEventListener("pointermove", onMove);
			document.removeEventListener("pointerup", finish);
			document.removeEventListener("pointercancel", finish);
			body.cursor = "";
			body.userSelect = "";
		};
	}, [dragging, vertical]);

	useEffect(() => finishRef.current, []);

	function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void
	{
		if (event.button === 0 && dragRef.current === null)
		{
			event.preventDefault();
			dragRef.current =
			{
				start: vertical ? event.clientX : event.clientY,
				moved: false,
			};
			setDragging(true);
			callbacks.current.onResizeStart?.();
		}
		onPointerDown?.(event);
	}

	function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void
	{
		if (!event.metaKey && !event.ctrlKey && !event.altKey && dragRef.current === null)
		{
			if ((event.key === "Enter" || event.key === " ") && !event.shiftKey)
			{
				event.preventDefault();
				if (!event.repeat)
				{
					onResizeStart?.();
					onResizeEnd?.(false);
				}
			}
			else
			{
				const step = event.shiftKey ? SHIFT_KEY_STEP_PX : KEY_STEP_PX;
				const [back, forward] = vertical ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
				const delta = event.key === back ? -step : event.key === forward ? step : 0;
				if (delta !== 0)
				{
					event.preventDefault();
					onResizeStart?.();
					onResize(delta);
					onResizeEnd?.(true);
				}
			}
		}
		onKeyDown?.(event);
	}

	const baseClass = [
		"cds-reset group/resize outline-none focus-visible:outline-hidden",
		vertical ? "w-3 cursor-col-resize" : "h-3 cursor-row-resize",
		side === undefined ? `relative ${vertical ? "h-full" : "w-full"}` : `absolute ${SIDE_CLASS[side]}`,
	].join(" ");
	const ringClass = vertical
		? "inset-y-0 left-1/2 w-3 -translate-x-1/2 cursor-col-resize"
		: "inset-x-0 top-1/2 h-3 -translate-y-1/2 cursor-row-resize";

	return (
		<div
			{...rest}
			ref={ref}
			data-cds="ResizeHandle"
			role="separator"
			aria-orientation={orientation}
			tabIndex={0}
			data-dragging={dragging ? "" : undefined}
			onPointerDown={handlePointerDown}
			onKeyDown={handleKeyDown}
			style={
				onBorder
					?
						{
							...ON_BORDER_STYLE,
							...style,
						}
					: style
			}
			className={mergeSizeClasses(baseClass, className)}
		>
			<div
				aria-hidden="true"
				className={`absolute rounded-full transition-shadow duration-[60ms] group-focus-visible/resize:shadow-focus ${ringClass}`}
			/>
			<div
				aria-hidden="true"
				data-cds-part="resize-pill"
				className={resizePillClass(pill, orientation, dragging)}
			/>
		</div>
	);
}
