import
{
	cloneElement,
	type CSSProperties,
	type PointerEvent,
	type ReactElement,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import {useLazyShrinkwrap} from "../../hooks/use-lazy-shrinkwrap";
import {loadShrinkwrapEngine} from "../../lib/shrinkwrap-loader";

import {ViewportPortal} from "../viewport-portal";
import {Shortcut} from "./shortcut";
import
{
	ACTION_ROWS_TOOLTIP_CLASS,
	MULTILINE_TOOLTIP_CLASS,
	OPEN_DELAY_MS,
	REASON_TOOLTIP_CLASS,
	SIDE_CLASS,
	STACKED_DETAIL_TOOLTIP_CLASS,
	STACKED_TOOLTIP_CLASS,
	START_SIDE_CLASS,
	TOOLTIP_CLASS,
} from "./tooltip-classes";
import {placeTooltip, type TooltipAlign, type TooltipPlacement} from "./tooltip-placement";
import {TooltipGroupContext, type TooltipGroupValue} from "./tooltip-group-context";
import {TooltipPortalContext} from "./tooltip-portal-context";

/** The side classes' 4px gap widened to upstream's `sideOffset 8` (the @ mention row path tip). */
function widenOffset(sideClass: string): string
{
	return sideClass.replace(/\b(m[lrtb])-1\b/, "$1-2");
}

/** How far inside the viewport's top and bottom a cursor-tracking tooltip stays. */
const TRACK_CURSOR_INSET_PX = 8;

const TOOLTIP_ROW_CLASS = "inline-flex items-center gap-2";

/** An unprefixed Tailwind display utility, optionally `!`-important, that should replace the anchor's default `inline-flex`. */
const DISPLAY_CLASS =
	/^!?(?:block|inline-block|inline|flex|inline-flex|grid|inline-grid|contents|flow-root|table|hidden)!?$/;

/** The anchor's classes: `relative inline-flex` plus the caller's, dropping `inline-flex` when the caller sets its own display. */
function anchorClass(className: string | undefined): string
{
	if (!className) return "relative inline-flex";
	const ownDisplay = className.split(/\s+/).some((token) => DISPLAY_CLASS.test(token));
	return ownDisplay ? `relative ${className}` : `relative inline-flex ${className}`;
}

/**
 * Keeps at most one tooltip under it open, as Base UI's delay group does: a nested trigger's tip (a StackedMeter
 * segment) replaces its parent's (the whole meter) instead of drawing over it.
 */
export function TooltipGroup({closeDelay = 0, children}: {closeDelay?: number; children: ReactNode})
{
	const [value] = useState<TooltipGroupValue>(() =>
	{
		let current: (() => void) | null = null;
		return {
			claim: (hide) =>
			{
				if (current !== null && current !== hide) current();
				current = hide;
			},
			release: (hide) =>
			{
				if (current === hide) current = null;
			},
			closeDelay,
		};
	});
	return <TooltipGroupContext.Provider value={value}>{children}</TooltipGroupContext.Provider>;
}

/** One action row of a multi-action tooltip: its label and keyboard shortcut. */
interface TooltipRow
{
	content: string;
	shortcut: string;
}

/**
 * Whether the anchored trigger's menu or popover is open (`aria-expanded="true"`). Base UI puts focus guards
 * beside an open popup's trigger, so this looks for the expanded child rather than the first one.
 */
function popupOpen(anchor: HTMLElement): boolean
{
	return anchor.querySelector(':scope > [aria-expanded="true"]') !== null;
}

/**
 * Minimal claude.ai/code tooltip: always dark, side top (titlebar controls use
 * bottom, sidebar family handles right), offset 4, 300ms hover delay (keyboard focus opens at once, marked `data-instant="focus"`), with an optional text-variant shortcut
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
	openOnClick = false,
	markOpen = false,
	trackCursor,
	suppressAfterPopup = false,
	portal: portalProp,
	delay = OPEN_DELAY_MS,
	sideOffset = 4,
	maxWidth,
	lineClamp = false,
	className,
	style,
	children,
}: {
	/** The tip's text; a node (memoized by the caller, since it re-places the tip) for rich text such as `<bdi>` parts. */
	content: ReactNode;
	shortcut?: string;
	/**
	 * More actions on the same control, each stacked on its own row, e.g. Send ⏎ over Queue for later ⌘⏎ and
	 * Fork with this prompt ⌥⌘⏎.
	 */
	secondary?: TooltipRow | readonly TooltipRow[] | undefined;
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
	/** Clamp the content to three lines, keeping its whitespace, as upstream's settled workflow status tip does. */
	lineClamp?: boolean;
	/**
	 * `reason`: upstream's disabled-reason tooltip. The balanced 240px box, and the anchored child is left undescribed because the reason already
	 * describes it.
	 */
	variant?: "reason" | undefined;
	/** Upstream keeps a disabled reason open when its control is clicked (`closeOnClick: false`). */
	closeOnClick?: boolean;
	/**
	 * A click opens the tip at once, or keeps it open, without toggling it (upstream's receipt mark: `onClick`
	 * sets `open`, with `closeOnClick: false`). Pointer leave still closes it, as upstream's `hoverable: false`.
	 */
	openOnClick?: boolean;
	/** Mark the anchored child `data-popup-open` while the tip is open, as Base UI's tooltip trigger does. */
	markOpen?: boolean;
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
	 * scroller such as a menu row (upstream's Max effort row tooltip, side right). Defaults to the nearest
	 * TooltipPortalContext, which the transcript scroller sets.
	 */
	portal?: boolean;
	/** The hover open delay; upstream's @ mention rows use 200ms. */
	delay?: number;
	/** The gap from the anchor; 8 for upstream's @ mention row tip. */
	sideOffset?: 4 | 8;
	/** Overrides the box's max width, e.g. `max-w-[360px]` for a multiline @ mention path. */
	maxWidth?: string | undefined;
	className?: string;
	/** Inline style for the anchor, e.g. a StackedMeter segment's position and width. */
	style?: CSSProperties | undefined;
	children: ReactElement<
	{
		"aria-describedby"?: string;
		"data-popup-open"?: string;
	}>;
})
{
	const secondaryRows: readonly TooltipRow[] =
		secondary === undefined ? [] : "content" in secondary ? [secondary] : secondary;
	const secondaryKey = secondaryRows.map((row) => `${row.content}\u0000${row.shortcut}`).join("\u0001");
	const inheritedPortal = useContext(TooltipPortalContext);
	const group = useContext(TooltipGroupContext);
	/** A stable closer for the group to call, since `hide` is redefined each render. */
	const hideRef = useRef<() => void>(() => {});
	const [groupHide] = useState(() => () =>
	{
		hideRef.current();
	});
	const portal = portalProp ?? inheritedPortal;
	const id = useId();
	const [open, setOpen] = useState(false);
	/** Upstream's `data-instant="focus"`: the tip opened at once because keyboard focus arrived. */
	const [openedByFocus, setOpenedByFocus] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const anchorRef = useRef<HTMLSpanElement>(null);
	const tipRef = useRef<HTMLSpanElement>(null);
	/** Upstream's `an({immediate: true})`: hug the wrapped text before placement measures the tip. */
	const fitTip = useLazyShrinkwrap(
		{
			immediate: true,
		},
	);
	const tipCallbackRef = useCallback(
		(el: HTMLSpanElement | null) =>
		{
			tipRef.current = el;
			fitTip(el);
		},
		[fitTip],
	);
	const [placement, setPlacement] = useState<TooltipPlacement | undefined>(undefined);
	const [anchorBox, setAnchorBox] = useState<CSSProperties | undefined>(undefined);
	const [cursorY, setCursorY] = useState<number | undefined>(undefined);
	const [trackedTop, setTrackedTop] = useState<number | undefined>(undefined);
	const suppressed = useRef(false);
	/**
	 * A pointer press on the anchor that hasn't been followed by blur: the focus it brings is not keyboard focus, so
	 * it leaves the tip to the hover delay (upstream's Base UI `:focus-visible` gate).
	 */
	const pointerPressed = useRef(false);

	useEffect(
		() => () =>
		{
			clearTimeout(timer.current);
		},
		[],
	);

	useLayoutEffect(() =>
	{
		const anchor = anchorRef.current;
		const tip = tipRef.current;
		if (!open || anchor === null || tip === null)
		{
			setPlacement(undefined);
			return;
		}
		const size =
		{
			width: tip.offsetWidth,
			height: tip.offsetHeight,
		};
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
	}, [open, side, align, content, description, secondaryKey]);

	useLayoutEffect(() =>
	{
		const anchor = anchorRef.current;
		const tip = tipRef.current;
		if (!open || cursorY === undefined || anchor === null || tip === null)
		{
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
	useEffect(() =>
	{
		const anchor = anchorRef.current;
		if ((!open && !suppressAfterPopup) || anchor === null) return undefined;
		const observer = new MutationObserver(() =>
		{
			if (!popupOpen(anchor)) return;
			if (suppressAfterPopup) suppressed.current = true;
			hideRef.current();
		});
		observer.observe(
			anchor,
			{
				attributes: true,
				attributeFilter: ["aria-expanded"],
				subtree: true,
			},
		);
		return () =>
		{
			observer.disconnect();
		};
	}, [open, suppressAfterPopup]);

	const placedSide = placement?.side ?? side;
	const baseSideClass = (align === "start" || trackedTop !== undefined ? START_SIDE_CLASS : SIDE_CLASS)[placedSide];
	const sideClass = sideOffset === 8 ? widenOffset(baseSideClass) : baseSideClass;

	function show(openDelay = delay, byFocus = false)
	{
		clearTimeout(timer.current);
		// Usually loaded at idle already; otherwise the hover delay covers the download before the tip fits.
		loadShrinkwrapEngine().catch(() => {});
		const anchor = anchorRef.current;
		if (suppressed.current) return;
		if (anchor !== null && popupOpen(anchor)) return;
		if (openWhen !== undefined && (anchor === null || !openWhen(anchor))) return;
		const reveal = () =>
		{
			if (anchor !== null && popupOpen(anchor)) return;
			if (portal && anchor !== null)
			{
				const {left, top, width, height} = anchor.getBoundingClientRect();
				setAnchorBox(
					{
						left,
						top,
						width,
						height,
					},
				);
			}
			if (byFocus) setOpenedByFocus(true);
			group?.claim(groupHide);
			setOpen(true);
		};
		if (openDelay === 0) reveal();
		else timer.current = setTimeout(reveal, openDelay);
	}

	function trackPointer(event: PointerEvent<HTMLSpanElement>)
	{
		setCursorY(event.clientY);
	}

	function hide()
	{
		clearTimeout(timer.current);
		group?.release(groupHide);
		setOpen(false);
		setOpenedByFocus(false);
	}

	hideRef.current = hide;

	/** Leaving the anchor lifts the suppression, unless the popup is still open, and closes after the group's delay. */
	function leave()
	{
		const anchor = anchorRef.current;
		suppressed.current = suppressAfterPopup && anchor !== null && popupOpen(anchor);
		const closeDelay = group?.closeDelay ?? 0;
		if (closeDelay === 0 || !open)
		{
			hide();
			return;
		}
		clearTimeout(timer.current);
		timer.current = setTimeout(hide, closeDelay);
	}

	const label = (
		<>
			{lineClamp ? <span className="line-clamp-3 whitespace-pre-wrap">{content}</span> : content}
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
	const variantClass =
		variant === "reason"
			? REASON_TOOLTIP_CLASS
			: stackedDetail
				? STACKED_DETAIL_TOOLTIP_CLASS
				: description === undefined
					? secondaryRows.length === 0
						? multiline
							? MULTILINE_TOOLTIP_CLASS
							: TOOLTIP_CLASS
						: ACTION_ROWS_TOOLTIP_CLASS
					: STACKED_TOOLTIP_CLASS;
	const tooltipClass = maxWidth === undefined ? variantClass : variantClass.replace(/max-w-\[[^\]]+\]/, maxWidth);
	/** Upstream balances every tip without a primary shortcut (`!a && gp`); the shrinkwrap then hugs the shorter lines. */
	const balanceClass = shortcut === undefined ? " text-balance" : "";

	const tipElement = (
		<span
			ref={tipCallbackRef}
			role="tooltip"
			id={id}
			data-side={placedSide}
			data-align={align}
			data-instant={openedByFocus ? "focus" : undefined}
			className={`${tooltipClass}${balanceClass} ${sideClass}`}
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
			) : description === undefined && secondaryRows.length === 0 ? (
				label
			) : (
				<>
					<span className={TOOLTIP_ROW_CLASS}>{label}</span>
					{secondaryRows.map((row) => (
						<span key={row.content} className={TOOLTIP_ROW_CLASS}>
							{row.content}
							<TooltipShortcut keys={row.shortcut} />
						</span>
					))}
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
			className={anchorClass(className)}
			style={style}
			onPointerEnter={(event) =>
			{
				// Upstream's cds Tooltip never starts its open timer for a touch pointer.
				if (event.pointerType === "touch") return;
				if (trackCursor === "y") trackPointer(event);
				show();
			}}
			onPointerMove={trackCursor === "y" ? trackPointer : undefined}
			onPointerLeave={leave}
			onPointerDown={() =>
			{
				pointerPressed.current = true;
			}}
			onFocus={() =>
			{
				if (!pointerPressed.current) show(0, true);
			}}
			onBlur={() =>
			{
				pointerPressed.current = false;
				leave();
			}}
			onClick={
				closeOnClick
					? hide
					: openOnClick
						? () =>
							{
								show(0);
							}
						: undefined
			}
		>
			{open && (variant !== "reason" || markOpen)
				? cloneElement(
						children,
						{
							...(variant === "reason"
								? {}
								:
									{
										"aria-describedby": [children.props["aria-describedby"], id]
											.filter(Boolean)
											.join(" "),
									}),
							...(markOpen
								?
									{
										"data-popup-open": "",
									}
								: {}),
						},
					)
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
function shiftStyle(placement: TooltipPlacement | undefined): CSSProperties | undefined
{
	if (placement === undefined || (placement.shiftX === 0 && placement.shiftY === 0)) return undefined;
	return {
		transform: `translate(${placement.shiftX}px, ${placement.shiftY}px)`,
	};
}

/** A cursor-tracking tip's top, keeping only the horizontal placement shift since the pointer sets its Y. */
function trackedStyle(top: number, placement: TooltipPlacement | undefined): CSSProperties
{
	const shiftX = placement?.shiftX ?? 0;
	return shiftX === 0
		?
			{
				top: `${top}px`,
			}
		:
			{
				top: `${top}px`,
				transform: `translateX(${shiftX}px)`,
			};
}

function TooltipShortcut({keys}: {keys: string})
{
	return (
		<Shortcut
			keys={keys}
			variant="text"
			className="text-[12px] whitespace-nowrap [--shortcut-cap-ink:var(--tooltip-shortcut-ink)]"
		/>
	);
}
