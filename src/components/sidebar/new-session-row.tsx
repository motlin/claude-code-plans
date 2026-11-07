import {Link, useNavigate} from "@tanstack/react-router";
import {Plus} from "lucide-react";
import type {MouseEvent} from "react";
import {useShortcutKeys} from "../../hooks/use-shortcut";
import {requestHomeComposerFocus} from "../../lib/home-composer-focus";
import {Shortcut} from "../ui/shortcut";

/** Upstream's sidebar header row (`Xx` variant nav), shared by New and the Search row under it. */
export const NAV_ROW_CLASS =
	"group df-nav-row w-full h-[var(--sb-row-h)] rounded-[var(--sb-radius)] flex-1 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),0_0_6px_0_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)] hover:[&_.df-leading-slot]:text-primary";

/**
 * Upstream's trailing text-variant Shortcut on the header rows: revealed by hover only (not by
 * focus-visible), with no fade transition. Like upstream it is `group-hover`, so a touch device
 * shows it only on a sticky hover.
 */
export const NAV_ROW_HINT_CLASS =
	"ms-1 me-[var(--sb-radius)] leading-none text-muted-as-secondary [--shortcut-cap-ink:currentColor] opacity-0 group-hover:opacity-100 [&>kbd]:inline-flex [&>kbd]:gap-[0.3em] [&>kbd]:leading-none";

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
				data-row-nav=""
				data-roving-item=""
				aria-label="New"
				aria-keyshortcuts={shortcut.ariaKeyShortcuts}
				className={NAV_ROW_CLASS}
			>
				<span className="df-leading-slot [--sb-icon:16px]">
					<span className="df-new-icon-circle">
						<Plus aria-hidden="true" />
					</span>
				</span>
				<span className="min-w-0 flex-1 truncate">New</span>
				<Shortcut keys={shortcut.keys} variant="text" hidden className={NAV_ROW_HINT_CLASS} />
			</Link>
		</div>
	);
}
