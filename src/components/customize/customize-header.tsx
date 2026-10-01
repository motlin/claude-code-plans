import {useQuery} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
import {ArrowDownUp, Search, SlidersHorizontal, X} from "lucide-react";
import {type ReactNode, useEffect, useState} from "react";
import {customizeDiscoverQueryOptions} from "../../lib/api/customize";
import {SegmentedControl} from "../settings/segmented-control";
import {Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger} from "../ui/menu";
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
	"relative isolate inline-flex h-8 shrink-0 items-center justify-center px-3 text-body font-medium whitespace-nowrap text-t6 no-underline outline-none select-none before:absolute before:inset-x-px before:inset-y-0 before:-z-[1] before:rounded-r6 hover:text-secondary hover:before:bg-fill-ghost-hover focus-visible:before:outline-2 focus-visible:before:outline-accent-100 aria-selected:text-primary aria-selected:before:bg-fill-ghost-hover";

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
	const searching = (search.q ?? "") !== "";
	// Discover swaps the Yours Filter and Sort for category and catalog-order menus.
	const discover = section.hasDiscover && search.view === "discover";
	const {data: catalog} = useQuery({...customizeDiscoverQueryOptions, enabled: discover});
	const sortOptions = section.sort;
	const sort = useSectionSort(section.sortStorageKey, search.sort);

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
							onValueChange={(view) => updateSearch({view: view === "yours" ? undefined : view})}
							options={VIEW_OPTIONS}
						/>
					</div>
				)}
			</div>
			<div data-customize-controls="" className="flex min-w-0 flex-wrap items-center justify-end gap-1">
				<SearchField
					placeholder={section.searchPlaceholder}
					value={search.q ?? ""}
					onChange={(q) => updateSearch({q})}
				/>
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
							disabled={searching}
							onChange={(category) => updateSearch({category})}
						/>
						<OptionMenu
							label="Sort"
							groupLabel="Sort by"
							icon={<ArrowDownUp aria-hidden="true" className="size-5" />}
							options={DISCOVER_SORT_OPTIONS}
							value={search.order}
							disabled={searching}
							onChange={(order) => updateSearch({order})}
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
						disabled={searching}
						onChange={(filter) => updateSearch({filter})}
					/>
				)}
				{sortOptions !== null && !discover && (
					<OptionMenu
						label={`Sort by ${resolveOption(sortOptions, sort).label}`}
						groupLabel="Sort by"
						icon={<ArrowDownUp aria-hidden="true" className="size-5" />}
						options={sortOptions}
						value={sort}
						disabled={searching}
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

/** The search with empty and unset keys removed, so URLs and state stay minimal. */
export function dropEmpty(search: CustomizeSearch): CustomizeSearch {
	const result: CustomizeSearch = {};
	if (search.q !== undefined && search.q !== "") result.q = search.q;
	if (search.view !== undefined) result.view = search.view;
	if (search.filter !== undefined) result.filter = search.filter;
	if (search.sort !== undefined) result.sort = search.sort;
	if (search.category !== undefined) result.category = search.category;
	if (search.order !== undefined) result.order = search.order;
	return result;
}

interface SearchFieldProps {
	placeholder: string;
	value: string;
	onChange: (value: string) => void;
}

function SearchField({placeholder, value, onChange}: SearchFieldProps) {
	// Local draft keeps the caret stable while each keystroke updates `?q=`.
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);

	const change = (next: string) => {
		setDraft(next);
		onChange(next);
	};

	return (
		<div className="inline-flex h-8 w-64 cursor-text items-center gap-1.5 rounded-r6 bg-surface-0/50 px-3 shadow-[inset_0_0_0_1px_var(--color-border)] has-[:focus-visible]:shadow-[inset_0_0_0_1px_var(--color-accent-100)]">
			<Search aria-hidden="true" className="size-4 shrink-0 text-t6" />
			<input
				type="search"
				placeholder={placeholder}
				aria-label={placeholder}
				maxLength={200}
				value={draft}
				onChange={(event) => change(event.target.value)}
				data-testid="customize-header-search"
				className="min-w-0 flex-1 bg-transparent text-body text-primary outline-none placeholder:text-t6 [&::-webkit-search-cancel-button]:hidden"
			/>
			{draft !== "" && (
				<button
					type="button"
					aria-label="Clear search"
					onClick={() => change("")}
					className="inline-flex size-5 shrink-0 items-center justify-center rounded-r3 text-t6 hover:text-primary"
				>
					<X aria-hidden="true" className="size-3.5" />
				</button>
			)}
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
					onValueChange={(next: string) => onChange(next === defaultValue ? undefined : next)}
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
