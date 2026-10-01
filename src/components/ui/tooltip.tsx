import {
	cloneElement,
	type CSSProperties,
	type ReactElement,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import {Shortcut} from "./shortcut";
import {placeTooltip, type TooltipPlacement} from "./tooltip-placement";

const OPEN_DELAY_MS = 300;

const SIDE_CLASS = {
	top: "bottom-full left-1/2 mb-1 -translate-x-1/2",
	bottom: "top-full left-1/2 mt-1 -translate-x-1/2",
	right: "left-full top-1/2 ml-1 -translate-y-1/2",
	left: "right-full top-1/2 mr-1 -translate-y-1/2",
} as const;

const TOOLTIP_CLASS =
	"pointer-events-none absolute z-50 inline-flex min-h-6 w-max max-w-[240px] items-center gap-2 rounded-r5 bg-[var(--tooltip-bg)] px-2 py-[3px] text-[13px]/[18px] text-[var(--tooltip-fg)] shadow-[0_1px_2px_rgb(11_11_11/0.06)]";

/** The wider, wrapping box that keeps the content's line breaks. */
const MULTILINE_TOOLTIP_CLASS = TOOLTIP_CLASS.replace("max-w-[240px]", "max-w-[320px] whitespace-pre-line");

/**
 * Upstream's rich two-line tooltip (the sidebar resize edge, Rewind, Fork): the 13px/18px label row on top,
 * an 11px/14px muted description below, wrapping within 170px.
 */
const STACKED_TOOLTIP_CLASS = TOOLTIP_CLASS.replace(
	"inline-flex min-h-6 w-max max-w-[240px] items-center gap-2",
	"flex w-max max-w-[170px] flex-col items-start gap-0.5 whitespace-normal",
).replace("py-[3px]", "py-1.5");

/**
 * Upstream's Send tooltip with a second action on the control: one label + shortcut row per action, stacked with
 * a 2px gap inside 6px 8px padding and no width cap.
 */
const ACTION_ROWS_TOOLTIP_CLASS = TOOLTIP_CLASS.replace(
	"inline-flex min-h-6 w-max max-w-[240px] items-center gap-2",
	"flex w-max flex-col items-start gap-0.5",
).replace("py-[3px]", "py-1.5");

const TOOLTIP_ROW_CLASS = "inline-flex items-center gap-2";

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
	multiline = false,
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
	/** Wrap long content and break it at its newlines, e.g. a timestamp followed by per-turn details. */
	multiline?: boolean;
	className?: string;
	children: ReactElement<{"aria-describedby"?: string}>;
}) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const anchorRef = useRef<HTMLSpanElement>(null);
	const tipRef = useRef<HTMLSpanElement>(null);
	const [placement, setPlacement] = useState<TooltipPlacement | undefined>(undefined);

	useEffect(() => () => clearTimeout(timer.current), []);

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
				{width: document.documentElement.clientWidth, height: document.documentElement.clientHeight},
				side,
			),
		);
	}, [open, side, content, description, secondary?.content, secondary?.shortcut]);

	const placedSide = placement?.side ?? side;

	function show() {
		clearTimeout(timer.current);
		const anchor = anchorRef.current;
		if (openWhen !== undefined && (anchor === null || !openWhen(anchor))) return;
		timer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
	}

	function hide() {
		clearTimeout(timer.current);
		setOpen(false);
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
	const tooltipClass =
		description !== undefined
			? STACKED_TOOLTIP_CLASS
			: secondary !== undefined
				? ACTION_ROWS_TOOLTIP_CLASS
				: multiline
					? MULTILINE_TOOLTIP_CLASS
					: TOOLTIP_CLASS;

	return (
		<span
			ref={anchorRef}
			className={className ? `relative inline-flex ${className}` : "relative inline-flex"}
			onPointerEnter={show}
			onPointerLeave={hide}
			onFocus={show}
			onBlur={hide}
			onClick={hide}
		>
			{open
				? cloneElement(children, {
						"aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" "),
					})
				: children}
			{open && (
				<span
					ref={tipRef}
					role="tooltip"
					id={id}
					className={`${tooltipClass} ${SIDE_CLASS[placedSide]}`}
					style={shiftStyle(placement)}
				>
					{description === undefined && secondary === undefined ? (
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
								<span className="text-[11px]/[14px] text-[var(--tooltip-description-ink)]">
									{description}
								</span>
							)}
						</>
					)}
				</span>
			)}
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

function TooltipShortcut({keys}: {keys: string}) {
	return (
		<Shortcut
			keys={keys}
			variant="text"
			className="text-[12px] whitespace-nowrap [--shortcut-cap-ink:var(--tooltip-shortcut-ink)]"
		/>
	);
}
