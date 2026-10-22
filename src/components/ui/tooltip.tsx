import {
	cloneElement,
	type CSSProperties,
	type PointerEvent,
	type ReactElement,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import {ViewportPortal} from "../viewport-portal";
import {Shortcut} from "./shortcut";
import {placeTooltip, type TooltipAlign, type TooltipPlacement} from "./tooltip-placement";

const OPEN_DELAY_MS = 300;

const SIDE_CLASS = {
	top: "bottom-full left-1/2 mb-1 -translate-x-1/2",
	bottom: "top-full left-1/2 mt-1 -translate-x-1/2",
	right: "left-full top-1/2 ml-1 -translate-y-1/2",
	left: "right-full top-1/2 mr-1 -translate-y-1/2",
} as const;

/** The side classes for `align="start"`: flush with the anchor's start edge instead of centred on it. */
const START_SIDE_CLASS = {
	top: "bottom-full left-0 mb-1",
	bottom: "top-full left-0 mt-1",
	right: "left-full top-0 ml-1",
	left: "right-full top-0 mr-1",
} as const satisfies Record<keyof typeof SIDE_CLASS, string>;

const TOOLTIP_CLASS =
	"pointer-events-none absolute z-50 inline-flex min-h-6 w-max max-w-[240px] items-center gap-2 rounded-r5 bg-[var(--tooltip-bg)] px-2 py-[3px] text-[13px]/[18px] text-[var(--tooltip-fg)] shadow-[0_1px_2px_rgb(11_11_11/0.06)]";

/** The wider, wrapping box that keeps the content's line breaks. */
const MULTILINE_TOOLTIP_CLASS = TOOLTIP_CLASS.replace("max-w-[240px]", "max-w-[320px] whitespace-pre-line");

/**
 * Upstream's rich two-line tooltip (the sidebar resize edge, Rewind, Fork): the 13px/18px label row on top,
 * an 11px/14px muted description below, wrapping within 240px.
 */
const STACKED_TOOLTIP_CLASS = TOOLTIP_CLASS.replace(
	"inline-flex min-h-6 w-max max-w-[240px] items-center gap-2",
	"flex w-max max-w-[240px] flex-col items-start gap-0.5 whitespace-normal",
).replace("py-[3px]", "py-1.5");

/**
 * Upstream's Send tooltip with a second action on the control: one label + shortcut row per action, stacked with
 * a 2px gap inside 6px 8px padding and no width cap.
 */
const ACTION_ROWS_TOOLTIP_CLASS = TOOLTIP_CLASS.replace(
	"inline-flex min-h-6 w-max max-w-[240px] items-center gap-2",
	"flex w-max flex-col items-start gap-0.5",
).replace("py-[3px]", "py-1.5");

/**
 * Upstream's disabled-reason box (cds `DisabledReasonTooltip`, multiline): a balanced wrap within 240px with
 * 6px 8px padding.
 */
const REASON_TOOLTIP_CLASS = TOOLTIP_CLASS.replace(
	"inline-flex min-h-6 w-max max-w-[240px] items-center gap-2",
	"flex w-max max-w-[240px] flex-col gap-0.5 whitespace-normal text-balance",
).replace("py-[3px]", "py-1.5");

/**
 * Upstream's Home next-step row tooltip (cds Tooltip with a detail): the title over its 11px/14px detail,
 * balanced, wrapping within min(480px, the viewport less 8px each side).
 */
const STACKED_DETAIL_TOOLTIP_CLASS = TOOLTIP_CLASS.replace(
	"inline-flex min-h-6 w-max max-w-[240px] items-center gap-2",
	"flex w-max max-w-[min(480px,calc(100vw-16px))] flex-col gap-0.5 whitespace-normal text-balance",
).replace("py-[3px]", "py-1.5");

/** How far inside the viewport's top and bottom a cursor-tracking tooltip stays. */
const TRACK_CURSOR_INSET_PX = 8;

const TOOLTIP_ROW_CLASS = "inline-flex items-center gap-2";

/**
 * Whether the anchored trigger's menu or popover is open (`aria-expanded="true"`). Base UI puts focus guards
 * beside an open popup's trigger, so this looks for the expanded child rather than the first one.
 */
function popupOpen(anchor: HTMLElement): boolean {
	return anchor.querySelector(':scope > [aria-expanded="true"]') !== null;
}

/**
 * Minimal claude.ai/code tooltip: always dark, side top (titlebar controls use
 * bottom, sidebar family handles right), offset 4, 300ms open delay, with an optional text-variant shortcut
 * after the label. Once open it is measured and, when it would leave the viewport, flipped to the opposite side
 * and shifted to stay 8px inside the edges.
 */
export function Tooltip({
	content,
	shortcut,
	secondary,
	description,
	detail,
	openWhen,
	side = "top",
	align = "center",
	stacked = false,
	multiline = false,
	variant,
	closeOnClick = true,
	trackCursor,
	suppressAfterPopup = false,
	portal = false,
	className,
	children,
}: {
	content: string;
	shortcut?: string;
	/** A second action on the same control, stacked on its own row, e.g. Send ⏎ over Fork with this prompt ⌥⌘⏎. */
	secondary?: {content: string; shortcut: string} | undefined;
	/** A muted second line under the label row, e.g. Hide sidebar ⌘B / Drag to resize. */
	description?: string | undefined;
	/** Muted text after the label on the same row, e.g. a tab's folder after its file name. */
	detail?: string | undefined;
	/** Opens only when this holds for the anchor at hover time, e.g. only when a truncated name overflows. */
	openWhen?: ((anchor: HTMLElement) => boolean) | undefined;
	side?: keyof typeof SIDE_CLASS;
	/** `start` lines the tip up with the anchor's start edge (upstream's Home next-step rows); default centred. */
	align?: TooltipAlign;
	/** Put `detail` on its own 11px line under the label, as upstream's Home next-step row tooltip does. */
	stacked?: boolean;
	/** Wrap long content and break it at its newlines, e.g. a timestamp followed by per-turn details. */
	multiline?: boolean;
	/**
	 * `reason`: upstream's disabled-reason tooltip. The balanced 240px box, opened at once when focus arrives
	 * (upstream `data-instant="focus"`), and the anchored child is left undescribed because the reason already
	 * describes it.
	 */
	variant?: "reason" | undefined;
	/** Upstream keeps a disabled reason open when its control is clicked (`closeOnClick: false`). */
	closeOnClick?: boolean;
	/**
	 * `y`: follow the pointer's Y along the anchor, centring the tip on it 8px inside the viewport (upstream's
	 * sidebar resize edge, `trackCursorAxis="y"`). Until the pointer moves it sits at the side's default.
	 */
	trackCursor?: "y" | undefined;
	/**
	 * Keep the tip closed from the moment the anchored trigger's menu opens until the next `pointerleave` or
	 * `blur` after it has closed, so focus returning from the menu doesn't reopen it (upstream's Add and Mode
	 * triggers).
	 */
	suppressAfterPopup?: boolean;
	/**
	 * Render the tip in `document.body` over a fixed box matching the anchor, for anchors inside a clipping
	 * scroller such as a menu row (upstream's Max effort row tooltip, side right).
	 */
	portal?: boolean;
	className?: string;
	children: ReactElement<{"aria-describedby"?: string}>;
}) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const anchorRef = useRef<HTMLSpanElement>(null);
	const tipRef = useRef<HTMLSpanElement>(null);
	const [placement, setPlacement] = useState<TooltipPlacement | undefined>(undefined);
	const [anchorBox, setAnchorBox] = useState<CSSProperties | undefined>(undefined);
	const [cursorY, setCursorY] = useState<number | undefined>(undefined);
	const [trackedTop, setTrackedTop] = useState<number | undefined>(undefined);
	const suppressed = useRef(false);

	useEffect(
		() => () => {
			clearTimeout(timer.current);
		},
		[],
	);

	useLayoutEffect(() => {
		const anchor = anchorRef.current;
		const tip = tipRef.current;
		if (!open || anchor === null || tip === null) {
			setPlacement(undefined);
			return;
		}
		const size = {width: tip.offsetWidth, height: tip.offsetHeight};
		// Unlaid-out tooltips (no layout engine) keep their requested side.
		if (size.width === 0 && size.height === 0) return;
		setPlacement(
			placeTooltip(
				anchor.getBoundingClientRect(),
				size,
				{
					width: document.documentElement.clientWidth,
					height: document.documentElement.clientHeight,
				},
				side,
				align,
			),
		);
	}, [open, side, align, content, description, secondary?.content, secondary?.shortcut]);

	useLayoutEffect(() => {
		const anchor = anchorRef.current;
		const tip = tipRef.current;
		if (!open || cursorY === undefined || anchor === null || tip === null) {
			setTrackedTop(undefined);
			return;
		}
		const height = tip.offsetHeight;
		const viewportTop = Math.max(
			TRACK_CURSOR_INSET_PX,
			Math.min(cursorY - height / 2, window.innerHeight - height - TRACK_CURSOR_INSET_PX),
		);
		setTrackedTop(viewportTop - anchor.getBoundingClientRect().top);
	}, [open, cursorY]);

	// Upstream suppresses a trigger's tooltip while its popup is open, so it never draws beside the open menu.
	useEffect(() => {
		const anchor = anchorRef.current;
		if ((!open && !suppressAfterPopup) || anchor === null) return undefined;
		const observer = new MutationObserver(() => {
			if (!popupOpen(anchor)) return;
			if (suppressAfterPopup) suppressed.current = true;
			hide();
		});
		observer.observe(anchor, {attributes: true, attributeFilter: ["aria-expanded"], subtree: true});
		return () => {
			observer.disconnect();
		};
	}, [open, suppressAfterPopup]);

	const placedSide = placement?.side ?? side;
	const sideClass = (align === "start" || trackedTop !== undefined ? START_SIDE_CLASS : SIDE_CLASS)[placedSide];

	function show(delay = OPEN_DELAY_MS) {
		clearTimeout(timer.current);
		const anchor = anchorRef.current;
		if (suppressed.current) return;
		if (anchor !== null && popupOpen(anchor)) return;
		if (openWhen !== undefined && (anchor === null || !openWhen(anchor))) return;
		const reveal = () => {
			if (anchor !== null && popupOpen(anchor)) return;
			if (portal && anchor !== null) {
				const {left, top, width, height} = anchor.getBoundingClientRect();
				setAnchorBox({left, top, width, height});
			}
			setOpen(true);
		};
		if (delay === 0) reveal();
		else timer.current = setTimeout(reveal, delay);
	}

	function trackPointer(event: PointerEvent<HTMLSpanElement>) {
		setCursorY(event.clientY);
	}

	function hide() {
		clearTimeout(timer.current);
		setOpen(false);
	}

	/** Leaving the anchor lifts the suppression, unless the popup is still open. */
	function leave() {
		const anchor = anchorRef.current;
		suppressed.current = suppressAfterPopup && anchor !== null && popupOpen(anchor);
		hide();
	}

	const label = (
		<>
			{content}
			{detail !== undefined && (
				<>
					{" "}
					<span data-tooltip-detail className="text-[var(--tooltip-description-ink)]">
						{detail}
					</span>
				</>
			)}
			{shortcut !== undefined && <TooltipShortcut keys={shortcut} />}
		</>
	);
	const stackedDetail = stacked && detail !== undefined;
	const tooltipClass =
		variant === "reason"
			? REASON_TOOLTIP_CLASS
			: stackedDetail
				? STACKED_DETAIL_TOOLTIP_CLASS
				: description === undefined
					? secondary === undefined
						? multiline
							? MULTILINE_TOOLTIP_CLASS
							: TOOLTIP_CLASS
						: ACTION_ROWS_TOOLTIP_CLASS
					: STACKED_TOOLTIP_CLASS;

	const tipElement = (
		<span
			ref={tipRef}
			role="tooltip"
			id={id}
			data-side={placedSide}
			data-align={align}
			className={`${tooltipClass} ${sideClass}`}
			style={trackedTop === undefined ? shiftStyle(placement) : trackedStyle(trackedTop, placement)}
		>
			{stackedDetail ? (
				<>
					<span className="inline-flex min-w-0 items-center gap-2">
						<span className="min-w-0 break-words">{content}</span>
					</span>
					<span className="break-words text-[11px]/[14px] text-[var(--tooltip-description-ink)]">
						{detail}
					</span>
				</>
			) : description === undefined && secondary === undefined ? (
				label
			) : (
				<>
					<span className={TOOLTIP_ROW_CLASS}>{label}</span>
					{secondary !== undefined && (
						<span className={TOOLTIP_ROW_CLASS}>
							{secondary.content}
							<TooltipShortcut keys={secondary.shortcut} />
						</span>
					)}
					{description !== undefined && (
						<span className="text-[11px]/[14px] text-[var(--tooltip-description-ink)]">{description}</span>
					)}
				</>
			)}
		</span>
	);

	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- closes the tooltip on click; focus and blur already open and close it from the keyboard
		<span
			ref={anchorRef}
			className={className ? `relative inline-flex ${className}` : "relative inline-flex"}
			onPointerEnter={(event) => {
				if (trackCursor === "y") trackPointer(event);
				show();
			}}
			onPointerMove={trackCursor === "y" ? trackPointer : undefined}
			onPointerLeave={leave}
			onFocus={() => {
				show(variant === "reason" ? 0 : OPEN_DELAY_MS);
			}}
			onBlur={leave}
			onClick={closeOnClick ? hide : undefined}
		>
			{open && variant !== "reason"
				? cloneElement(children, {
						"aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" "),
					})
				: children}
			{open &&
				(portal ? (
					<ViewportPortal>
						<span className="pointer-events-none fixed z-[140]" style={anchorBox}>
							{tipElement}
						</span>
					</ViewportPortal>
				) : (
					tipElement
				))}
		</span>
	);
}

/**
 * Moves the tooltip by its placement shift with `transform`, which composes with the side classes' Tailwind 4
 * `translate` property and leaves their margins (the 4px offset) intact.
 */
function shiftStyle(placement: TooltipPlacement | undefined): CSSProperties | undefined {
	if (placement === undefined || (placement.shiftX === 0 && placement.shiftY === 0)) return undefined;
	return {transform: `translate(${placement.shiftX}px, ${placement.shiftY}px)`};
}

/** A cursor-tracking tip's top, keeping only the horizontal placement shift since the pointer sets its Y. */
function trackedStyle(top: number, placement: TooltipPlacement | undefined): CSSProperties {
	const shiftX = placement?.shiftX ?? 0;
	return shiftX === 0 ? {top: `${top}px`} : {top: `${top}px`, transform: `translateX(${shiftX}px)`};
}

function TooltipShortcut({keys}: {keys: string}) {
	return (
		<Shortcut
			keys={keys}
			variant="text"
			className="text-[12px] whitespace-nowrap [--shortcut-cap-ink:var(--tooltip-shortcut-ink)]"
		/>
	);
}
