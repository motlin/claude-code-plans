import {useInfiniteQuery} from "@tanstack/react-query";
import {SlidersHorizontal} from "lucide-react";
import type {z} from "zod";

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
import {useSettings} from "../settings-provider";
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

type RadioPref = "statusFilter" | "activityDays" | "groupBy" | "sortBy";

function RadioSubmenu<Schema extends z.ZodEnum>({
	label,
	pref,
	schema,
	labels,
	prefs,
	onChange,
}: {
	label: string;
	pref: RadioPref;
	schema: Schema;
	labels: Record<z.infer<Schema>, string>;
	prefs: SessionListPrefs;
	onChange: (next: SessionListPrefs) => void;
}) {
	const value = prefs[pref] as z.infer<Schema>;
	return (
		<MenuSub>
			<MenuSubTrigger value={labels[value]} valueAccent={value !== DEFAULT_SESSION_LIST_PREFS[pref]}>
				{label}
			</MenuSubTrigger>
			<MenuSubContent>
				<MenuRadioGroup
					value={value}
					onValueChange={(next: unknown) => {
						const parsed = schema.safeParse(next);
						if (parsed.success) onChange({...prefs, [pref]: parsed.data});
					}}
				>
					{schema.options.map((option) => (
						<MenuRadioItem key={String(option)} value={option}>
							{labels[option as z.infer<Schema>]}
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
					<SlidersHorizontal aria-hidden="true" className="size-4" />
				</MenuTrigger>
			</Tooltip>
			<MenuContent align="end" className="!min-w-[200px]">
				<RadioSubmenu
					label="Status"
					pref="statusFilter"
					schema={SessionStatusFilterSchema}
					labels={sessionStatusFilterLabels}
					prefs={prefs}
					onChange={onChange}
				/>
				<RadioSubmenu
					label="Last activity"
					pref="activityDays"
					schema={SessionActivityDaysSchema}
					labels={sessionActivityDaysLabels}
					prefs={prefs}
					onChange={onChange}
				/>
				<MenuSeparator />
				<RadioSubmenu
					label="Group by"
					pref="groupBy"
					schema={SessionGroupBySchema}
					labels={sessionGroupByLabels}
					prefs={prefs}
					onChange={onChange}
				/>
				<RadioSubmenu
					label="Sort by"
					pref="sortBy"
					schema={SessionSortBySchema}
					labels={sessionSortByLabels}
					prefs={prefs}
					onChange={onChange}
				/>
				{(hasPrData || prefs.groupBy === "project" || prefs.groupBy === "custom") && <MenuSeparator />}
				{(prefs.groupBy === "project" || prefs.groupBy === "custom") && (
					<MenuCheckboxItem
						checked={prefs.showEmptyGroups}
						onCheckedChange={(checked) => onChange({...prefs, showEmptyGroups: checked})}
					>
						Show empty groups
					</MenuCheckboxItem>
				)}
				{hasPrData && (
					<MenuCheckboxItem
						checked={prefs.showPrStatus}
						onCheckedChange={(checked) => onChange({...prefs, showPrStatus: checked})}
					>
						Show PR status
					</MenuCheckboxItem>
				)}
				<MenuSeparator />
				<MenuItem onSelect={() => onChange(clearSessionFilters(prefs))}>Clear filters</MenuItem>
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
					onChange={(next) => setSetting("sessionListPrefs", next)}
					hasPrData={hasPrData}
				/>
			}
		/>
	);
}
