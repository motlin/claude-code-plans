import {PanelRight} from "lucide-react";
import {Suspense, useLayoutEffect, useRef, useState, type ReactNode, type RefObject} from "react";

import {setSessionRailShown} from "../../lib/session-rail-store";
import {usePhoneSheet} from "../../lib/use-phone-sheet";
import {useOptionalPaneHost} from "../panes/pane-host-context";
import {TITLEBAR_ICON_BUTTON_CLASS} from "../titlebar-classes";
import {MenuItem} from "../ui/menu";
import {Tooltip} from "../ui/tooltip";
import {useSessionRailVisible} from "./use-session-rail-docked";

/** Shows or hides the rail; showing it closes the panes it would share the side with. */
function useSessionRailToggle(): {visible: boolean; label: string; toggle: () => void} {
	const visible = useSessionRailVisible();
	const host = useOptionalPaneHost();
	return {
		visible,
		label: visible ? "Hide session rail" : "Show session rail",
		toggle: () => {
			if (!visible) for (const kind of host?.openKinds ?? []) host?.closePane(kind);
			setSessionRailShown(!visible);
		},
	};
}

/** Upstream's first titlebar trail button: a ghost icon toggle, pressed while the rail shows. */
export function SessionRailToggle() {
	const {visible, label, toggle} = useSessionRailToggle();
	return (
		<Tooltip content={label} side="bottom">
			<button
				type="button"
				aria-label={label}
				aria-pressed={visible}
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
	if (!visible) return null;
	if (phone) return <SessionRailOverlay render={render} />;
	return (
		<div
			data-epitaxy-rail-column=""
			className="absolute inset-y-0 end-[var(--session-rail-end)] flex w-[var(--session-rail-w,17.5rem)] flex-col pt-3 pb-0.75"
		>
			<Suspense fallback={null}>{render()}</Suspense>
		</div>
	);
}

/** The composer dock's height, which the overlay ends 8px above. */
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

/** Upstream's phone rail: one card floating over the transcript, ending 8px above the composer. */
function SessionRailOverlay({render}: {render: () => ReactNode}) {
	const ref = useRef<HTMLDivElement>(null);
	const footerHeight = useSessionFooterHeight(ref);
	return (
		<div
			ref={ref}
			role="group"
			aria-label="Session details"
			data-session-rail-overlay=""
			style={{bottom: footerHeight}}
			className="absolute top-0 end-2 z-10 flex w-[17.5rem] flex-col pt-3 pb-2"
		>
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface-1 p-2 shadow-panel-md [--session-rail-w:100%]">
				<Suspense fallback={null}>{render()}</Suspense>
			</div>
		</div>
	);
}
