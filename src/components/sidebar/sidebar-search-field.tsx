import {Search} from "lucide-react";
import {openCommandPalette} from "../../hooks/use-command-palette";
import {useShortcutKeys} from "../../hooks/use-shortcut";
import {Shortcut} from "../ui/shortcut";
import {NAV_ROW_CLASS, NAV_ROW_HINT_CLASS} from "./new-session-row";

/** The field's row wrapper and row classes, shared with the pre-hydration fallback so New does not shift on load. */
export const SEARCH_FIELD_WRAPPER_CLASS = "mb-2";
export const SEARCH_FIELD_CLASS =
	"df-search-field hit-row hit-row-main [--cds-hit-gap-y:10px] flex h-[var(--sb-row-h)] w-full shrink-0 items-center gap-[var(--sb-row-gap)] rounded-[var(--sb-radius)] border-none bg-[var(--sb-field-bg)] px-[var(--sb-row-px)] text-start text-[length:var(--sb-row-font)] text-ink-muted forced-colors:border forced-colors:border-solid focus-visible:outline-hidden";

/** The field's icon, label and keycap hint. */
export function SearchFieldContents({keys}: {keys: string}) {
	return (
		<>
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
		</>
	);
}

/**
 * Upstream's `.df-search-field` (fizzy-lake `panels` off): the sidebar Search field above New, which opens the
 * ⌘K "search or start" palette. Built on the `--sb-*` row tokens so it follows the sidebar density.
 */
export function SidebarSearchField() {
	const {keys, ariaKeyShortcuts} = useShortcutKeys("search_or_start");

	return (
		<div data-tab-section="" className={SEARCH_FIELD_WRAPPER_CLASS}>
			<button
				type="button"
				data-row=""
				data-roving-item=""
				data-prefetch="palette"
				aria-keyshortcuts={ariaKeyShortcuts}
				// Upstream prevents mousedown so a click never focuses the field; focus returns to whatever held it.
				onMouseDown={(event) => {
					event.preventDefault();
				}}
				onClick={() => {
					openCommandPalette("default", {source: "sidebar_field"});
				}}
				className={SEARCH_FIELD_CLASS}
			>
				<SearchFieldContents keys={keys} />
			</button>
		</div>
	);
}

/** The Search row's icon, fade-truncated label and text ⌘K hint, shared with the pre-hydration fallback. */
export function SearchRowContents({keys}: {keys: string}) {
	return (
		<>
			<span data-leading-slot="" className="df-on-rail df-leading-slot">
				<Search aria-hidden="true" />
			</span>
			<span className="flex min-w-0 flex-1 items-center">
				<span className="df-fade-truncate whitespace-nowrap">Search</span>
			</span>
			<Shortcut keys={keys} variant="text" hidden className={NAV_ROW_HINT_CLASS} />
		</>
	);
}

/**
 * Upstream's fizzy-lake `panels` Search entry (`Gx`, non-classic under the hub rail): a plain nav
 * row right under New, in the nav block's tab stop, that opens the ⌘K "search or start" palette.
 */
export function SidebarSearchRow() {
	const {keys, ariaKeyShortcuts} = useShortcutKeys("search_or_start");

	return (
		<button
			type="button"
			data-row=""
			data-roving-item=""
			data-row-main-button=""
			data-row-nav=""
			data-prefetch="palette"
			aria-keyshortcuts={ariaKeyShortcuts}
			// Upstream prevents mousedown so a click never focuses the row; focus returns to whatever held it.
			onMouseDown={(event) => {
				event.preventDefault();
			}}
			onClick={() => {
				openCommandPalette("default", {source: "sidebar_field"});
			}}
			className={NAV_ROW_CLASS}
		>
			<SearchRowContents keys={keys} />
		</button>
	);
}
