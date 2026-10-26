import {Link, useNavigate} from "@tanstack/react-router";
import {Plus} from "lucide-react";
import type {MouseEvent} from "react";
import {useShortcutKeys} from "../../hooks/use-shortcut";
import {requestHomeComposerFocus} from "../../lib/home-composer-focus";
import {Shortcut} from "../ui/shortcut";
import {Tooltip} from "../ui/tooltip";

const ROW_CLASS =
	"group df-nav-row h-[var(--sb-row-h)] rounded-[var(--sb-radius)] flex-1 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),0_0_6px_0_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)] hover:[&_.df-leading-slot]:text-primary data-[selected=focused]:[&_.df-leading-slot]:text-primary";

/**
 * Upstream's sticky "New" row: goes home and focuses the composer, exactly like ⇧⌘O, and reveals
 * the ⇧⌘O shortcut text at its trailing edge on hover.
 */
export function NewSessionRow() {
	const navigate = useNavigate();
	const shortcut = useShortcutKeys("new_session");

	function onClick(event: MouseEvent<HTMLAnchorElement>) {
		// Modified clicks keep the browser's open-in-new-tab behavior.
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		void navigate({to: "/"}).then(requestHomeComposerFocus);
	}

	return (
		<div className="flex items-center">
			<Link
				to="/"
				activeOptions={{exact: true, includeSearch: false}}
				activeProps={{"data-selected": "focused"}}
				onClick={onClick}
				data-row=""
				data-roving-item=""
				aria-label="New"
				aria-keyshortcuts={shortcut.ariaKeyShortcuts}
				className={ROW_CLASS}
			>
				<span className="df-leading-slot [--sb-icon:16px]">
					<span className="df-new-icon-circle">
						<Plus aria-hidden="true" />
					</span>
				</span>
				<span className="min-w-0 flex-1 truncate">New</span>
				<span className="ml-1 mr-2 flex shrink-0 items-center opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:hidden">
					<Shortcut
						keys={shortcut.keys}
						variant="text"
						className="[--shortcut-cap-ink:var(--color-ink-muted)] [&>kbd]:inline-flex [&>kbd]:gap-[0.3em] [&>kbd]:leading-none"
					/>
				</span>
			</Link>
		</div>
	);
}

/**
 * Upstream's "+" New session button on the first sidebar section header: always visible, it goes
 * home and focuses the composer like the New row, with the same ⇧⌘O in its tooltip.
 */
export function NewSessionHeaderButton() {
	const navigate = useNavigate();
	const shortcut = useShortcutKeys("new_session");
	return (
		<Tooltip content="New session" shortcut={shortcut.keys} className="-my-1 shrink-0">
			<button
				type="button"
				aria-label="New session"
				aria-keyshortcuts={shortcut.ariaKeyShortcuts}
				data-row-action=""
				// The list keeps one roving tab stop; the New row and ⇧⌘O reach the same action by keyboard.
				tabIndex={-1}
				onClick={() => void navigate({to: "/"}).then(requestHomeComposerFocus)}
				className="relative flex size-6 shrink-0 items-center justify-center rounded-r5 text-[color:var(--sb-heading-ink,var(--color-secondary))] hover:text-primary data-[popup-open]:text-primary aria-expanded:text-primary hover:bg-[var(--sb-hover)] hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
			>
				<Plus aria-hidden="true" className="size-4" />
			</button>
		</Tooltip>
	);
}
