import {useInfiniteQuery} from "@tanstack/react-query";
import {SlidersVertical} from "lucide-react";

import {recentSessionsInfiniteQueryOptions} from "../../lib/api/sessions";
import {
	sessionActivityDaysLabels,
	sessionGroupByLabels,
	sessionSortByLabels,
	sessionStatusFilterLabels,
} from "../../lib/schema-choices";
import {
	clearSessionFilters,
	DEFAULT_SESSION_LIST_PREFS,
	filterLabel,
	SessionActivityDaysSchema,
	SessionGroupBySchema,
	SessionSortBySchema,
	SessionStatusFilterSchema,
	type SessionListPrefs,
} from "../../lib/session-groups";
import {useSettings} from "../settings-context";
import {
	Menu,
	MenuCheckboxItem,
	MenuContent,
	MenuItem,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "../ui/menu";
import {Tooltip} from "../ui/tooltip";
import {SessionGroups} from "./session-groups";

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

/**
 * claude.ai/code's Filter & group menu, minus Environment (cloud-only). Show PR
 * status stays hidden until some row has PR data.
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
	return (
		<Menu>
			<Tooltip content={filterLabel(prefs)} className="-my-1 shrink-0">
				<MenuTrigger
					aria-label={filterLabel(prefs)}
					data-row-action=""
					className="relative flex size-6 shrink-0 items-center justify-center rounded-r5 text-secondary hover:bg-[var(--sb-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100 data-[popup-open]:bg-[var(--sb-hover)]"
				>
					<SlidersVertical aria-hidden="true" className="size-4" />
				</MenuTrigger>
			</Tooltip>
			<MenuContent align="end" className="!min-w-[200px]">
				<RadioSubmenu
					label="Status"
					value={prefs.statusFilter}
					defaultValue={DEFAULT_SESSION_LIST_PREFS.statusFilter}
					options={SessionStatusFilterSchema.options}
					labels={sessionStatusFilterLabels}
					onSelect={(next) => {
						onChange({...prefs, statusFilter: next});
					}}
				/>
				<RadioSubmenu
					label="Last activity"
					value={prefs.activityDays}
					defaultValue={DEFAULT_SESSION_LIST_PREFS.activityDays}
					options={SessionActivityDaysSchema.options}
					labels={sessionActivityDaysLabels}
					onSelect={(next) => {
						onChange({...prefs, activityDays: next});
					}}
				/>
				<MenuSeparator />
				<RadioSubmenu
					label="Group by"
					value={prefs.groupBy}
					defaultValue={DEFAULT_SESSION_LIST_PREFS.groupBy}
					options={SessionGroupBySchema.options}
					labels={sessionGroupByLabels}
					onSelect={(next) => {
						onChange({...prefs, groupBy: next});
					}}
				/>
				<RadioSubmenu
					label="Sort by"
					value={prefs.sortBy}
					defaultValue={DEFAULT_SESSION_LIST_PREFS.sortBy}
					options={SessionSortBySchema.options}
					labels={sessionSortByLabels}
					onSelect={(next) => {
						onChange({...prefs, sortBy: next});
					}}
				/>
				{(hasPrData || prefs.groupBy === "project" || prefs.groupBy === "custom") && <MenuSeparator />}
				{(prefs.groupBy === "project" || prefs.groupBy === "custom") && (
					<MenuCheckboxItem
						checked={prefs.showEmptyGroups}
						onCheckedChange={(checked) => {
							onChange({...prefs, showEmptyGroups: checked});
						}}
					>
						Show empty groups
					</MenuCheckboxItem>
				)}
				{hasPrData && (
					<MenuCheckboxItem
						checked={prefs.showPrStatus}
						onCheckedChange={(checked) => {
							onChange({...prefs, showPrStatus: checked});
						}}
					>
						Show PR status
					</MenuCheckboxItem>
				)}
				<MenuSeparator />
				<MenuItem
					onSelect={() => {
						onChange(clearSessionFilters(prefs));
					}}
				>
					Clear filters
				</MenuItem>
			</MenuContent>
		</Menu>
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
