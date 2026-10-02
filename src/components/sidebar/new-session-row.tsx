import {Link, useNavigate} from "@tanstack/react-router";
import {Plus} from "lucide-react";
import type {MouseEvent} from "react";
import {useShortcutKeys} from "../../hooks/use-shortcut";
import {requestHomeComposerFocus} from "../../lib/home-composer-focus";
import {Shortcut} from "../ui/shortcut";

const ROW_CLASS =
	"group df-nav-row h-[var(--sb-row-h)] rounded-[var(--sb-radius)] flex-1 data-[selected=focused]:[&_.df-leading-slot]:text-primary";

/**
 * Upstream's sticky "New" row: goes home and focuses the composer, exactly like ⇧⌘O, and reveals
 * the ⇧⌘O keycaps at its trailing edge on hover.
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
				aria-keyshortcuts={shortcut.ariaKeyShortcuts}
				className={ROW_CLASS}
			>
				<span className="df-leading-slot">
					<span className="df-new-icon-circle">
						<Plus aria-hidden="true" />
					</span>
				</span>
				<span className="min-w-0 flex-1 truncate">New</span>
				<span className="df-tail-mark opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:hidden">
					<Shortcut keys={shortcut.keys} />
				</span>
			</Link>
		</div>
	);
}
