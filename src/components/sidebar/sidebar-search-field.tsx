import {Search} from "lucide-react";
import {openCommandPalette} from "../../hooks/use-command-palette";
import {useShortcutKeys} from "../../hooks/use-shortcut";
import {Shortcut} from "../ui/shortcut";

/**
 * Upstream's `.df-search-field`: the always-on sidebar Search row above New, which opens the
 * ⌘K "search or start" palette. Built on the `--sb-*` row tokens so it follows the sidebar density.
 */
export function SidebarSearchField() {
	const {keys, ariaKeyShortcuts} = useShortcutKeys("search_or_start");

	return (
		<div data-tab-section="" className="mb-2">
			<button
				type="button"
				data-row=""
				data-roving-item=""
				data-prefetch="palette"
				aria-keyshortcuts={ariaKeyShortcuts}
				onClick={() => {
					openCommandPalette("default");
				}}
				className="df-search-field hit-row hit-row-main [--cds-hit-gap-y:10px] flex h-[var(--sb-row-h)] w-full shrink-0 items-center gap-[var(--sb-row-gap)] rounded-[var(--sb-radius)] border-none bg-[var(--sb-field-bg)] px-[var(--sb-row-px)] text-start text-[length:var(--sb-row-font)] text-muted forced-colors:border forced-colors:border-solid focus-visible:outline-hidden"
			>
				<span
					data-leading-slot=""
					className="flex size-[var(--sb-leading-slot)] shrink-0 items-center justify-center"
				>
					<Search aria-hidden="true" className="size-4" />
				</span>
				<span data-row-label="" className="min-w-0 flex-1 truncate">
					Search
				</span>
				<span
					aria-hidden="true"
					className="df-search-field-keys flex shrink-0 items-center pe-[calc((var(--sb-row-h)-1em-6px)/2-var(--sb-row-px))] text-caption"
				>
					<Shortcut keys={keys} variant="keycap" />
				</span>
			</button>
		</div>
	);
}
