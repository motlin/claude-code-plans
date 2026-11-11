import {Search} from "lucide-react";
import {useEffect, useRef, useState} from "react";

import {useShortcut, useShortcutKeys} from "../hooks/use-shortcut";
import {Icon} from "./ui/icon";
import {TextInput} from "./ui/text-input";
import {Tooltip} from "./ui/tooltip";

/**
 * Upstream's page-toolbar icon button with an ink icon (the Artifacts and Routines toolbars): 24x24 r6, or the
 * fizzy-lake panels 28x28 r8 toolbar icon box on a fine pointer. Pressed paints accent ink on the accent tint.
 */
export const TOOLBAR_ICON_BUTTON =
	"flex size-6 panels-fine:size-7 shrink-0 items-center justify-center rounded-r5 panels-fine:rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus aria-pressed:bg-upstream-accent-pressed aria-pressed:text-upstream-accent [&_svg]:size-4";

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
				{/* Upstream offers Clear search always (clearable "always"); it also collapses the box. */}
				<TextInput
					ref={inputRef}
					type="search"
					autoComplete="off"
					// oxlint-disable-next-line jsx-a11y/no-autofocus -- the box replaces the button the user just pressed
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
					slotStart={<Icon name="Search" size="sm" />}
					clearable="always"
					clearLabel="Clear search"
					onClear={() => {
						setDraft("");
						onSearch("");
						setOpen(false);
					}}
				/>
			</div>
		</div>
	);
}
