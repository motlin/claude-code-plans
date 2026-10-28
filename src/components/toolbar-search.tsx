import {Search, X} from "lucide-react";
import {useEffect, useRef, useState} from "react";

import {useShortcut, useShortcutKeys} from "../hooks/use-shortcut";
import {Tooltip} from "./ui/tooltip";

/** Upstream's 24x24 r6 page-toolbar icon button with an ink icon (the Artifacts and Routines toolbars); pressed paints accent ink on the accent tint. */
export const TOOLBAR_ICON_BUTTON =
	"flex size-6 shrink-0 items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus aria-pressed:bg-upstream-accent-pressed aria-pressed:text-upstream-accent [&_svg]:size-4";

/** Upstream's cds TextInput shell (24px `h-control`, r6, `bg-fill-field`, field ring, accent focus shadow; 8px / 3px insets). */
export const TOOLBAR_SEARCH_FIELD_CLASS =
	"inline-flex h-6 w-full min-w-0 cursor-text items-center gap-1.5 rounded-r5 bg-fill-field ps-2 pe-[3px] font-sans text-body font-normal text-primary shadow-field-ring transition duration-150 has-[:focus-visible]:shadow-focus [&:hover:not(:focus-visible):not(:has(:focus-visible))]:shadow-field-hover";

/** Upstream's ghost sm "Clear search" button nested in the field: 18px, radius 6 - (24 - 18) / 2 = 3px. */
export const TOOLBAR_SEARCH_CLEAR_CLASS =
	"flex size-[18px] shrink-0 items-center justify-center rounded-r2 text-ink-muted transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/**
 * A page toolbar's inline search: an icon button with a "<label> ⌘F" tooltip that expands into a search box,
 * on click or on the page-scoped ⌘F (Ctrl+F elsewhere), which also refocuses an already-open box.
 * Escape or blur with an empty draft collapses it; `onOpenChange` lets the header mark its controls `data-search-open`.
 */
export function ToolbarSearch({
	label,
	placeholder,
	search,
	onSearch,
	onOpenChange,
}: {
	label: string;
	placeholder: string;
	search: string;
	onSearch: (next: string) => void;
	/** Should be stable (a state setter): it runs whenever the open state settles. */
	onOpenChange?: (open: boolean) => void;
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

	useEffect(() => {
		onOpenChange?.(open);
	}, [open, onOpenChange]);

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
		<div
			role="search"
			className="flex max-w-full min-w-40 grow items-center gap-3 @min-[640px]:justify-end basis-40"
		>
			<div className="w-0 min-w-40 flex-1 @min-[640px]:max-w-sm">
				<div data-cds="TextInput" className={TOOLBAR_SEARCH_FIELD_CLASS}>
					<Search aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
					<input
						ref={inputRef}
						type="search"
						autoComplete="off"
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
						onBlur={(event) => {
							if (draft === "" && !event.currentTarget.parentElement?.contains(event.relatedTarget))
								setOpen(false);
						}}
						className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-body font-normal text-primary outline-none placeholder:text-ink-muted [&::-webkit-search-cancel-button]:hidden"
					/>
					<button
						type="button"
						aria-label="Clear search"
						className={TOOLBAR_SEARCH_CLEAR_CLASS}
						onClick={() => {
							setDraft("");
							onSearch("");
							setOpen(false);
						}}
					>
						<X aria-hidden="true" className="size-3.5" />
					</button>
				</div>
			</div>
		</div>
	);
}
