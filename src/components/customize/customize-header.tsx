import {useQuery} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
import {ArrowDownUp, Search, SlidersHorizontal, X} from "lucide-react";
import {type ReactNode, type RefObject, useEffect, useEffectEvent, useRef, useState} from "react";
import {customizeDiscoverQueryOptions} from "../../lib/api/customize";
import {PHONE_SHEET_QUERY, SETTINGS_WIDE_QUERY, useCoarsePointer, useMediaQuery} from "../../lib/use-phone-sheet";
import {SegmentedControl} from "../settings/segmented-control";
import {Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger} from "../ui/menu";
import {Tooltip} from "../ui/tooltip";
import {CustomizeAddMenu} from "./customize-add-menu";
import {DISCOVER_SORT_OPTIONS, discoverCategoryOptions, discoverForSection} from "./discover-view";
import {useSectionSort, writeStoredSort} from "./persisted-sort";
import {
	CUSTOMIZE_SECTIONS,
	type CustomizeSearch,
	type CustomizeSectionConfig,
	type MenuOption,
	resolveOption,
} from "./sections";

const TAB_CLASS =
	"relative isolate inline-flex h-8 shrink-0 items-center justify-center px-3 text-body font-medium whitespace-nowrap text-t6 dark:text-ink-muted no-underline outline-none select-none before:absolute before:inset-x-px before:inset-y-0 before:-z-[1] before:rounded-r6 hover:text-secondary hover:before:bg-fill-ghost-hover focus-visible:before:outline-2 focus-visible:before:outline-accent-100 aria-selected:text-primary aria-selected:before:bg-fill-ghost-hover";

const ICON_BUTTON_CLASS =
	"inline-flex size-8 shrink-0 items-center justify-center rounded-r6 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary aria-expanded:text-primary disabled:pointer-events-none disabled:opacity-50";

const VIEW_OPTIONS = [
	{value: "yours", label: "Yours"},
	{value: "discover", label: "Discover"},
] as const;

interface CustomizeHeaderProps {
	section: CustomizeSectionConfig;
	search: CustomizeSearch;
	/** Applies a change to the search state; an `undefined` value clears that key. */
	onSearchChange: (patch: Partial<CustomizeSearch>) => void;
	/** Inside the Settings dialog the nav names the section, so the H1 and section tabs are dropped. */
	embedded?: boolean;
}

/**
 * Upstream Customize `PageHeader`: serif H1, section tabs, the Yours | Discover
 * segmented control, and the right-hand search, Filter, Sort and Add controls.
 */
export function CustomizeHeader({
	section,
	search,
	onSearchChange: updateSearch,
	embedded = false,
}: CustomizeHeaderProps) {
	// Upstream's dialog keeps Filter and Sort live over its unified results; the page still disables them.
	const menusLocked = !embedded && (search.q ?? "") !== "";
	// Discover swaps the Yours Filter and Sort for category and catalog-order menus.
	const discover = section.hasDiscover && search.view === "discover";
	const {data: catalog} = useQuery({...customizeDiscoverQueryOptions, enabled: discover});
	const sortOptions = section.sort;
	const sort = useSectionSort(section.sortStorageKey, search.sort);
	// Upstream's width gate: at ≥768px the dialog keeps its nav and shows the always-visible field.
	const wide = useMediaQuery(SETTINGS_WIDE_QUERY);

	return (
		<header className="flex flex-wrap justify-between gap-x-3 gap-y-4">
			{!embedded && (
				<div className="flex min-h-12 basis-full items-center">
					<h1 className="min-w-0 font-voice text-[24px]/[32px] font-medium text-primary">Customize</h1>
				</div>
			)}
			<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
				{!embedded && (
					<nav aria-label="Customize" className="flex shrink-0 items-center">
						<div role="tablist" aria-label="Customize sections" className="flex items-center">
							{CUSTOMIZE_SECTIONS.map((tab) => (
								<Link
									key={tab.id}
									to={tab.to}
									search={tab.hasDiscover && search.view !== undefined ? {view: search.view} : {}}
									id={`customize-tab-${tab.id}`}
									role="tab"
									aria-selected={tab.id === section.id}
									aria-controls="customize-pane"
									data-testid={`customize-${tab.id}-settings`}
									className={TAB_CLASS}
								>
									{tab.label}
								</Link>
							))}
						</div>
					</nav>
				)}
				{section.hasDiscover && (
					<div
						className={`flex shrink-0 items-center gap-3 ${embedded ? "" : "before:h-5 before:w-px before:shrink-0 before:bg-border"}`}
					>
						<SegmentedControl<"yours" | "discover">
							aria-label={section.label}
							value={search.view ?? "yours"}
							onValueChange={(view) => {
								updateSearch({view: view === "yours" ? undefined : view});
							}}
							options={VIEW_OPTIONS}
						/>
					</div>
				)}
			</div>
			<div
				data-customize-controls=""
				className="flex min-w-min flex-1 basis-0 flex-nowrap items-center justify-end gap-2"
			>
				{embedded && wide ? (
					<FixedSearchField
						placeholder={section.searchPlaceholder}
						value={search.q ?? ""}
						onChange={(q) => {
							updateSearch({q});
						}}
					/>
				) : (
					<CollapsibleSearchField
						placeholder={section.searchPlaceholder}
						value={search.q ?? ""}
						onChange={(q) => {
							updateSearch({q});
						}}
						findShortcut={embedded}
					/>
				)}
				{discover && (
					<>
						<OptionMenu
							label="Filter"
							groupLabel="Category"
							icon={<SlidersHorizontal aria-hidden="true" className="size-5" />}
							options={discoverCategoryOptions(
								discoverForSection(
									catalog?.plugins ?? [],
									section.id === "skills" ? "skills" : "plugins",
								),
							)}
							value={search.category}
							disabled={menusLocked}
							onChange={(category) => {
								updateSearch({category});
							}}
						/>
						<OptionMenu
							label="Sort"
							groupLabel="Sort by"
							icon={<ArrowDownUp aria-hidden="true" className="size-5" />}
							options={DISCOVER_SORT_OPTIONS}
							value={search.order}
							disabled={menusLocked}
							onChange={(order) => {
								updateSearch({order});
							}}
						/>
					</>
				)}
				{!discover && (
					<OptionMenu
						label="Filter"
						groupLabel={section.filter.label}
						icon={<SlidersHorizontal aria-hidden="true" className="size-5" />}
						options={section.filter.options}
						value={search.filter}
						disabled={menusLocked}
						onChange={(filter) => {
							updateSearch({filter});
						}}
					/>
				)}
				{sortOptions !== null && !discover && (
					<OptionMenu
						label={`Sort by ${resolveOption(sortOptions, sort).label}`}
						groupLabel="Sort by"
						icon={<ArrowDownUp aria-hidden="true" className="size-5" />}
						options={sortOptions}
						value={sort}
						disabled={menusLocked}
						onChange={(next) => {
							const {sortStorageKey} = section;
							if (sortStorageKey !== undefined) {
								writeStoredSort(sortStorageKey, resolveOption(sortOptions, next).value);
							}
							updateSearch({sort: next});
						}}
					/>
				)}
				<CustomizeAddMenu section={section.id} />
			</div>
		</header>
	);
}

interface SearchFieldProps {
	placeholder: string;
	value: string;
	onChange: (value: string) => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.isContentEditable || target.closest("input, textarea, select, [contenteditable]") !== null;
}

/** Upstream's shortcut guard: skip a field that is aria-hidden, inert, or behind another modal dialog. */
function isHiddenFromShortcuts(element: HTMLElement | null): boolean {
	if (element === null) return false;
	if (element.closest('[aria-hidden="true"], [inert]') !== null) return true;
	const modals = document.querySelectorAll(
		'[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
	);
	return [...modals].some((modal) => !modal.contains(element));
}

interface SearchShortcutOptions {
	input: RefObject<HTMLInputElement | null>;
	anchor: RefObject<HTMLElement | null>;
	onTrigger: () => void;
	/** ⌘F (Ctrl+F) opens the search while focus is inside the surrounding dialog, unless the pointer is coarse. */
	findShortcut: boolean;
}

/** Upstream's search shortcuts: "/" outside a field, and ⌘F within the Settings dialog on a fine pointer. */
function useSearchShortcut({input, anchor, onTrigger, findShortcut}: SearchShortcutOptions) {
	const coarse = useCoarsePointer();
	const trigger = useEffectEvent(onTrigger);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const active = document.activeElement;
			const find =
				findShortcut &&
				!coarse &&
				event.metaKey !== event.ctrlKey &&
				(event.key === "f" || (event.key === "F" && !event.shiftKey)) &&
				(!isEditableTarget(active) || active === input.current) &&
				(anchor.current?.closest('[role="dialog"]')?.contains(active) ?? false);
			const slash =
				event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditableTarget(active);
			if ((!find && !slash) || isHiddenFromShortcuts(anchor.current ?? input.current)) return;
			event.preventDefault();
			trigger();
		};
		document.addEventListener("keydown", onKeyDown, {capture: true});
		return () => {
			document.removeEventListener("keydown", onKeyDown, {capture: true});
		};
	}, [input, anchor, findShortcut, coarse]);
	return coarse;
}

/** Local draft keeps the caret stable while each keystroke updates `?q=`. */
function useSearchDraft(value: string, onChange: (value: string) => void) {
	const [draft, setDraft] = useState(value);
	const [syncedValue, setSyncedValue] = useState(value);
	if (value !== syncedValue) {
		setSyncedValue(value);
		setDraft(value);
	}
	const change = (next: string) => {
		setDraft(next);
		onChange(next);
	};
	return [draft, change] as const;
}

function focusAtEnd(input: HTMLInputElement | null) {
	if (input === null) return;
	input.focus({preventScroll: true});
	input.setSelectionRange(input.value.length, input.value.length);
}

const SEARCH_INPUT_CLASS =
	"min-w-0 flex-1 bg-transparent text-body text-primary outline-none placeholder:text-t6 [&::-webkit-search-cancel-button]:hidden";

const CLEAR_BUTTON_CLASS =
	"inline-flex size-5 shrink-0 items-center justify-center rounded-r3 text-t6 hover:text-primary";

/**
 * Upstream's ≥768px dialog header search (`le` with `collapsible: false`): an always-visible 256px
 * field. Escape with text clears it without closing the dialog; on an empty field Escape reaches the
 * dialog. Clear search shows only while there is text.
 */
function FixedSearchField({placeholder, value, onChange}: SearchFieldProps) {
	const [draft, change] = useSearchDraft(value, onChange);
	const input = useRef<HTMLInputElement>(null);
	useSearchShortcut({
		input,
		anchor: input,
		onTrigger: () => {
			focusAtEnd(input.current);
		},
		findShortcut: false,
	});

	return (
		<div className="inline-flex h-8 w-64 min-w-0 cursor-text items-center gap-1.5 rounded-r6 ps-2 pe-2 bg-[var(--settings-field-bg)] shadow-field-ring [&:hover:not(:focus-visible):not(:has(:focus-visible))]:shadow-field-hover has-[:focus-visible]:shadow-focus">
			<Search aria-hidden="true" className="size-4 shrink-0 text-t6" />
			<input
				ref={input}
				type="search"
				placeholder={placeholder}
				aria-label="Search"
				maxLength={200}
				value={draft}
				onChange={(event) => {
					change(event.target.value);
				}}
				onKeyDown={(event) => {
					if (event.key !== "Escape" || event.nativeEvent.isComposing || draft === "") return;
					event.stopPropagation();
					change("");
				}}
				data-testid="customize-header-search"
				className={SEARCH_INPUT_CLASS}
			/>
			{draft !== "" && (
				<button
					type="button"
					aria-label="Clear search"
					onClick={() => {
						change("");
						input.current?.focus();
					}}
					className={CLEAR_BUTTON_CLASS}
				>
					<X aria-hidden="true" className="size-3.5" />
				</button>
			)}
		</div>
	);
}

interface CollapsibleSearchFieldProps extends SearchFieldProps {
	/** Inside the Settings dialog, ⌘F opens the search too (fine pointers only). */
	findShortcut: boolean;
}

/**
 * Upstream's collapsible Customize search (the page, and the dialog below 768px): a ghost magnifier
 * button while empty, expanding to a 256px field (192px below 640px) on click, "/" or ⌘F. Escape
 * clears the text first (without closing the Settings dialog), then collapses; Clear search and
 * blurring an empty field collapse it too, handing focus back to the magnifier.
 */
function CollapsibleSearchField({placeholder, value, onChange, findShortcut}: CollapsibleSearchFieldProps) {
	const [draft, change] = useSearchDraft(value, onChange);
	const [expanded, setExpanded] = useState(false);
	const phone = useMediaQuery(PHONE_SHEET_QUERY);
	const input = useRef<HTMLInputElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	// Set when a collapse should hand focus back to the magnifier as it mounts.
	const focusButton = useRef(false);
	const open = expanded || draft !== "";

	const collapse = () => {
		focusButton.current = true;
		setExpanded(false);
	};
	const coarse = useSearchShortcut({
		input,
		anchor: open ? input : button,
		onTrigger: () => {
			if (input.current) {
				focusAtEnd(input.current);
				return;
			}
			setExpanded(true);
		},
		findShortcut,
	});

	if (!open) {
		return (
			<Tooltip content="Search" {...(findShortcut && !coarse ? {shortcut: "cmd+f"} : {})}>
				<button
					ref={(element) => {
						button.current = element;
						if (element === null || !focusButton.current) return;
						focusButton.current = false;
						element.focus();
					}}
					type="button"
					aria-label="Search"
					onClick={() => {
						setExpanded(true);
					}}
					className="inline-flex size-8 shrink-0 items-center justify-center rounded-r6 text-secondary hover:bg-fill-ghost-hover hover:text-primary"
				>
					<Search aria-hidden="true" className="size-4" />
				</button>
			</Tooltip>
		);
	}

	return (
		<div
			role="search"
			className={`flex max-w-full min-w-40 grow items-center gap-2 md:justify-end ${phone ? "w-48" : "w-64"}`}
		>
			<div className="inline-flex h-8 min-w-0 flex-1 cursor-text items-center gap-1.5 rounded-r6 ps-2 pe-2 bg-[var(--settings-field-bg)] shadow-field-ring [&:hover:not(:focus-visible):not(:has(:focus-visible))]:shadow-field-hover has-[:focus-visible]:shadow-focus md:max-w-sm">
				<Search aria-hidden="true" className="size-4 shrink-0 text-t6" />
				<input
					ref={input}
					type="search"
					// oxlint-disable-next-line jsx-a11y/no-autofocus -- the field replaces the magnifier the user just pressed
					autoFocus
					autoComplete="off"
					placeholder={placeholder}
					aria-label="Search"
					maxLength={200}
					value={draft}
					onChange={(event) => {
						change(event.target.value);
					}}
					onKeyDown={(event) => {
						if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
						// An empty field lets Escape reach the Settings dialog, which closes. With text, Escape only
						// clears it: stopping propagation keeps Base UI's dismiss from closing the dialog too.
						if (draft === "") {
							collapse();
							return;
						}
						event.preventDefault();
						event.stopPropagation();
						change("");
					}}
					onBlur={() => {
						if (draft === "") setExpanded(false);
					}}
					className={SEARCH_INPUT_CLASS}
				/>
				{/* Upstream's open field always offers Clear search, which also collapses it */}
				<button
					type="button"
					aria-label="Clear search"
					onClick={() => {
						change("");
						collapse();
					}}
					className={CLEAR_BUTTON_CLASS}
				>
					<X aria-hidden="true" className="size-3.5" />
				</button>
			</div>
		</div>
	);
}

interface OptionMenuProps {
	label: string;
	groupLabel: string;
	icon: ReactNode;
	options: readonly MenuOption[];
	value: string | undefined;
	disabled: boolean;
	onChange: (value: string | undefined) => void;
}

function OptionMenu({label, groupLabel, icon, options, value, disabled, onChange}: OptionMenuProps) {
	const selected = resolveOption(options, value);
	const defaultValue = options[0]?.value;
	return (
		<Menu>
			<MenuTrigger aria-label={label} disabled={disabled} className={ICON_BUTTON_CLASS}>
				{icon}
			</MenuTrigger>
			<MenuContent align="end">
				<MenuLabel>{groupLabel}</MenuLabel>
				<MenuRadioGroup
					value={selected.value}
					onValueChange={(next: string) => {
						onChange(next === defaultValue ? undefined : next);
					}}
				>
					{options.map((option) => (
						<MenuRadioItem key={option.value} value={option.value}>
							{option.label}
						</MenuRadioItem>
					))}
				</MenuRadioGroup>
			</MenuContent>
		</Menu>
	);
}
