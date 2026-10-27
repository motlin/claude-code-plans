import {useLayoutEffect, useRef} from "react";

import {useShortcutKeys} from "../../hooks/use-shortcut";
import {
	isPeekSuppressed,
	suppressPeekUntilLeave,
	toggleSidebarCollapsed,
	useSidebarState,
} from "../../lib/sidebar-store";
import {Tooltip} from "../ui/tooltip";
import {SidebarToggleIcon} from "./primitives";

type ToggleLabel = "Show sidebar" | "Hide sidebar";

/**
 * The toggle a button press just asked to receive focus, like upstream moving focus from Hide sidebar to
 * the Show sidebar trigger (and back). It lives only until the next task: React commits the toggle in a
 * microtask, and a press that doesn't swap the buttons (the forced-collapse trigger opening its peek)
 * must never steal focus later.
 */
let pendingFocus: ToggleLabel | undefined;

function handOffFocus(to: ToggleLabel): void {
	pendingFocus = to;
	setTimeout(() => {
		pendingFocus = undefined;
	}, 0);
}

/** The sidebar hide/show button, labelled and tooltipped like claude.ai/code. */
export function SidebarToggleButton({
	className,
	onClick = toggleSidebarCollapsed,
	collapsed: collapsedOverride,
	controls,
}: {
	className?: string;
	onClick?: () => void;
	collapsed?: boolean;
	/** The collapsed trigger's peek popover: sets aria-controls and an aria-expanded that follows it. */
	controls?: {id: string; expanded: boolean};
}) {
	const state = useSidebarState();
	const collapsed = collapsedOverride ?? state.collapsed;
	const {keys, ariaKeyShortcuts} = useShortcutKeys("toggle_sidebar");
	const label: ToggleLabel = collapsed ? "Show sidebar" : "Hide sidebar";
	const buttonRef = useRef<HTMLButtonElement>(null);

	useLayoutEffect(() => {
		if (pendingFocus !== label) return;
		pendingFocus = undefined;
		buttonRef.current?.focus();
	}, [label]);

	function toggle(): void {
		handOffFocus(collapsed ? "Hide sidebar" : "Show sidebar");
		onClick();
	}

	return (
		<Tooltip
			content={label}
			shortcut={keys}
			side="bottom"
			{...(collapsed ? {openWhen: () => !isPeekSuppressed()} : {})}
		>
			<button
				ref={buttonRef}
				type="button"
				onClick={(event) => {
					// A mouse click (detail > 0) leaves the pointer over the trigger that replaces Hide.
					if (!collapsed && event.detail > 0) suppressPeekUntilLeave();
					toggle();
				}}
				onKeyDown={(event) => {
					// Handle Enter directly (suppressing the native click) so it toggles exactly once.
					if (event.key !== "Enter") return;
					event.preventDefault();
					toggle();
				}}
				aria-label={label}
				aria-keyshortcuts={ariaKeyShortcuts}
				aria-controls={controls?.id}
				aria-expanded={controls?.expanded}
				// Collapsed, the Show sidebar trigger stands in for the navigation F6 stop, as upstream.
				{...(collapsed ? {"data-focus-region": "navigation"} : {})}
				className={
					className ??
					"flex h-8 w-8 items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover"
				}
			>
				<SidebarToggleIcon />
			</button>
		</Tooltip>
	);
}
