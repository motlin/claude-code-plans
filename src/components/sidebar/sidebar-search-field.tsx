import {Search} from "lucide-react";
import {openCommandPalette} from "../../hooks/use-command-palette";
import {useShortcutKeys} from "../../hooks/use-shortcut";
import {Shortcut} from "../ui/shortcut";
import {NAV_ROW_CLASS, NAV_ROW_HINT_CLASS} from "./new-session-row";

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
 * Upstream's sidebar Search entry (`Gx`, non-classic under the hub rail, graduated from fizzy-lake
 * `panels`): a plain nav row right under New, in the nav block's tab stop, that opens the ⌘K
 * "search or start" palette.
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
