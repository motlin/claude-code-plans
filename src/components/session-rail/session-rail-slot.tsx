import {PanelRight} from "lucide-react";
import {
	Suspense,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
	type RefObject,
} from "react";

import {setSessionRailShown} from "../../lib/session-rail-store";
import {usePhoneSheet} from "../../lib/use-phone-sheet";
import {useOptionalPaneHost} from "../panes/pane-host-context";
import {TITLEBAR_ICON_BUTTON_CLASS} from "../titlebar-classes";
import {MenuItem} from "../ui/menu";
import {Tooltip} from "../ui/tooltip";
import {
	SessionRailFitContext,
	useSessionRailRaise,
	useSessionRailVisible,
	type SessionRailFit,
} from "./use-session-rail-docked";

/**
 * Shows or hides the rail; showing it closes the panes it would share the side with.
 * While the rail doesn't fit the chat tile it raises (or lowers) the overlay instead.
 */
function useSessionRailToggle() {
	const visible = useSessionRailVisible();
	const raise = useSessionRailRaise();
	const host = useOptionalPaneHost();
	const pressed = raise === null ? visible : raise.raised;
	return {
		raise,
		pressed,
		label: pressed ? "Hide session rail" : "Show session rail",
		toggle: () => {
			if (raise === null) {
				if (!visible) for (const kind of host?.openKinds ?? []) host?.closePane(kind);
				setSessionRailShown(!visible);
			} else {
				raise.setRaised(!raise.raised);
			}
		},
	};
}

/** Upstream's first titlebar trail button: a ghost icon toggle, pressed while the rail shows. */
export function SessionRailToggle() {
	const {raise, pressed, label, toggle} = useSessionRailToggle();
	return (
		<Tooltip content={label} side="bottom">
			<button
				ref={raise?.toggleRef}
				type="button"
				aria-label={label}
				aria-pressed={pressed}
				{...(raise === null ? {} : {"aria-expanded": raise.raised, "aria-controls": raise.overlayId})}
				onClick={toggle}
				className={TITLEBAR_ICON_BUTTON_CLASS}
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
export function SessionRailSlot({render}: {render: () => ReactNode}) {
	const visible = useSessionRailVisible();
	const phone = usePhoneSheet();
	const raise = useSessionRailRaise();
	const fit = useContext(SessionRailFitContext);
	// Fitting again clears the raise, so narrowing later doesn't bring the overlay back.
	useLayoutEffect(() => {
		if (raise === null && fit?.raised === true) fit.setRaised(false);
	}, [raise, fit]);
	if (raise !== null) return raise.raised ? <RaisedRailOverlay fit={raise} render={render} /> : null;
	if (!visible) return null;
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
	style,
	render,
}: {
	ref: RefObject<HTMLDivElement | null>;
	id?: string;
	style?: CSSProperties;
	render: () => ReactNode;
}) {
	const end = id === undefined ? "end-2" : "end-3";
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

/** The raised overlay: focused on open; an outside pointerdown or Escape lowers it. */
function RaisedRailOverlay({fit, render}: {fit: SessionRailFit; render: () => ReactNode}) {
	const ref = useRef<HTMLDivElement>(null);
	const {setRaised, toggleRef} = fit;
	useEffect(() => {
		const overlay = ref.current;
		overlay?.focus();
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node) || overlay?.contains(target) || toggleRef.current?.contains(target)) return;
			setRaised(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || !overlay?.contains(document.activeElement)) return;
			setRaised(false);
			toggleRef.current?.focus();
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, [setRaised, toggleRef]);
	return <RailOverlay ref={ref} id={fit.overlayId} render={render} />;
}

/** Upstream's phone rail: the same card, ending 8px above the composer. */
function PhoneRailOverlay({render}: {render: () => ReactNode}) {
	const ref = useRef<HTMLDivElement>(null);
	const footerHeight = useSessionFooterHeight(ref);
	return <RailOverlay ref={ref} style={{bottom: footerHeight}} render={render} />;
}
