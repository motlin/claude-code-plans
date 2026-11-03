import {Popover as BasePopover} from "@base-ui/react/popover";
import {type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from "react";

import type {SheetDetent} from "../../lib/sheet-drag";
import {useCloseWatcher} from "../../lib/use-close-watcher";
import {DensityProvider} from "./density";
import {SHEET_TALL_HEIGHT, SHEET_TEXT_ENTRY, SheetDragContext, useSheetDrag} from "./menu-sheet-drag";

/* Upstream's gM: `duration-sheet ease-out`, which compute to 0.3s and the phone-sheet curve. */
const SHEET_MOTION = "duration-[300ms] ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none";

/** Upstream's PopoverSheetBackdrop: the scrim, fading with the popup's enter and exit. */
const SHEET_SCRIM_CLASS = `draggable-none fixed inset-0 bg-backdrop transition-opacity ${SHEET_MOTION} data-[starting-style]:opacity-0 data-[ending-style]:opacity-0`;

/** Upstream's Xd: paints the sheet surface below the positioner so overscroll never shows the page. */
const SHEET_POSITIONER_CLASS =
	"z-[130] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-[100dvh] after:bg-[var(--menu-bg)]";

/** Upstream's zA: pinned full-width to the bottom edge, ignoring the trigger. */
const SHEET_POSITIONER_STYLE = {
	position: "fixed",
	inset: "auto 0 0",
	width: "auto",
	minWidth: 0,
	maxWidth: "none",
	transform: "none",
	scrollMarginTop: "env(safe-area-inset-top,0px)",
} as const;

/** Upstream's X1: no flipping or shifting. */
const SHEET_COLLISION_AVOIDANCE = {side: "none", align: "none"} as const;

/**
 * Upstream's Hc + kX: the sheet surface, sliding up on enter and down on exit. Its `data-size="lg"`
 * body reads 15/22 over the forced comfortable density; under forced colors only its top edge keeps
 * the CanvasText border (qP), and a pressed sheet drops its scroll padding.
 */
const SHEET_POPUP_CLASS = `group/sheet relative flex w-full min-w-0 max-w-none flex-col overflow-hidden bg-[var(--menu-bg)] text-primary shadow-[var(--menu-shadow)] outline-none rounded-t-[14px] rounded-b-none pb-[max(env(safe-area-inset-bottom),0.5rem)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] transition-[translate,height,scale] ${SHEET_MOTION} [--upstream-text-body:15px] [--upstream-leading-body:22px] [&_[data-cds-sheet-scroll]]:overscroll-contain [&[data-cds-sheet-pressed]_[data-cds-sheet-scroll]]:[scroll-padding-block:0px] forced-colors:border forced-colors:border-solid forced-colors:border-[color:CanvasText] forced-colors:border-x-0 forced-colors:border-b-0 data-[starting-style]:translate-y-[calc(100%+1.5rem)] data-[ending-style]:translate-y-[calc(100%+1.5rem)]`;

/** Upstream's Gf (.9) resting cap and the .95 ceiling, both below the top safe area. */
const SHEET_POPUP_STYLE = {
	maxHeight: "calc((100dvh - env(safe-area-inset-top,0px)) * .95)",
	"--available-height": "calc((100dvh - env(safe-area-inset-top,0px)) * .9)",
} as const;

/** Upstream's HR and Jl: the top safe area, and the .95 ceiling a pinned or tall sheet may reach. */
const SAFE_TOP = "env(safe-area-inset-top,0px)";
const SHEET_CEILING = SHEET_POPUP_STYLE.maxHeight;

/** Upstream's Gf: an unpinned sheet rests at most .9 of the viewport below the top safe area. */
const SHEET_REST_CAP = SHEET_POPUP_STYLE["--available-height"];

/** Upstream's RH half floor (`min(50dvh, yk)`) for a sheet that holds a text field. */
const SHEET_HALF_HEIGHT = `min(50dvh, ${SHEET_TALL_HEIGHT})`;

/** Upstream's ht window: a press on a text field opens the tall detent if its focus follows within 1s. */
const PRESS_TO_FOCUS_MS = 1000;

type SheetFloor = "content" | "half";

/** Upstream's `keyboard`: how far the on-screen keyboard covers the layout viewport, and what stays visible. */
interface SheetKeyboard {
	inset: number;
	visible: number;
}

/**
 * Upstream's RH: the sheet popup's sizing for its detent, floor, pinned content height and the on-screen
 * keyboard. Until a height is set (pinned or tall) the sheet is capped at .9, or at the half floor; once
 * set it may reach the .95 ceiling.
 */
function sheetPopupStyle(
	detent: SheetDetent,
	floor: SheetFloor,
	pinned: number | undefined,
	keyboard: SheetKeyboard | null,
) {
	const half = floor === "half";
	const height = detent === "tall" ? SHEET_TALL_HEIGHT : pinned === undefined ? undefined : `${pinned}px`;
	const restCap = half ? SHEET_HALF_HEIGHT : SHEET_REST_CAP;
	return {
		...SHEET_POPUP_STYLE,
		...(keyboard === null
			? {
					...(half ? {minHeight: SHEET_HALF_HEIGHT} : {}),
					maxHeight: height === undefined ? restCap : SHEET_CEILING,
				}
			: {
					paddingBottom: "0.5rem",
					maxHeight: `calc(${keyboard.visible}px - ${SAFE_TOP} - 8px)`,
				}),
		...(height === undefined ? {} : {height}),
	};
}

/** Upstream's a4: the positioner rides on top of the on-screen keyboard. */
function sheetPositionerStyle(keyboard: SheetKeyboard | null) {
	return {
		...SHEET_POSITIONER_STYLE,
		bottom: keyboard === null ? 0 : keyboard.inset,
	};
}

function isTextEntry(target: EventTarget | null): boolean {
	return target instanceof Element && target.matches(SHEET_TEXT_ENTRY);
}

/** Upstream's ht: a text field, or a TextInput frame or label wrapping one. */
function isTextEntryPress(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	if (isTextEntry(target)) return true;
	const frame = target.closest('[data-cds="TextInput"], label');
	if (frame === null) return false;
	const control = frame instanceof HTMLLabelElement ? frame.control : null;
	return isTextEntry(control) || frame.querySelector(SHEET_TEXT_ENTRY) !== null;
}

/**
 * Upstream's text-entry hook: a field press followed by its focus within a second (or a click on a pressed
 * field) opens the tall detent, and the sheet holds text-entry focus while a field is focused.
 */
function useTextEntryFocus(popup: HTMLDivElement | null, setDetent: (detent: SheetDetent) => void) {
	const [focused, setFocused] = useState(false);
	useEffect(() => {
		if (popup === null) return undefined;
		let pressedAt = 0;
		const press = (event: Event) => {
			if (isTextEntryPress(event.target)) pressedAt = event.timeStamp || Date.now();
		};
		const focusIn = (event: Event) => {
			if (!isTextEntry(event.target)) return;
			setFocused(true);
			if (pressedAt > 0 && (event.timeStamp || Date.now()) - pressedAt < PRESS_TO_FOCUS_MS) {
				pressedAt = 0;
				setDetent("tall");
			}
		};
		const click = (event: Event) => {
			if (pressedAt > 0 && isTextEntryPress(event.target)) {
				pressedAt = 0;
				setDetent("tall");
			}
		};
		const focusOut = (event: Event) => {
			if (isTextEntry(event.target)) setFocused(false);
		};
		popup.addEventListener("pointerdown", press);
		popup.addEventListener("focusin", focusIn);
		popup.addEventListener("focusout", focusOut);
		popup.addEventListener("click", click);
		const active = popup.ownerDocument.activeElement;
		if (popup.contains(active) && isTextEntry(active)) setFocused(true);
		return () => {
			popup.removeEventListener("pointerdown", press);
			popup.removeEventListener("focusin", focusIn);
			popup.removeEventListener("focusout", focusOut);
			popup.removeEventListener("click", click);
			setFocused(false);
		};
	}, [popup, setDetent]);
	return focused;
}

/**
 * Upstream's PO: while a text field holds focus, follow the visual viewport and report the on-screen
 * keyboard once it covers part of the layout viewport.
 */
function useKeyboardInset(popup: HTMLDivElement | null, active: boolean): SheetKeyboard | null {
	const [keyboard, setKeyboard] = useState<SheetKeyboard | null>(null);
	useEffect(() => {
		const view = popup?.ownerDocument.defaultView;
		const viewport = view?.visualViewport;
		if (!active || view === null || view === undefined || viewport === null || viewport === undefined) {
			setKeyboard(null);
			return undefined;
		}
		const update = () => {
			const visible = viewport.height;
			const inset = Math.max(0, Math.round(view.innerHeight - visible - viewport.offsetTop));
			setKeyboard((previous) => {
				if (inset <= 1) return null;
				return previous?.inset === inset && previous.visible === visible ? previous : {inset, visible};
			});
		};
		update();
		viewport.addEventListener("resize", update);
		viewport.addEventListener("scroll", update);
		return () => {
			viewport.removeEventListener("resize", update);
			viewport.removeEventListener("scroll", update);
			setKeyboard(null);
		};
	}, [popup, active]);
	return keyboard;
}

/** Upstream's c_: the scrolling body inherits the wrapper's layout and fills it. */
export const SHEET_BODY_CLASS =
	"[display:inherit] [flex-direction:inherit] [flex-wrap:inherit] [align-items:inherit] [justify-content:inherit] [justify-items:inherit] [gap:inherit] [grid-template-columns:inherit] [grid-template-rows:inherit] [grid-auto-flow:inherit] [grid-auto-columns:inherit] [grid-auto-rows:inherit] col-span-full row-span-full self-stretch justify-self-stretch max-h-[inherit] min-h-0 min-w-0 flex-auto overflow-y-auto rounded-[inherit] outline-none focus-visible:outline-hidden";

/** Sizing and radius tokens the sheet's own `w-full max-w-none h-auto max-h-none` merge away upstream. */
const SHEET_STRIPPED_TOKEN = /^(?:w|max-w|max-h|rounded(?:-[a-z]+)?)-/;

/**
 * Padding (upstream's `qx` body variant), overflow (the body is the scroller) and layout tokens move to the
 * body, so the wrapper stays a column with the DismissButton below the body.
 */
const SHEET_BODY_TOKEN =
	/^(?:(?:p|px|py|pt|pb|ps|pe|pl|pr)-|overflow-|gap-|items-|justify-|(?:flex|inline-flex|grid|flex-col|flex-row)$)/;

/** A token's utility, past any variant prefixes such as `sm:` or `data-[x]:`. */
function utility(token: string): string {
	return token.slice(token.lastIndexOf(":") + 1);
}

/** Upstream's pt and c_: the consumer's className splits between the wrapper and the body, minus the sizing tailwind-merge drops. */
function sheetClasses(className: string | undefined): {wrapper: string; body: string} {
	const tokens = (className ?? "").split(/\s+/).filter((token) => token !== "" && !SHEET_STRIPPED_TOKEN.test(token));
	const body = tokens.filter((token) => SHEET_BODY_TOKEN.test(utility(token)));
	const wrapper = tokens.filter((token) => !SHEET_BODY_TOKEN.test(utility(token)));
	return {
		wrapper: ["flex min-h-0 flex-auto flex-col", ...wrapper, "h-auto max-h-none w-full min-w-0 max-w-none"].join(
			" ",
		),
		body: [SHEET_BODY_CLASS, ...body].join(" "),
	};
}

/** Upstream's ft: hidden until keyboard-focused or held, so screen readers and Tab reach it. */
const SHEET_DISMISS_CLASS =
	"mx-1 mb-1 block min-h-10 shrink-0 rounded-r7 px-2 text-start text-[15px]/[22px] font-normal text-primary outline-none select-none focus-visible:bg-fill-ghost-hover [&:not(:focus-visible):not([data-cds-sheet-control-held])]:sr-only";

/**
 * Upstream's _t: a press marks the sheet pressed, and holds a focus-visible or highlighted DismissButton
 * visible, until the next click, pointercancel or keydown.
 */
function useDismissHold(popup: HTMLDivElement | null) {
	useEffect(() => {
		if (popup === null) return undefined;
		const doc = popup.ownerDocument;
		let held: Element | null = null;
		const release = () => {
			popup.removeAttribute("data-cds-sheet-pressed");
			held?.removeAttribute("data-cds-sheet-control-held");
			held = null;
			doc.removeEventListener("click", release, true);
			doc.removeEventListener("pointercancel", release, true);
			doc.removeEventListener("keydown", release, true);
		};
		const press = () => {
			doc.addEventListener("click", release, true);
			doc.addEventListener("pointercancel", release, true);
			doc.addEventListener("keydown", release, true);
			popup.setAttribute("data-cds-sheet-pressed", "");
			const control = popup.querySelector("[data-cds-sheet-control]");
			if (control?.matches(":focus-visible, [data-highlighted]") !== true) return;
			held = control;
			control.setAttribute("data-cds-sheet-control-held", "");
		};
		popup.addEventListener("pointerdown", press, true);
		return () => {
			popup.removeEventListener("pointerdown", press, true);
			release();
		};
	}, [popup]);
}

/** The body's laid-out content height: its first child's top to its last child's bottom, plus its padding. */
function bodyContentHeight(body: HTMLElement): number {
	const style = body.ownerDocument.defaultView?.getComputedStyle(body);
	const padding =
		(Number.parseFloat(style?.paddingTop ?? "") || 0) + (Number.parseFloat(style?.paddingBottom ?? "") || 0);
	const first = body.firstElementChild;
	const last = body.lastElementChild;
	if (first === null || last === null) return padding;
	return last.getBoundingClientRect().bottom - first.getBoundingClientRect().top + padding;
}

/**
 * Upstream's pinHeight / repinHeight: pins the sheet to its content height (the chrome around the body plus
 * the body's content), and re-pins when the popup, the body, its content or the DismissButton resizes.
 * A focus-visible DismissButton takes its 44px from the pinned body, so the sheet grows by that much.
 */
function useSheetHeightPin(popup: HTMLDivElement | null, paused: boolean): number | undefined {
	const [pinned, setPinned] = useState<number | undefined>(undefined);
	const pausedRef = useRef(paused);
	pausedRef.current = paused;
	useEffect(() => {
		if (popup === null || typeof ResizeObserver === "undefined") return undefined;
		const body = popup.querySelector<HTMLElement>("[data-cds-popover-body]");
		if (body === null) return undefined;
		const pin = () => {
			/* The tall detent and the keyboard size the sheet themselves (upstream's RH `height`). */
			if (pausedRef.current) return;
			const height = popup.getBoundingClientRect().height;
			if (height <= 0) return;
			setPinned(Math.round(height - body.clientHeight + bodyContentHeight(body)));
		};
		const resizes = new ResizeObserver(pin);
		const observeContent = () => {
			resizes.disconnect();
			for (const target of [popup, body, ...Array.from(body.children)]) resizes.observe(target);
			const control = popup.querySelector("[data-cds-sheet-control]");
			if (control !== null) resizes.observe(control);
		};
		observeContent();
		const mutations = new MutationObserver(() => {
			observeContent();
			pin();
		});
		mutations.observe(body, {childList: true});
		return () => {
			resizes.disconnect();
			mutations.disconnect();
			setPinned(undefined);
		};
	}, [popup]);
	return pinned;
}

/** Upstream's PopoverSheetContent: scrim, bottom-pinned positioner, handle and the scrolling body. */
export function PopoverSheetContent({
	children,
	className,
	closeLabel,
	treeId,
	dismiss,
}: {
	children: ReactNode;
	className: string | undefined;
	closeLabel: string;
	treeId: string;
	dismiss: () => void;
}) {
	const [popup, setPopupState] = useState<HTMLDivElement | null>(null);
	const [detent, setDetent] = useState<SheetDetent>("default");
	const [floor, setFloor] = useState<SheetFloor>("content");
	/* A closed sheet reopens at its default detent; a text field on mount floors it at half height. */
	const setPopup = useCallback((next: HTMLDivElement | null) => {
		setPopupState(next);
		if (next === null) setDetent("default");
		else
			setFloor(
				next.querySelector(`[data-cds-popover-body] :is(${SHEET_TEXT_ENTRY})`) === null ? "content" : "half",
			);
	}, []);
	const textEntryFocused = useTextEntryFocus(popup, setDetent);
	const keyboard = useKeyboardInset(popup, textEntryFocused);
	const dragFrame = useMemo(
		() => ({treeId, dismiss, detent, setDetent, keyboard: keyboard !== null}),
		[treeId, dismiss, detent, keyboard],
	);
	useDismissHold(popup);
	useCloseWatcher(popup, dismiss);
	const pinned = useSheetHeightPin(popup, detent === "tall" || keyboard !== null);
	const classes = sheetClasses(className);
	/* Upstream's portal forces comfortable (`density: MG`) in sheet mode at every account density. */
	return (
		<DensityProvider density="comfortable">
			<SheetDragContext.Provider value={dragFrame}>
				<BasePopover.Portal data-density="comfortable">
					<BasePopover.Backdrop
						data-presentation="sheet"
						data-sheet-scrim={treeId}
						className={SHEET_SCRIM_CLASS}
					/>
					<BasePopover.Positioner
						className={SHEET_POSITIONER_CLASS}
						style={sheetPositionerStyle(keyboard)}
						collisionAvoidance={SHEET_COLLISION_AVOIDANCE}
						disableAnchorTracking
					>
						<BasePopover.Popup
							ref={setPopup}
							data-cds="Popover"
							data-size="lg"
							data-presentation="sheet"
							data-sheet-tree={treeId}
							data-cds-sheet-depth="0"
							data-cds-sheet-detent={detent}
							className={SHEET_POPUP_CLASS}
							style={sheetPopupStyle(detent, floor, pinned, keyboard)}
						>
							<PopoverSheetHandle />
							<div className={classes.wrapper}>
								<div
									tabIndex={-1}
									data-cds-popover-body=""
									data-cds-sheet-scroll=""
									className={classes.body}
								>
									{children}
								</div>
								<BasePopover.Close data-cds-sheet-control="" className={SHEET_DISMISS_CLASS}>
									{closeLabel}
								</BasePopover.Close>
							</div>
						</BasePopover.Popup>
					</BasePopover.Positioner>
				</BasePopover.Portal>
			</SheetDragContext.Provider>
		</DensityProvider>
	);
}

/** Upstream's dt: the drag handle pill; it drags the sheet down to dismiss or up to the tall detent. */
function PopoverSheetHandle() {
	const drag = useSheetDrag();
	return (
		<div
			aria-hidden="true"
			data-cds-sheet-handle=""
			{...drag}
			className="flex min-h-8 shrink-0 touch-none items-center justify-center select-none"
		>
			<div className="h-1 w-9 rounded-full bg-border" />
		</div>
	);
}
