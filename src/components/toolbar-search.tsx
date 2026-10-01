import {Search, X} from "lucide-react";
import {useRef, useState} from "react";

import {useShortcut, useShortcutKeys} from "../hooks/use-shortcut";
import {Tooltip} from "./ui/tooltip";

/** Upstream's 24x24 r6 page-toolbar icon button with an ink icon (the Artifacts and Routines toolbars). */
export const TOOLBAR_ICON_BUTTON =
	"flex size-6 shrink-0 items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-100 aria-pressed:text-accent-100 [&_svg]:size-4";

/**
 * A page toolbar's inline search: an icon button with a "<label> ⌘F" tooltip that expands into a search box,
 * on click or on the page-scoped ⌘F (Ctrl+F elsewhere), which also refocuses an already-open box.
 */
export function ToolbarSearch({
	label,
	placeholder,
	search,
	onSearch,
}: {
	label: string;
	placeholder: string;
	search: string;
	onSearch: (next: string) => void;
}) {
	const [open, setOpen] = useState(search !== "");
	const [draft, setDraft] = useState(search);
	const [syncedSearch, setSyncedSearch] = useState(search);
	const inputRef = useRef<HTMLInputElement>(null);
	const shortcutKeys = useShortcutKeys("page_search").keys;

	if (search !== syncedSearch) {
		setSyncedSearch(search);
		setDraft(search);
		if (search !== "") setOpen(true);
	}

	function expand() {
		setOpen(true);
		requestAnimationFrame(() => inputRef.current?.focus());
	}

	useShortcut("page_search", expand);

	if (!open) {
		return (
			<Tooltip content={label} shortcut={shortcutKeys}>
				<button type="button" className={TOOLBAR_ICON_BUTTON} aria-label={label} onClick={expand}>
					<Search aria-hidden="true" />
				</button>
			</Tooltip>
		);
	}

	return (
		<div className="flex h-8 w-64 items-center gap-1 rounded-md border border-border bg-surface-1 px-2 text-body">
			<Search aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
			<input
				ref={inputRef}
				type="search"
				autoFocus
				aria-label={label}
				placeholder={placeholder}
				value={draft}
				onChange={(event) => {
					setDraft(event.target.value);
					onSearch(event.target.value);
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape" && draft === "") setOpen(false);
				}}
				className="min-w-0 flex-1 bg-transparent text-primary outline-none placeholder:text-ink-muted [&::-webkit-search-cancel-button]:hidden"
			/>
			<button
				type="button"
				aria-label="Clear search"
				className="flex size-5 shrink-0 items-center justify-center rounded text-ink-muted hover:text-primary"
				onClick={() => {
					setDraft("");
					onSearch("");
					setOpen(false);
				}}
			>
				<X aria-hidden="true" className="size-3.5" />
			</button>
		</div>
	);
}
