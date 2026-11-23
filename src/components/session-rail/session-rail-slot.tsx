import
{
	Suspense,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type FocusEvent,
	type ReactNode,
	type RefObject,
	type WheelEvent,
} from "react";

import {forwardWheel} from "../../lib/forward-wheel";
import {ICON_GLYPHS} from "../../lib/icon-glyphs";
import {onHardLoadLocation} from "../../lib/hard-load-location";
import {useRailFirstCardStyle, useRailRaiseRequest} from "../../lib/session-rail-store";
import {usePhoneSheet} from "../../lib/use-phone-sheet";
import {TITLEBAR_ICON_BUTTON_CLASS} from "../titlebar-classes";
import {Icon} from "../ui/icon";
import {MenuItem} from "../ui/menu";
import {Tooltip} from "../ui/tooltip";
import {RailAsideClassContext} from "./rail-aside-class";
import {SessionRailSkeleton} from "./session-rail-skeleton";
import
{
	SessionRailFitContext,
	useSessionRailRaise,
	useSessionRailVisible,
	useSetSessionRailShown,
	type SessionRailFit,
} from "./use-session-rail-docked";

/**
 * Shows or hides the rail; showing it closes the panes it doesn't fit beside.
 * While the rail doesn't fit the chat tile it raises (or lowers) the overlay instead,
 * and while a command has raised the overlay over a hidden rail it lowers that.
 */
function useSessionRailToggle()
{
	const visible = useSessionRailVisible();
	const raise = useSessionRailRaise();
	const fit = useContext(SessionRailFitContext);
	const setShown = useSetSessionRailShown();
	const commandRaised = raise === null && fit?.commandRaised === true;
	const pressed = raise === null ? visible || commandRaised : raise.raised;
	return {
		raise,
		fit,
		commandRaised,
		pressed,
		label: pressed ? "Hide session rail" : "Show session rail",
		/** `focus`: upstream `Hn` moves focus into a raised overlay only for a keyboard open (click detail 0). */
		toggle: (focus = true) =>
		{
			if (raise !== null)
			{
				raise.setRaised(!raise.raised, focus);
			}
			else if (commandRaised)
			{
				fit.setCommandRaised(false);
			}
			else
			{
				setShown(!visible);
			}
		},
	};
}

/** Upstream's first titlebar trail button: a ghost icon toggle, pressed while the rail shows. */
export function SessionRailToggle({
	onFocus,
	onBlur,
}:
{
	onFocus?: (event: FocusEvent<HTMLElement>) => void;
	onBlur?: (event: FocusEvent<HTMLElement>) => void;
} = {})
{
	const {raise, fit, commandRaised, pressed, label, toggle} = useSessionRailToggle();
	const controlsOverlay = raise ?? (commandRaised ? fit : null);
	return (
		<Tooltip content={label} side="bottom">
			<button
				ref={fit?.toggleRef}
				type="button"
				aria-label="Session rail"
				aria-pressed={pressed}
				{...(controlsOverlay === null
					? {}
					:
						{
							"aria-expanded": raise?.raised ?? true,
							"aria-controls": controlsOverlay.overlayId,
						})}
				onClick={(event) =>
				{
					toggle(event.detail === 0);
				}}
				onFocus={onFocus}
				onBlur={onBlur}
				className={TITLEBAR_ICON_BUTTON_CLASS}
			>
				<Icon name="SidebarRight" size="auto" />
			</button>
		</Tooltip>
	);
}

/** The toggle folded into View options while the chat tile is squeezed. */
export function SessionRailMenuItem()
{
	const {label, toggle} = useSessionRailToggle();
	return (
		<MenuItem
			icon={<ICON_GLYPHS.SidebarRight aria-hidden="true" />}
			onSelect={() =>
			{
				toggle();
			}}
		>
			{label}
		</MenuItem>
	);
}

/**
 * Upstream's `data-epitaxy-rail-column`: the column (20rem in line mode, 17.5rem in cards) docked at the chat
 * tile's end, starting 12px under the titlebar. On a phone the same rail floats
 * over the transcript as one card, 8px in from the tile's end. `render` is only
 * called while visible, so the rail's cards (a lazy chunk) load on first show.
 */
export function SessionRailSlot({sessionId, render}: {sessionId?: string; render: () => ReactNode})
{
	const visible = useSessionRailVisible();
	const phone = usePhoneSheet();
	const raise = useSessionRailRaise();
	const fit = useContext(SessionRailFitContext);
	// Fitting again clears the raise, so narrowing later doesn't bring the overlay back;
	// a command's raise ends once the rail shows or the toggle's own raise takes over.
	useLayoutEffect(() =>
	{
		if (raise === null && fit?.raised === true) fit.setRaised(false);
		if ((visible || raise !== null) && fit?.commandRaised === true) fit.setCommandRaised(false);
	}, [raise, fit, visible]);
	useCommandRaise(sessionId, fit, raise, visible);
	// Upstream's docked host (`qK`) sizes the skeleton from memory; its overlay (`cq`) keeps the default.
	const firstCardStyle = useRailFirstCardStyle(sessionId);
	if (raise !== null)
		return raise.raised ? (
			<RaisedRailOverlay
				id={raise.overlayId}
				focusOnOpen={raise.focusOnOpen}
				lower={raise.setRaised}
				toggleRef={raise.toggleRef}
				render={render}
			/>
		) : null;
	if (!visible)
	{
		if (fit?.commandRaised !== true) return null;
		return (
			<RaisedRailOverlay
				id={fit.overlayId}
				focusOnOpen={false}
				lower={fit.setCommandRaised}
				toggleRef={fit.toggleRef}
				render={render}
			/>
		);
	}
	if (phone) return <PhoneRailOverlay render={render} />;
	return (
		// Upstream `uw` (shared-20): the docked column is the flat pane band, bleeding through the tile's padding to
		// its bottom edge, with a seam border and the pane ground (`cds-pane-ground` is bg-surface-2, which the
		// session tile collapses to surface-1).
		<div
			data-epitaxy-rail-column=""
			data-session-rail-flat=""
			style={firstCardStyle}
			className="absolute top-0 -bottom-[var(--tiles-padding,0px)] md:-bottom-[calc(var(--tiles-padding,0px)-var(--spacing)*0.75)] flex w-[var(--session-rail-w,17.5rem)] flex-col end-[var(--session-rail-end)] border-s border-seam bg-surface-2 [&>*]:w-full"
		>
			<Suspense fallback={<RailFallback />}>{render()}</Suspense>
		</div>
	);
}

/**
 * Upstream's rail fallback (shared-20 `fn`): on the hard-loaded location it takes over from the route frame and
 * shows at once (hold none, reason handoff); after an SPA navigation it waits for the delayed reveal.
 */
function RailFallback()
{
	return onHardLoadLocation() ? (
		<SessionRailSkeleton hold="none" holdReason="handoff" />
	) : (
		<SessionRailSkeleton hold="delayed" />
	);
}

/**
 * Upstream's `yq`: a command's request (a bare `/autocompact`) brings this session's rail on
 * screen. A docked rail needs nothing; otherwise the overlay rises without taking focus.
 * Only requests made after mount count.
 */
function useCommandRaise(
	sessionId: string | undefined,
	fit: SessionRailFit | null,
	raise: SessionRailFit | null,
	visible: boolean,
): void
{
	const request = useRailRaiseRequest();
	const seen = useRef(request);
	useEffect(() =>
	{
		if (request === seen.current) return;
		seen.current = request;
		if (request?.sessionId !== sessionId || fit === null) return;
		if (raise !== null)
		{
			if (!raise.raised) raise.setRaised(true, false);
		}
		else if (!visible)
		{
			fit.setCommandRaised(true);
		}
	}, [request, sessionId, fit, raise, visible]);
}

/** The composer dock's height, which the overlay ends 8px above. */
function useSessionFooterHeight(ref: RefObject<HTMLElement | null>): number
{
	const [height, setHeight] = useState(0);
	useLayoutEffect(() =>
	{
		const footer = ref.current?.parentElement?.querySelector<HTMLElement>("[data-session-footer]");
		if (footer === null || footer === undefined || typeof ResizeObserver === "undefined") return undefined;
		setHeight(footer.offsetHeight);
		const observer = new ResizeObserver(() =>
		{
			setHeight(footer.offsetHeight);
		});
		observer.observe(footer);
		return () =>
		{
			observer.disconnect();
		};
	}, [ref]);
	return height;
}

/**
 * Upstream `Jq`/`Yq`: whether a wheel over the overlay belongs to a scroller inside it
 * (or came from outside it), and so isn't forwarded to the transcript.
 */
function scrollsInsideOverlay(target: EventTarget, overlay: HTMLElement): boolean
{
	if (!(target instanceof Element) || !overlay.contains(target)) return true;
	for (
		let element: Element | null = target;
		element !== null && element !== overlay;
		element = element.parentElement
	)
	{
		if (element.scrollHeight <= element.clientHeight) continue;
		const {overflowY} = getComputedStyle(element);
		if (overflowY === "auto" || overflowY === "scroll") return true;
	}
	return false;
}

/** Upstream `Xq`: vertical wheel input over the card keeps scrolling the transcript under it. */
function forwardOverlayWheel(event: WheelEvent<HTMLDivElement>): void
{
	const overlay = event.currentTarget;
	if (
		event.ctrlKey ||
		event.deltaY === 0 ||
		Math.abs(event.deltaY) <= Math.abs(event.deltaX) ||
		scrollsInsideOverlay(event.target, overlay)
	)
		return;
	const scroller = overlay.parentElement?.querySelector("[data-session-scrollport]");
	if (scroller === null || scroller === undefined) return;
	forwardWheel(
		scroller,
		{
			deltaX: 0,
			deltaY: event.deltaY,
			deltaMode: event.deltaMode,
		},
	);
}

/**
 * Upstream's raised rail (`Re` + `uo`): one card floating over the chat tile's end, 8px in
 * through `--titlebar-end-inset`'s fallback, ending 8px above the composer dock.
 */
function RailOverlay({ref, id, render}: {ref: RefObject<HTMLDivElement | null>; id?: string; render: () => ReactNode})
{
	const footerHeight = useSessionFooterHeight(ref);
	return (
		<div
			ref={ref}
			id={id}
			role="group"
			aria-label="Session details"
			tabIndex={-1}
			onWheel={forwardOverlayWheel}
			style={
			{
				bottom: footerHeight,
			}}
			className="absolute inset-y-0 end-[var(--titlebar-end-inset,0.5rem)] flex w-[var(--session-rail-w,17.5rem)] flex-col pt-3 pb-2 outline-none"
		>
			<div
				data-session-rail-flat=""
				// Local has no default border color, so `border-border` stays; `p-2` goes with rail-flat-section-dividers.
				className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface-1 p-2 shadow-panel-md transition-opacity duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none starting:opacity-0"
			>
				<RailAsideClassContext.Provider value="h-full w-full rounded-[inherit]">
					<Suspense fallback={<RailFallback />}>{render()}</Suspense>
				</RailAsideClassContext.Provider>
			</div>
		</div>
	);
}

/**
 * Upstream `uJ`: whether `element` sits in a different top-level layer than the overlay
 * (a portaled menu, popover or tooltip), whose own handlers own the key or press.
 */
function inOtherLayer(element: Element, overlay: Element): boolean
{
	const body = overlay.ownerDocument.body;
	if (element === body || !body.contains(element) || !body.contains(overlay)) return false;
	let layer: Node = overlay;
	while (layer.parentNode !== null && layer.parentNode !== body) layer = layer.parentNode;
	return !layer.contains(element);
}

/** Upstream `dJ`: a mouse or pen press on the target's own scrollbar. */
function onScrollbar(event: PointerEvent, target: Element): boolean
{
	if (event.pointerType === "touch") return false;
	return (
		(target.clientWidth > 0 && event.offsetX >= target.clientWidth) ||
		(target.clientHeight > 0 && event.offsetY >= target.clientHeight)
	);
}

/**
 * Upstream `pJ` + `fJ`: the raised overlay, focused on open only when a keyboard raised it.
 * Escape lowers it from anywhere but another layer; a pointerdown outside it, its toggle,
 * another layer and a scrollbar lowers it too. Only an Escape from inside refocuses the toggle.
 */
function RaisedRailOverlay({
	id,
	focusOnOpen,
	lower,
	toggleRef,
	render,
}: {
	id: string;
	focusOnOpen: boolean;
	lower: (raised: false) => void;
	toggleRef: RefObject<HTMLButtonElement | null>;
	render: () => ReactNode;
})
{
	const ref = useRef<HTMLDivElement>(null);
	const focusOnOpenRef = useRef(focusOnOpen);
	useEffect(() =>
	{
		const overlay = ref.current;
		if (overlay === null) return undefined;
		if (focusOnOpenRef.current)
			overlay.focus(
				{
					preventScroll: true,
				},
			);
		const onPointerDown = (event: PointerEvent) =>
		{
			const target = event.target;
			if (
				!(target instanceof Element) ||
				overlay.contains(target) ||
				toggleRef.current?.contains(target) === true ||
				inOtherLayer(target, overlay) ||
				onScrollbar(event, target)
			)
				return;
			lower(false);
		};
		const onKeyDown = (event: KeyboardEvent) =>
		{
			if (event.key !== "Escape" || event.defaultPrevented) return;
			const active = document.activeElement;
			if (active !== null && inOtherLayer(active, overlay)) return;
			event.preventDefault();
			event.stopPropagation();
			lower(false);
			if (overlay.contains(active))
				toggleRef.current?.focus(
					{
						preventScroll: true,
					},
				);
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		document.addEventListener("keydown", onKeyDown, true);
		return () =>
		{
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, [lower, toggleRef]);
	return <RailOverlay ref={ref} id={id} render={render} />;
}

/** Upstream's phone rail: the same `pJ` card, since a phone's chat tile never fits the rail. */
function PhoneRailOverlay({render}: {render: () => ReactNode})
{
	const ref = useRef<HTMLDivElement>(null);
	return <RailOverlay ref={ref} render={render} />;
}
