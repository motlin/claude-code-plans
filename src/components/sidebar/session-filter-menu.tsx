import {useInfiniteQuery} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {useState} from "react";
import {SlidersVertical} from "lucide-react";

import {recentSessionsInfiniteQueryOptions} from "../../lib/api/sessions";
import {
	sessionActivityDaysLabels,
	sessionGroupByLabels,
	sessionSortByLabels,
	sessionSortDirectionLabels,
	sessionStatusFilterLabels,
} from "../../lib/schema-choices";
import {
	DEFAULT_SESSION_LIST_PREFS,
	SessionActivityDaysSchema,
	SessionSortDirectionSchema,
	SessionStatusFilterSchema,
	type SessionListPrefs,
} from "../../lib/session-groups";
import {createGroup} from "../../lib/session-group-store";
import {useSettings} from "../settings-context";
import {
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
import {SessionGroups} from "./session-groups";
import {keepArrowsRoving} from "./use-roving-focus";

function RadioSubmenu<Value extends string>({
	label,
	value,
	defaultValue,
	options,
	labels,
	onSelect,
}: {
	label: string;
	value: Value;
	defaultValue: Value;
	options: readonly Value[];
	labels: Record<Value, string>;
	onSelect: (next: Value) => void;
}) {
	return (
		<MenuSub>
			<MenuSubTrigger value={labels[value]} valueAccent={value !== defaultValue}>
				{label}
			</MenuSubTrigger>
			<MenuSubContent>
				<MenuRadioGroup
					value={value}
					onValueChange={(next: unknown) => {
						const selected = options.find((option) => option === next);
						if (selected !== undefined) onSelect(selected);
					}}
				>
					{options.map((option) => (
						<MenuRadioItem key={option} value={option}>
							{labels[option]}
						</MenuRadioItem>
					))}
				</MenuRadioGroup>
			</MenuSubContent>
		</MenuSub>
	);
}

/** Upstream's Group by order; Folder stands in for its cloud-only Environment. */
const GROUP_BY_ORDER = [
	"none",
	"state",
	"date",
	"project",
	"custom",
] as const satisfies readonly SessionListPrefs["groupBy"][];
/** Upstream's Last updated and Date created, then the local Name sort. */
const SORT_BY_ORDER = ["activity", "created", "name"] as const satisfies readonly SessionListPrefs["sortBy"][];

/** A radio group inside a submenu, with an optional heading (Show's local-only list filters carry one). */
function ChoiceGroup<Value extends string>({
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
}) {
	return (
		<MenuRadioGroup
			value={value}
			onValueChange={(next: unknown) => {
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
 * claude.ai/code's session-list "Group and sort" menu: Group by, Sort by and Show submenus, New
 * section, Reset to defaults and View all. Folder stands in for the cloud-only Environment; the
 * local Status and Last activity filters and the PR status toggle sit under Show, the PR toggle
 * only once some row has PR data. Upstream's Show ▸ Metadata has no local data.
 */
function SessionFilterMenu({
	prefs,
	onChange,
	hasPrData,
}: {
	prefs: SessionListPrefs;
	onChange: (next: SessionListPrefs) => void;
	hasPrData: boolean;
}) {
	const navigate = useNavigate();
	const [newSectionOpen, setNewSectionOpen] = useState(false);
	return (
		<>
			<Menu>
				<Tooltip content="Group and sort" className="-my-1 shrink-0">
					<MenuTrigger
						aria-label="Group and sort"
						data-row-action=""
						onKeyDown={keepArrowsRoving}
						className="relative flex size-6 shrink-0 items-center justify-center rounded-r5 text-[color:var(--sb-heading-ink,var(--color-secondary))] hover:text-primary data-[popup-open]:text-primary aria-expanded:text-primary hover:bg-[var(--sb-hover)] hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus data-[popup-open]:bg-[var(--sb-hover)]"
					>
						<SlidersVertical aria-hidden="true" className="size-4" />
					</MenuTrigger>
				</Tooltip>
				<MenuContent align="end" density="comfortable" className="!min-w-[200px]">
					<RadioSubmenu
						label="Group by"
						value={prefs.groupBy}
						defaultValue={DEFAULT_SESSION_LIST_PREFS.groupBy}
						options={GROUP_BY_ORDER}
						labels={sessionGroupByLabels}
						onSelect={(next) => {
							onChange({...prefs, groupBy: next});
						}}
					/>
					<MenuSub>
						<MenuSubTrigger
							value={sessionSortByLabels[prefs.sortBy]}
							valueAccent={
								prefs.sortBy !== DEFAULT_SESSION_LIST_PREFS.sortBy ||
								prefs.sortDirection !== DEFAULT_SESSION_LIST_PREFS.sortDirection
							}
						>
							Sort by
						</MenuSubTrigger>
						<MenuSubContent>
							<ChoiceGroup
								value={prefs.sortBy}
								options={SORT_BY_ORDER}
								labels={sessionSortByLabels}
								onSelect={(next) => {
									onChange({...prefs, sortBy: next});
								}}
							/>
							<MenuSeparator />
							<ChoiceGroup
								value={prefs.sortDirection}
								options={SessionSortDirectionSchema.options}
								labels={sessionSortDirectionLabels}
								onSelect={(next) => {
									onChange({...prefs, sortDirection: next});
								}}
							/>
						</MenuSubContent>
					</MenuSub>
					<MenuSub>
						<MenuSubTrigger>Show</MenuSubTrigger>
						<MenuSubContent>
							<MenuCheckboxItem
								checked={prefs.showEmptyGroups}
								onCheckedChange={(checked) => {
									onChange({...prefs, showEmptyGroups: checked});
								}}
							>
								Empty groups
							</MenuCheckboxItem>
							{hasPrData && (
								<MenuCheckboxItem
									checked={prefs.showPrStatus}
									onCheckedChange={(checked) => {
										onChange({...prefs, showPrStatus: checked});
									}}
								>
									PR status
								</MenuCheckboxItem>
							)}
							<MenuSeparator />
							<ChoiceGroup
								label="Status"
								value={prefs.statusFilter}
								options={SessionStatusFilterSchema.options}
								labels={sessionStatusFilterLabels}
								onSelect={(next) => {
									onChange({...prefs, statusFilter: next});
								}}
							/>
							<MenuSeparator />
							<ChoiceGroup
								label="Last activity"
								value={prefs.activityDays}
								options={SessionActivityDaysSchema.options}
								labels={sessionActivityDaysLabels}
								onSelect={(next) => {
									onChange({...prefs, activityDays: next});
								}}
							/>
						</MenuSubContent>
					</MenuSub>
					<MenuSeparator />
					<MenuItem
						onSelect={() => {
							setNewSectionOpen(true);
						}}
					>
						New section
					</MenuItem>
					<MenuSeparator />
					<MenuItem
						onSelect={() => {
							onChange(DEFAULT_SESSION_LIST_PREFS);
						}}
					>
						Reset to defaults
					</MenuItem>
					<MenuItem onSelect={() => void navigate({to: "/sessions"})}>View all</MenuItem>
				</MenuContent>
			</Menu>
			<NewGroupDialog
				open={newSectionOpen}
				onOpenChange={setNewSectionOpen}
				switchesGroupBy={prefs.groupBy !== "custom"}
				onCreate={(name) => {
					createGroup(name);
					if (prefs.groupBy !== "custom") onChange({...prefs, groupBy: "custom"});
				}}
			/>
		</>
	);
}

/** The sidebar session list wired to the persisted Filter & group prefs. */
export function SidebarSessionGroups({activeItemId}: {activeItemId: string | null}) {
	const {settings, setSetting} = useSettings();
	const prefs = settings.sessionListPrefs;
	// Shares the list's query cache, so this adds no request.
	const {data} = useInfiniteQuery(recentSessionsInfiniteQueryOptions(undefined, prefs.statusFilter));
	const hasPrData =
		data?.pages.some((page) => page.sessions.some((session) => session.prStatus !== undefined)) ?? false;
	return (
		<SessionGroups
			activeItemId={activeItemId}
			prefs={prefs}
			filterSlot={
				<SessionFilterMenu
					prefs={prefs}
					onChange={(next) => {
						setSetting("sessionListPrefs", next);
					}}
					hasPrData={hasPrData}
				/>
			}
		/>
	);
}
