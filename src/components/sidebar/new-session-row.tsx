import {Link, useNavigate} from "@tanstack/react-router";
import {Plus} from "lucide-react";
import type {MouseEvent} from "react";
import {useShortcutKeys} from "../../hooks/use-shortcut";
import {requestHomeComposerFocus} from "../../lib/home-composer-focus";
import {Shortcut} from "../ui/shortcut";

const ROW_CLASS =
	"group mb-[0.5px] flex h-[var(--sb-row-h)] min-w-0 flex-1 items-center gap-[var(--sb-row-gap)] rounded-[var(--sb-radius)] px-[var(--sb-row-px)] text-left text-[length:var(--sb-row-font)] leading-[1.5] text-secondary no-underline hover:bg-[var(--sb-hover)] focus-visible:bg-[var(--sb-hover)] [&_.df-leading-slot]:text-secondary";

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
			<span className="w-6 shrink-0" />
			<Link to="/" onClick={onClick} aria-keyshortcuts={shortcut.ariaKeyShortcuts} className={ROW_CLASS}>
				<span className="df-leading-slot">
					<Plus aria-hidden="true" />
				</span>
				<span className="min-w-0 flex-1 truncate">New</span>
				<span className="df-tail-mark opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:hidden">
					<Shortcut keys={shortcut.keys} />
				</span>
			</Link>
		</div>
	);
}
