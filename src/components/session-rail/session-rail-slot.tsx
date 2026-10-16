import {PanelRight} from "lucide-react";
import {Suspense, type ReactNode} from "react";

import {setSessionRailShown} from "../../lib/session-rail-store";
import {usePhoneSheet} from "../../lib/use-phone-sheet";
import {useOptionalPaneHost} from "../panes/pane-host-context";
import {TITLEBAR_ICON_BUTTON_CLASS} from "../titlebar-classes";
import {Tooltip} from "../ui/tooltip";
import {useSessionRailDocked} from "./use-session-rail-docked";

/** Shows or hides the rail; showing it closes the panes it would share the side with. */
function useSessionRailToggle(): {docked: boolean; label: string; toggle: () => void} {
	const docked = useSessionRailDocked();
	const host = useOptionalPaneHost();
	return {
		docked,
		label: docked ? "Hide session rail" : "Show session rail",
		toggle: () => {
			if (!docked) for (const kind of host?.openKinds ?? []) host?.closePane(kind);
			setSessionRailShown(!docked);
		},
	};
}

/** Upstream's first titlebar trail button: a ghost icon toggle, pressed while the rail shows. */
export function SessionRailToggle() {
	const {docked, label, toggle} = useSessionRailToggle();
	if (usePhoneSheet()) return null;
	return (
		<Tooltip content={label} side="bottom">
			<button
				type="button"
				aria-label={label}
				aria-pressed={docked}
				onClick={toggle}
				className={TITLEBAR_ICON_BUTTON_CLASS}
			>
				<PanelRight aria-hidden="true" />
			</button>
		</Tooltip>
	);
}

/**
 * Upstream's `data-epitaxy-rail-column`: the 280px column docked at the chat
 * tile's end, starting 12px under the titlebar. `render` is only called while
 * docked, so the rail's cards (a lazy chunk) load on first show.
 */
export function SessionRailSlot({render}: {render: () => ReactNode}) {
	const docked = useSessionRailDocked();
	if (!docked) return null;
	return (
		<div
			data-epitaxy-rail-column=""
			className="absolute inset-y-0 end-[var(--session-rail-end)] flex w-[var(--session-rail-w,17.5rem)] flex-col pt-3 pb-0.75"
		>
			<Suspense fallback={null}>{render()}</Suspense>
		</div>
	);
}
