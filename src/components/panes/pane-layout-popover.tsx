import
{
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";

import type {PaneEdge} from "../../lib/pane-layout";
import {pageIsRtl} from "../../lib/page-direction";
import {Icon, type IconName} from "../ui/icon";
import {PopoverContent, PopoverRoot, PopoverTrigger} from "../ui/popover";
import {Tooltip} from "../ui/tooltip";
import {PANE_HEADER_ICON_BUTTON_CLASS} from "./pane-classes";

/** Upstream `Ot`: a non-mouse press held this long opens the popover. */
const PANE_LAYOUT_LONG_PRESS_MS = 500;
/** Upstream `K`: moving further than this on either axis cancels the long-press. */
const PANE_LAYOUT_LONG_PRESS_SLOP_PX = 10;

/** Upstream `J`: the Move section's edges, in order. */
const EDGES: readonly PaneEdge[] = ["left", "right", "top", "bottom"];

/** Upstream `Nt`. */
const EDGE_LABELS: Readonly<Record<PaneEdge, string>> =
{
	left: "Move to left",
	right: "Move to right",
	top: "Move to top",
	bottom: "Move to bottom",
};

const EDGE_ICONS: Readonly<Record<PaneEdge, IconName>> =
{
	left: "PaneLeft",
	right: "PaneRight",
	top: "PaneTop",
	bottom: "PaneBottom",
};

/**
 * Upstream's Tile glyph is two custom svgs, PaneSplit and PaneSplitOtherPane at half opacity: a window frame with
 * the pane's half solid and the other half faded. Drawn here in the same 20px box rather than copied.
 */
function TileGlyph()
{
	return (
		<svg
			aria-hidden
			viewBox="0 0 20 20"
			width="1em"
			height="1em"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.25}
			className="shrink-0 text-[20px]"
		>
			<rect x={2.625} y={4.625} width={14.75} height={10.75} rx={2.5} />
			<rect x={5} y={7} width={4.25} height={6} rx={0.75} fill="currentColor" stroke="none" />
			<rect x={10.75} y={7} width={4.25} height={6} rx={0.75} fill="currentColor" stroke="none" opacity={0.5} />
		</svg>
	);
}

/** Upstream `zt`'s popup, on the cds Popover surface (`padding:"xs"`). */
const POPUP_CLASS =
	"draggable-none max-w-[320px] max-h-[var(--available-height)] rounded-card bg-surface-3 shadow-panel text-body font-normal text-primary outline-none focus-visible:outline-hidden flex min-w-44 flex-col gap-xs p-xs";

/** Upstream `wt`'s row label (the cds Menu section header). */
const SECTION_LABEL_CLASS = "px-2 comfortable:px-2.5 py-1 text-footnote font-medium text-ink-muted";

/** Upstream `Ct`: a ghost icon-only cds Button with `pressedVariant:"selected"` (h-control square, cds radius). */
const LAYOUT_BUTTON_CLASS =
	"group/btn relative isolate inline-flex aspect-square size-[var(--cds-h-control)] shrink-0 cursor-pointer items-center justify-center rounded text-primary outline-none focus-visible:shadow-focus";

/** Upstream's squish span, which carries the button's hover and pressed fills. */
const LAYOUT_BUTTON_FILL_CLASS =
	"absolute inset-0 -z-[1] rounded-[inherit] btn-squish group-hover/btn:bg-fill-ghost-hover group-aria-pressed/btn:bg-fill-ghost-selected";

const INACTIVE_ICON_CLASS = "text-secondary-control group-hover/btn:text-primary group-focus-visible/btn:text-primary";

type OpenReason = "click" | "keyboard";

/** Upstream `_e`: a click or contextmenu the keyboard produced (Enter, Space, the ContextMenu key) carries no detail. */
function fromKeyboard(event: ReactMouseEvent): boolean
{
	return event.detail === 0;
}

/** Upstream `ge`: under RTL the left and right arrows swap. */
function logicalKey(key: string, rtl: boolean): string
{
	if (!rtl) return key;
	if (key === "ArrowLeft") return "ArrowRight";
	if (key === "ArrowRight") return "ArrowLeft";
	return key;
}

/** Upstream `Tt`: arrows rove over the popup's enabled buttons without wrapping. */
function roveButtons(event: ReactKeyboardEvent<HTMLElement>, rtl: boolean): void
{
	const key = logicalKey(event.key, rtl);
	const step = key === "ArrowDown" || key === "ArrowRight" ? 1 : key === "ArrowUp" || key === "ArrowLeft" ? -1 : 0;
	if (step === 0) return;
	const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
	const current = event.target instanceof Element ? event.target.closest("button") : null;
	const index = current === null ? -1 : buttons.indexOf(current);
	const next = index === -1 ? buttons[step === 1 ? 0 : buttons.length - 1] : buttons[index + step];
	if (next === undefined) return;
	event.preventDefault();
	next.focus();
}

/** The pane's body: upstream's `contentRef`, the `[data-pane-body]` beside the trigger's header. */
function paneBody(trigger: HTMLElement | null): HTMLElement | null
{
	const root = trigger?.closest<HTMLElement>("[data-pane-root]") ?? null;
	return root?.querySelector<HTMLElement>("[data-pane-body]") ?? root;
}

/** Upstream `ut`: the element holding focus inside the pane body, if any. */
function focusedInBody(trigger: HTMLElement | null): HTMLElement | null
{
	const body = paneBody(trigger);
	const active = document.activeElement;
	return body !== null && active instanceof HTMLElement && body.contains(active) ? active : null;
}

/**
 * Upstream `dt` for `pressFocus:"body"`: after a pick, focus goes back to what held it in the pane body before
 * the open, or else to the body itself, made focusable for the purpose.
 */
function bodyFocusTarget(trigger: HTMLElement | null, focused: HTMLElement | null): HTMLElement | true
{
	if (focused?.isConnected === true) return focused;
	const body = paneBody(trigger);
	if (body === null) return true;
	if (!body.hasAttribute("tabindex")) body.tabIndex = -1;
	return body;
}

function swapLeftRight(edge: PaneEdge): PaneEdge
{
	if (edge === "left") return "right";
	if (edge === "right") return "left";
	return edge;
}

interface LayoutButtonProps
{
	label: string;
	icon: ReactNode;
	active: boolean;
	shortcut?: string;
	ariaKeyShortcuts?: string;
	onClick: () => void;
}

/** Upstream `Ct`. */
function LayoutButton({label, icon, active, shortcut, ariaKeyShortcuts, onClick}: LayoutButtonProps)
{
	return (
		<Tooltip
			content={label}
			side="top"
			{...(active || shortcut === undefined
				? {}
				:
					{
						shortcut,
					})}
		>
			<button
				type="button"
				aria-label={label}
				aria-pressed={active}
				data-cds-pressed-variant="selected"
				{...(active || ariaKeyShortcuts === undefined
					? {}
					:
						{
							"aria-keyshortcuts": ariaKeyShortcuts,
						})}
				onClick={onClick}
				className={LAYOUT_BUTTON_CLASS}
			>
				<span aria-hidden className={LAYOUT_BUTTON_FILL_CLASS} />
				<span className={active ? "relative inline-flex" : `relative inline-flex ${INACTIVE_ICON_CLASS}`}>
					{icon}
				</span>
			</button>
		</Tooltip>
	);
}

/** Upstream `wt`: a labelled ButtonGroup section. */
function LayoutSection({label, children}: {label: string; children: ReactNode})
{
	return (
		<div className="flex flex-col">
			<div role="presentation" className={SECTION_LABEL_CLASS}>
				{label}
			</div>
			<div className="flex px-1">
				<div
					role="group"
					data-cds="ButtonGroup"
					aria-label={label}
					className="relative inline-flex w-fit shrink-0 items-stretch gap-xs"
				>
					{children}
				</div>
			</div>
		</div>
	);
}

export interface PaneLayoutPopoverProps
{
	isExpanded: boolean;
	/** The ⇧⌘\\ chord in tooltip form and in `aria-keyshortcuts` form. */
	shortcut: string;
	ariaKeyShortcuts: string;
	triggerRef: RefObject<HTMLButtonElement | null>;
	onToggleExpand: () => void;
	atEdge: (edge: PaneEdge) => boolean;
	onMove: (edge: PaneEdge) => void;
}

/**
 * Upstream's pane layout popover (c4db265df `q` + `zt`, gate `__gb__414699090`): the pane header's Expand button
 * still toggles expand on a left click, while hover, right-click, ArrowDown or a 500ms touch long-press open a
 * popover to move the pane to a window edge or switch between Fill (expanded) and Tile.
 */
export function PaneLayoutPopover({
	isExpanded,
	shortcut,
	ariaKeyShortcuts,
	triggerRef,
	onToggleExpand,
	atEdge,
	onMove,
}: PaneLayoutPopoverProps)
{
	const [open, setOpen] = useState(false);
	const popupRef = useRef<HTMLDivElement>(null);
	/** `N`: a mouse press on the trigger blocks a hover-open until the pointer leaves. */
	const pressBlocksHover = useRef(false);
	/** `ce`: opened by click or keyboard, so a pointer leave doesn't close it. */
	const sticky = useRef(false);
	/** `P`: the open came from the keyboard, so the popup itself takes focus. */
	const keyboardOpen = useRef(false);
	/** `bodyFocusRef`: what held focus in the pane body when the trigger was pressed or the popup opened. */
	const bodyFocus = useRef<HTMLElement | null>(null);
	/** Set by a pick: where focus lands once the popup closes, instead of the trigger. */
	const pickedFocus = useRef<HTMLElement | true | null>(null);
	/** `le`: a long-press opened it, so the click after the release is swallowed. */
	const longPressOpened = useRef(false);
	const longPress = useRef<
	{
		x: number;
		y: number;
		timer: number;
	} | null>(null);
	const label = isExpanded ? "Collapse" : "Expand";

	function cancelLongPress()
	{
		if (longPress.current === null) return;
		window.clearTimeout(longPress.current.timer);
		longPress.current = null;
	}

	useEffect(() => cancelLongPress, []);

	/** Upstream `onBeforeOpen` / `onTriggerPointerDown`: keep the last element focused in the pane body. */
	function recordBodyFocus()
	{
		bodyFocus.current = focusedInBody(triggerRef.current) ?? bodyFocus.current;
	}

	function openFrom(reason: OpenReason)
	{
		recordBodyFocus();
		keyboardOpen.current = reason === "keyboard";
		sticky.current = true;
		setOpen(true);
	}

	function close()
	{
		sticky.current = false;
		setOpen(false);
	}

	function pick(action: () => void)
	{
		pickedFocus.current = bodyFocusTarget(triggerRef.current, bodyFocus.current);
		bodyFocus.current = null;
		action();
		close();
	}

	function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>)
	{
		if (event.pointerType === "mouse" && event.button === 0) pressBlocksHover.current = true;
		recordBodyFocus();
		cancelLongPress();
		longPressOpened.current = false;
		if (event.pointerType === "mouse") return;
		const timer = window.setTimeout(() =>
		{
			longPress.current = null;
			longPressOpened.current = true;
			openFrom("click");
		}, PANE_LAYOUT_LONG_PRESS_MS);
		longPress.current =
		{
			x: event.clientX,
			y: event.clientY,
			timer,
		};
	}

	function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>)
	{
		const start = longPress.current;
		if (start === null) return;
		if (
			Math.abs(event.clientX - start.x) > PANE_LAYOUT_LONG_PRESS_SLOP_PX ||
			Math.abs(event.clientY - start.y) > PANE_LAYOUT_LONG_PRESS_SLOP_PX
		)
			cancelLongPress();
	}

	const rtl = open && pageIsRtl();
	const tiled = !isExpanded;

	return (
		<PopoverRoot
			open={open}
			onOpenChange={(nextOpen, details) =>
			{
				const hover = details.reason === "trigger-hover";
				if (hover && (nextOpen ? pressBlocksHover.current : sticky.current)) return;
				if (nextOpen && hover) keyboardOpen.current = false;
				if (nextOpen) recordBodyFocus();
				if (!nextOpen) sticky.current = false;
				setOpen(nextOpen);
			}}
		>
			<Tooltip content={label} shortcut={shortcut} delay={700}>
				<PopoverTrigger
					ref={triggerRef}
					type="button"
					openOnHover
					delay={0}
					aria-label={label}
					aria-keyshortcuts={ariaKeyShortcuts}
					{...(open
						?
							{
								"data-pane-layout-popup-open": "",
							}
						: {})}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={cancelLongPress}
					onPointerCancel={cancelLongPress}
					onPointerLeave={() =>
					{
						cancelLongPress();
						pressBlocksHover.current = false;
					}}
					onClick={(event) =>
					{
						event.preventBaseUIHandler();
						const swallowed = longPressOpened.current && !fromKeyboard(event);
						longPressOpened.current = false;
						if (swallowed) return;
						onToggleExpand();
						if (open) close();
					}}
					onKeyDown={(event) =>
					{
						if (
							event.key !== "ArrowDown" ||
							event.altKey ||
							event.ctrlKey ||
							event.metaKey ||
							event.shiftKey
						)
							return;
						event.preventDefault();
						openFrom("keyboard");
					}}
					onContextMenu={(event) =>
					{
						event.preventDefault();
						cancelLongPress();
						openFrom(fromKeyboard(event) ? "keyboard" : "click");
					}}
					className={PANE_HEADER_ICON_BUTTON_CLASS}
				>
					<Icon name={isExpanded ? "Collapse" : "Expand"} size="sm" />
				</PopoverTrigger>
			</Tooltip>
			<PopoverContent
				side="bottom"
				align="end"
				sideOffset={6}
				popupRef={popupRef}
				initialFocus={() => (keyboardOpen.current ? popupRef.current : true)}
				finalFocus={() =>
				{
					const target = pickedFocus.current ?? true;
					pickedFocus.current = null;
					return target;
				}}
				onKeyDown={(event) =>
				{
					roveButtons(event, rtl);
				}}
				className={POPUP_CLASS}
			>
				<LayoutSection label="Move">
					{EDGES.map((edge) =>
					{
						const target = rtl ? swapLeftRight(edge) : edge;
						const held = tiled && atEdge(target);
						return (
							<LayoutButton
								key={edge}
								label={EDGE_LABELS[edge]}
								icon={<Icon name={EDGE_ICONS[edge]} size="md" />}
								active={held}
								onClick={() =>
								{
									pick(() =>
									{
										if (held) return;
										if (isExpanded && atEdge(target)) onToggleExpand();
										else onMove(target);
									});
								}}
							/>
						);
					})}
				</LayoutSection>
				<LayoutSection label="Fill and arrange">
					<LayoutButton
						label="Fill"
						icon={<Icon name="PaneFill" size="md" />}
						active={isExpanded}
						shortcut={shortcut}
						ariaKeyShortcuts={ariaKeyShortcuts}
						onClick={() =>
						{
							pick(() =>
							{
								if (!isExpanded) onToggleExpand();
							});
						}}
					/>
					<LayoutButton
						label="Tile"
						icon={<TileGlyph />}
						active={tiled}
						shortcut={shortcut}
						ariaKeyShortcuts={ariaKeyShortcuts}
						onClick={() =>
						{
							pick(() =>
							{
								if (isExpanded) onToggleExpand();
							});
						}}
					/>
				</LayoutSection>
			</PopoverContent>
		</PopoverRoot>
	);
}
