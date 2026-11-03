import {useInfiniteQuery} from "@tanstack/react-query";
import {useState} from "react";

import {recentSessionsInfiniteQueryOptions} from "../../lib/api/sessions";
import {sessionActivityDaysLabels, sessionGroupByLabels, sessionStatusFilterLabels} from "../../lib/schema-choices";
import {
	DEFAULT_SESSION_LIST_PREFS,
	SessionActivityDaysSchema,
	SessionStatusFilterSchema,
	type SessionListPrefs,
} from "../../lib/session-groups";
import {useSettings} from "../settings-context";
import {Menu, MenuCheckboxItem, MenuContent, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger} from "../ui/menu";
import {
	ChoiceGroup,
	GroupBySubmenu,
	GroupSortFooter,
	GroupSortTrigger,
	NewSectionDialog,
	SortBySubmenu,
} from "./section-view-menu";
import {SessionGroups} from "./session-groups";

/**
 * Upstream `Y8` for the Sessions section: Date, Status, Folder, then None after a separator. Folder
 * is local "project"; the cloud-only Environment is left out, and Custom is gone because custom
 * groups are their own sections now.
 */
const GROUP_BY_ORDER = ["date", "state", "project"] as const satisfies readonly SessionListPrefs["groupBy"][];

/**
 * claude.ai/code's session-list "Group and sort" menu: Group by, Sort by and Show submenus, New
 * section, Reset to defaults and View all. Folder stands in for the cloud-only Environment. Show
 * leads with upstream's Metadata toggle (branch from the JSONL gitBranch, folder from the project
 * name, blocked reason from the pending approval); the local Status and Last activity filters and
 * the PR status toggle follow, the PR toggle only once some row has PR data.
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
	const [newSectionOpen, setNewSectionOpen] = useState(false);
	// Upstream `tz` atDefaults: only the grouping and sort count; the local Show filters keep their own values.
	const atDefaults =
		prefs.groupBy === DEFAULT_SESSION_LIST_PREFS.groupBy &&
		prefs.sortBy === DEFAULT_SESSION_LIST_PREFS.sortBy &&
		prefs.sortDirection === DEFAULT_SESSION_LIST_PREFS.sortDirection;
	return (
		<>
			<Menu>
				<GroupSortTrigger />
				<MenuContent align="end" density="comfortable" className="!min-w-[200px]">
					<GroupBySubmenu
						value={prefs.groupBy}
						accent={prefs.groupBy !== DEFAULT_SESSION_LIST_PREFS.groupBy}
						options={GROUP_BY_ORDER}
						none="none"
						labels={sessionGroupByLabels}
						onSelect={(next) => {
							onChange({...prefs, groupBy: next});
						}}
					/>
					<SortBySubmenu
						sortBy={prefs.sortBy}
						sortDirection={prefs.sortDirection}
						onSortBy={(next) => {
							onChange({...prefs, sortBy: next});
						}}
						onSortDirection={(next) => {
							onChange({...prefs, sortDirection: next});
						}}
					/>
					<MenuSub>
						<MenuSubTrigger>Show</MenuSubTrigger>
						<MenuSubContent>
							<MenuCheckboxItem
								checked={prefs.showMetadata}
								onCheckedChange={(checked) => {
									onChange({...prefs, showMetadata: checked});
								}}
							>
								Metadata
							</MenuCheckboxItem>
							<MenuSeparator />
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
					<GroupSortFooter
						atDefaults={atDefaults}
						onReset={() => {
							onChange({
								...prefs,
								groupBy: DEFAULT_SESSION_LIST_PREFS.groupBy,
								sortBy: DEFAULT_SESSION_LIST_PREFS.sortBy,
								sortDirection: DEFAULT_SESSION_LIST_PREFS.sortDirection,
							});
						}}
						onNewSection={() => {
							setNewSectionOpen(true);
						}}
						statusFilter={prefs.statusFilter}
					/>
				</MenuContent>
			</Menu>
			<NewSectionDialog open={newSectionOpen} onOpenChange={setNewSectionOpen} />
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
