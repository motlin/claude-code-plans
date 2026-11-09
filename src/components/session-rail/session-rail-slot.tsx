import {PanelRight} from "lucide-react";
import {
	Suspense,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type FocusEvent,
	type ReactNode,
	type RefObject,
} from "react";

import {useRailRaiseRequest} from "../../lib/session-rail-store";
import {usePhoneSheet} from "../../lib/use-phone-sheet";
import {TITLEBAR_RAIL_TOGGLE_CLASS} from "../titlebar-classes";
import {MenuItem} from "../ui/menu";
import {Tooltip} from "../ui/tooltip";
import {
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
function useSessionRailToggle() {
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
		toggle: () => {
			if (raise !== null) {
				raise.setRaised(!raise.raised);
			} else if (commandRaised) {
				fit.setCommandRaised(false);
			} else {
				setShown(!visible);
			}
		},
	};
}

/** Upstream's first titlebar trail button: a ghost icon toggle, pressed while the rail shows. */
export function SessionRailToggle({
	onFocus,
	onBlur,
}: {
	onFocus?: (event: FocusEvent<HTMLElement>) => void;
	onBlur?: (event: FocusEvent<HTMLElement>) => void;
} = {}) {
	const {raise, fit, commandRaised, pressed, label, toggle} = useSessionRailToggle();
	const controlsOverlay = raise ?? (commandRaised ? fit : null);
	return (
		<Tooltip content={label} side="bottom">
			<button
				ref={fit?.toggleRef}
				type="button"
				aria-label={label}
				aria-pressed={pressed}
				{...(controlsOverlay === null
					? {}
					: {"aria-expanded": raise?.raised ?? true, "aria-controls": controlsOverlay.overlayId})}
				onClick={toggle}
				onFocus={onFocus}
				onBlur={onBlur}
				className={TITLEBAR_RAIL_TOGGLE_CLASS}
			>
				<PanelRight aria-hidden="true" />
			</button>
		</Tooltip>
	);
}

/** The toggle folded into View options while the chat tile is squeezed. */
export function SessionRailMenuItem() {
	const {label, toggle} = useSessionRailToggle();
	return (
		<MenuItem icon={<PanelRight aria-hidden="true" />} onSelect={toggle}>
			{label}
		</MenuItem>
	);
}

/**
 * Upstream's `data-epitaxy-rail-column`: the 280px column docked at the chat
 * tile's end, starting 12px under the titlebar. On a phone the same rail floats
 * over the transcript as one card, 8px in from the tile's end. `render` is only
 * called while visible, so the rail's cards (a lazy chunk) load on first show.
 */
export function SessionRailSlot({sessionId, render}: {sessionId?: string; render: () => ReactNode}) {
	const visible = useSessionRailVisible();
	const phone = usePhoneSheet();
	const raise = useSessionRailRaise();
	const fit = useContext(SessionRailFitContext);
	// Fitting again clears the raise, so narrowing later doesn't bring the overlay back;
	// a command's raise ends once the rail shows or the toggle's own raise takes over.
	useLayoutEffect(() => {
		if (raise === null && fit?.raised === true) fit.setRaised(false);
		if ((visible || raise !== null) && fit?.commandRaised === true) fit.setCommandRaised(false);
	}, [raise, fit, visible]);
	useCommandRaise(sessionId, fit, raise, visible);
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
	if (!visible) {
		if (fit?.commandRaised !== true) return null;
		return (
			<RaisedRailOverlay
				id={fit.overlayId}
				phone={phone}
				focusOnOpen={false}
				lower={fit.setCommandRaised}
				toggleRef={fit.toggleRef}
				render={render}
			/>
		);
	}
	if (phone) return <PhoneRailOverlay render={render} />;
	return (
		<div
			data-epitaxy-rail-column=""
			className="absolute inset-y-0 end-[var(--session-rail-end)] flex w-[var(--session-rail-w,17.5rem)] flex-col pt-3 pb-0.75"
		>
			<Suspense fallback={null}>{render()}</Suspense>
		</div>
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
): void {
	const request = useRailRaiseRequest();
	const seen = useRef(request);
	useEffect(() => {
		if (request === seen.current) return;
		seen.current = request;
		if (request?.sessionId !== sessionId || fit === null) return;
		if (raise !== null) {
			if (!raise.raised) raise.setRaised(true, false);
		} else if (!visible) {
			fit.setCommandRaised(true);
		}
	}, [request, sessionId, fit, raise, visible]);
}

/** The composer dock's height, which the phone overlay ends 8px above. */
function useSessionFooterHeight(ref: RefObject<HTMLElement | null>): number {
	const [height, setHeight] = useState(0);
	useLayoutEffect(() => {
		const footer = ref.current?.parentElement?.querySelector<HTMLElement>("[data-session-footer]");
		if (footer === null || footer === undefined || typeof ResizeObserver === "undefined") return undefined;
		setHeight(footer.offsetHeight);
		const observer = new ResizeObserver(() => {
			setHeight(footer.offsetHeight);
		});
		observer.observe(footer);
		return () => {
			observer.disconnect();
		};
	}, [ref]);
	return height;
}

/** Upstream's raised rail: one card floating over the chat tile's end, 12px in (8px on a phone). */
function RailOverlay({
	ref,
	id,
	phone = id === undefined,
	style,
	render,
}: {
	ref: RefObject<HTMLDivElement | null>;
	id?: string;
	phone?: boolean;
	style?: CSSProperties;
	render: () => ReactNode;
}) {
	const end = phone ? "end-2" : "end-3";
	return (
		<div
			ref={ref}
			id={id}
			role="group"
			aria-label="Session details"
			tabIndex={-1}
			data-session-rail-overlay=""
			style={style}
			className={`absolute inset-y-0 ${end} z-10 flex w-[var(--session-rail-w,17.5rem)] flex-col pt-3 pb-2 outline-none`}
		>
			<div
				data-session-rail-flat=""
				className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface-1 p-2 shadow-panel-md transition-opacity duration-200 ease-out motion-reduce:transition-none starting:opacity-0 [--session-rail-w:100%]"
			>
				<Suspense fallback={null}>{render()}</Suspense>
			</div>
		</div>
	);
}

/** The raised overlay: focused on open when the toggle raised it; an outside pointerdown or Escape lowers it. */
function RaisedRailOverlay({
	id,
	phone = false,
	focusOnOpen,
	lower,
	toggleRef,
	render,
}: {
	id: string;
	phone?: boolean;
	focusOnOpen: boolean;
	lower: (raised: false) => void;
	toggleRef: RefObject<HTMLButtonElement | null>;
	render: () => ReactNode;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const footerHeight = useSessionFooterHeight(ref);
	const focusOnOpenRef = useRef(focusOnOpen);
	useEffect(() => {
		const overlay = ref.current;
		if (focusOnOpenRef.current) overlay?.focus();
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node) || overlay?.contains(target) || toggleRef.current?.contains(target)) return;
			lower(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || !overlay?.contains(document.activeElement)) return;
			lower(false);
			toggleRef.current?.focus();
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, [lower, toggleRef]);
	return phone ? (
		<RailOverlay ref={ref} id={id} phone style={{bottom: footerHeight}} render={render} />
	) : (
		<RailOverlay ref={ref} id={id} render={render} />
	);
}

/** Upstream's phone rail: the same card, ending 8px above the composer. */
function PhoneRailOverlay({render}: {render: () => ReactNode}) {
	const ref = useRef<HTMLDivElement>(null);
	const footerHeight = useSessionFooterHeight(ref);
	return <RailOverlay ref={ref} style={{bottom: footerHeight}} render={render} />;
}
