import {useInfiniteQuery} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {Fragment, useState} from "react";
import {SlidersVertical} from "lucide-react";

import {recentSessionsInfiniteQueryOptions} from "../../lib/api/sessions";
import {sectionGroupByLabels, sessionSortByLabels, sessionSortDirectionLabels} from "../../lib/schema-choices";
import {SessionSortDirectionSchema, type SessionListPrefs} from "../../lib/session-groups";
import {createGroup} from "../../lib/session-group-store";
import
{
	DEFAULT_SECTION_VIEW,
	type SectionGroupBy,
	setSidebarSectionView,
	type SidebarSection,
} from "../../lib/sidebar-sections";
import
{
	Menu,
	MenuCheckboxItem,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "../ui/menu";
import {NewGroupDialog} from "../new-group-dialog";
import {Tooltip} from "../ui/tooltip";

/** Upstream `tz`'s reason on Reset to defaults while the grouping and sort already are. */
const AT_DEFAULTS_REASON = "Grouping and sorting are already at their defaults.";
/** Upstream `GN`'s reason on View all while there is nothing to view. */
const NOTHING_TO_VIEW_REASON = "There are no other sessions to view.";

/** Upstream's Last updated and Date created, then Name. */
const SORT_BY_ORDER = ["activity", "created", "name"] as const satisfies readonly SessionListPrefs["sortBy"][];

/**
 * Upstream `OO` filters `Y8` to Date, Status and None for a manual section: Folder and Environment
 * group the whole column, so only Recents offers them.
 */
const MANUAL_GROUP_BY_ORDER = ["date", "status"] as const satisfies readonly SectionGroupBy[];

/** A radio group, with an optional heading (Show's local-only list filters carry one). */
export function ChoiceGroup<Value extends string>({
	label,
	value,
	options,
	labels,
	onSelect,
}: {
	label?: string;
	value: Value;
	options: readonly Value[];
	labels: Record<Value, string>;
	onSelect: (next: Value) => void;
})
{
	return (
		<MenuRadioGroup
			value={value}
			onValueChange={(next: unknown) =>
			{
				const selected = options.find((option) => option === next);
				if (selected !== undefined) onSelect(selected);
			}}
		>
			{label !== undefined && <MenuLabel>{label}</MenuLabel>}
			{options.map((option) => (
				<MenuRadioItem key={option} value={option}>
					{labels[option]}
				</MenuRadioItem>
			))}
		</MenuRadioGroup>
	);
}

/**
 * Upstream's Group by ▸ submenu (`Y8` + `nq`): the groupings, a separator, then None, as radios.
 */
export function GroupBySubmenu<Value extends string>({
	value,
	accent,
	options,
	none,
	labels,
	onSelect,
}: {
	value: Value;
	/** The grouping differs from its default, so the trigger's value reads in the accent ink. */
	accent: boolean;
	/** Every grouping before the separator. */
	options: readonly Value[];
	none: Value;
	labels: Record<Value, string>;
	onSelect: (next: Value) => void;
})
{
	return (
		<MenuSub>
			<MenuSubTrigger value={labels[value]} valueAccent={accent}>
				Group by
			</MenuSubTrigger>
			<MenuSubContent>
				<MenuRadioGroup
					value={value}
					onValueChange={(next: unknown) =>
					{
						const selected = [...options, none].find((option) => option === next);
						if (selected !== undefined) onSelect(selected);
					}}
				>
					{options.map((option) => (
						<MenuRadioItem key={option} value={option}>
							{labels[option]}
						</MenuRadioItem>
					))}
					<MenuSeparator />
					<MenuRadioItem value={none}>{labels[none]}</MenuRadioItem>
				</MenuRadioGroup>
			</MenuSubContent>
		</MenuSub>
	);
}

/** Upstream's Sort by ▸ submenu: the sorts, a separator, then Descending / Ascending. */
export function SortBySubmenu({
	sortBy,
	sortDirection,
	onSortBy,
	onSortDirection,
}: {
	sortBy: SessionListPrefs["sortBy"];
	sortDirection: SessionListPrefs["sortDirection"];
	onSortBy: (next: SessionListPrefs["sortBy"]) => void;
	onSortDirection: (next: SessionListPrefs["sortDirection"]) => void;
})
{
	return (
		<MenuSub>
			<MenuSubTrigger
				value={sessionSortByLabels[sortBy]}
				valueAccent={
					sortBy !== DEFAULT_SECTION_VIEW.sortBy || sortDirection !== DEFAULT_SECTION_VIEW.sortDirection
				}
			>
				Sort by
			</MenuSubTrigger>
			<MenuSubContent>
				<ChoiceGroup value={sortBy} options={SORT_BY_ORDER} labels={sessionSortByLabels} onSelect={onSortBy} />
				<MenuSeparator />
				<ChoiceGroup
					value={sortDirection}
					options={SessionSortDirectionSchema.options}
					labels={sessionSortDirectionLabels}
					onSelect={onSortDirection}
				/>
			</MenuSubContent>
		</MenuSub>
	);
}

/** Upstream's `df-chrome-btn` "Group and sort" header trigger: 24px, with a 20px header glyph. */
export function GroupSortTrigger()
{
	return (
		<Tooltip content="Group and sort" className="-my-1 shrink-0">
			<MenuTrigger
				aria-label="Group and sort"
				data-row-action=""
				data-row-glyph=""
				className="relative flex size-6 shrink-0 items-center justify-center rounded-r5 text-[color:var(--sb-heading-ink,var(--color-secondary))] hover:text-primary data-[popup-open]:text-primary aria-expanded:text-primary hover:bg-[var(--sb-hover)] hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus data-[popup-open]:bg-[var(--sb-hover)]"
			>
				<SlidersVertical aria-hidden="true" className="size-5" />
			</MenuTrigger>
		</Tooltip>
	);
}

/**
 * Upstream `GN` View all: it opens the Sessions page, waits with "Loading…" while the list loads, and
 * is disabled with a reason while there are no sessions at all.
 */
function ViewAllItem({statusFilter}: {statusFilter: SessionListPrefs["statusFilter"]})
{
	const navigate = useNavigate();
	// Shares the list's query cache, so this adds no request.
	const {data, isPending} = useInfiniteQuery(recentSessionsInfiniteQueryOptions(undefined, statusFilter));
	const empty = data?.pages.every((page) => page.sessions.length === 0) ?? false;
	return (
		<MenuItem
			disabled={isPending || empty}
			disabledReason={isPending ? undefined : NOTHING_TO_VIEW_REASON}
			{...(isPending
				?
					{
						trailing: "Loading…",
					}
				: {})}
			onSelect={() =>
				void navigate(
					{
						to: "/sessions",
					},
				)
			}
		>
			View all
		</MenuItem>
	);
}

/** Upstream `tz`: ─ New section ─ Reset to defaults (disabled at defaults, with its reason) and View all. */
export function GroupSortFooter({
	atDefaults,
	onReset,
	onNewSection,
	statusFilter,
}: {
	atDefaults: boolean;
	onReset: () => void;
	onNewSection: () => void;
	statusFilter: SessionListPrefs["statusFilter"];
})
{
	return (
		<Fragment>
			<MenuSeparator />
			<MenuItem onSelect={onNewSection}>New section</MenuItem>
			<MenuSeparator />
			<MenuItem disabled={atDefaults} disabledReason={AT_DEFAULTS_REASON} onSelect={onReset}>
				Reset to defaults
			</MenuItem>
			<ViewAllItem statusFilter={statusFilter} />
		</Fragment>
	);
}

/** The New section dialog behind a Group and sort menu's New section; creating one changes no grouping. */
export function NewSectionDialog({open, onOpenChange}: {open: boolean; onOpenChange: (open: boolean) => void})
{
	return (
		<NewGroupDialog
			open={open}
			onOpenChange={onOpenChange}
			onCreate={(name) =>
			{
				createGroup(name);
			}}
		/>
	);
}

/**
 * Upstream `P6`/`Rf`: a manual section's own Group and sort. Group by Date or Status splits the
 * section under its own headings; Sort by orders it; Show ▸ Metadata gives it two-line rows.
 */
export function SectionViewMenu({
	section,
	statusFilter,
}: {
	section: SidebarSection;
	statusFilter: SessionListPrefs["statusFilter"];
})
{
	const [newSectionOpen, setNewSectionOpen] = useState(false);
	const groupBy = section.groupBy === "date" || section.groupBy === "status" ? section.groupBy : "none";
	const atDefaults =
		groupBy === "none" &&
		section.sortBy === DEFAULT_SECTION_VIEW.sortBy &&
		section.sortDirection === DEFAULT_SECTION_VIEW.sortDirection;
	return (
		<>
			<Menu>
				<GroupSortTrigger />
				<MenuContent align="end" density="comfortable" className="!min-w-[200px]">
					<GroupBySubmenu
						value={groupBy}
						accent={groupBy !== "none"}
						options={MANUAL_GROUP_BY_ORDER}
						none="none"
						labels={sectionGroupByLabels}
						onSelect={(next) =>
						{
							setSidebarSectionView(
								section.id,
								{
									groupBy: next === "none" ? null : next,
								},
							);
						}}
					/>
					<SortBySubmenu
						sortBy={section.sortBy}
						sortDirection={section.sortDirection}
						onSortBy={(next) =>
						{
							setSidebarSectionView(
								section.id,
								{
									sortBy: next,
								},
							);
						}}
						onSortDirection={(next) =>
						{
							setSidebarSectionView(
								section.id,
								{
									sortDirection: next,
								},
							);
						}}
					/>
					<MenuSub>
						<MenuSubTrigger>Show</MenuSubTrigger>
						<MenuSubContent>
							<MenuCheckboxItem
								checked={section.show.metadata}
								onCheckedChange={(checked) =>
								{
									setSidebarSectionView(
										section.id,
										{
											show:
											{
												metadata: checked,
											},
										},
									);
								}}
							>
								Metadata
							</MenuCheckboxItem>
						</MenuSubContent>
					</MenuSub>
					<GroupSortFooter
						atDefaults={atDefaults}
						onReset={() =>
						{
							setSidebarSectionView(
								section.id,
								{
									groupBy: null,
									sortBy: DEFAULT_SECTION_VIEW.sortBy,
									sortDirection: DEFAULT_SECTION_VIEW.sortDirection,
								},
							);
						}}
						onNewSection={() =>
						{
							setNewSectionOpen(true);
						}}
						statusFilter={statusFilter}
					/>
				</MenuContent>
			</Menu>
			<NewSectionDialog open={newSectionOpen} onOpenChange={setNewSectionOpen} />
		</>
	);
}
