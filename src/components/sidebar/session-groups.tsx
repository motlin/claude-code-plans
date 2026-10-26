import {keepPreviousData, useInfiniteQuery} from "@tanstack/react-query";
import {useEffect, useMemo, useReducer, useRef, useState, type ReactNode} from "react";

import {Ungroup} from "lucide-react";

import {type SidebarDrop, useSidebarDrag} from "../../hooks/use-sidebar-drag";
import {recentSessionsInfiniteQueryOptions, type SessionListItem} from "../../lib/api/sessions";
import {closeDragPinHint} from "../../lib/drag-pin-hint";
import {readPinState, unpin, usePins, writePinState} from "../../lib/pin-store";
import {dropOutcome, placePin, splitPinned, type SplitPinned} from "../../lib/pinned-sessions";
import {
	groupDropOutcome,
	groupHeaderZoneId,
	groupListId,
	type GroupDropGeometry,
	multiGroupDropOutcome,
	sectionDragId,
	sectionDropOutcome,
	sectionOfDragId,
	UNGROUP_ZONE,
	UNGROUPED_SECTION_ZONE,
} from "../../lib/group-drop";
import {
	buildGroups,
	customGroupIdOfKey,
	DEFAULT_SESSION_LIST_PREFS,
	EMPTY_LIST_GROUP_LABELS,
	GROUP_PAGE_SIZE,
	PINNED_GROUP_KEY,
	type RevealedPages,
	type SessionGroup,
	sessionRowComparator,
	type SessionListPrefs,
	shouldLoadNextPage,
} from "../../lib/session-groups";
import {assign, moveGroup, readSessionGroupState, setGroupOrder, useSessionGroups} from "../../lib/session-group-store";
import {slotToIndex} from "../../lib/sidebar-drag";
import {
	EMPTY_SELECTION,
	selectionClickKind,
	sidebarSelectionReducer,
	visibleSelection,
} from "../../lib/sidebar-selection";
import {familyKey, useSidebarState} from "../../lib/sidebar-store";
import {assertNever} from "../../lib/assert-never";
import {useSettings} from "../settings-context";
import {useToast} from "../toast-context";
import {LoadingBars} from "./primitives/LoadingBars";
import {EmptyGroupSection, type EmptyListReason, GroupSection, ROW_CLASS} from "./session-group-section";
import {type SidebarSessionRow, toGroupRow} from "./sidebar-session-row";
import {SidebarSelectionContext, type SidebarSelectionApi} from "./selection-context";
import {PinnedSubList} from "./sublists";

/**
 * The sidebar session list, grouped like claude.ai/code's recents: Needs input,
 * Ready for review, Working and Completed by default. Collapsed groups persist in
 * the sidebar store; "Show more" reveals a group's next 5 rows and "Show less" folds it back to 5.
 * Once no group hides rows, expanding the last one or scrolling to the list end fetches
 * the next feed page while it can still hold sessions inside Last activity. Pinned
 * sessions move out of their group into the Pinned section above. Dragging any row
 * pins it at a Pinned slot, reorders a pinned row, or (dropped below Pinned) unpins it.
 * In Custom groups mode a row dropped on a group header or row slot joins that group
 * there, a grouped row dropped on "Ungroup" leaves it, and headers drag to reorder.
 * ⌘-click and ⇧-click select several rows for the bulk row menu; dragging a
 * selected row moves the whole selection, which can only drop on a custom group.
 */
export function SessionGroups({
	activeItemId,
	filterSlot,
	prefs = DEFAULT_SESSION_LIST_PREFS,
}: {
	activeItemId: string | null;
	/** Rendered at the end of the first group header, or of the empty-list header when no group renders. */
	filterSlot?: ReactNode;
	prefs?: SessionListPrefs;
}) {
	const {data, hasNextPage, isFetchingNextPage, fetchNextPage, isError, refetch} = useInfiniteQuery({
		...recentSessionsInfiniteQueryOptions(undefined, prefs.statusFilter),
		// Keep the current rows (and the filter button) up while a new Status loads.
		placeholderData: keepPreviousData,
	});
	const {collapsedGroups, collapsedFamilies} = useSidebarState();
	const [selection, dispatchSelection] = useReducer(sidebarSelectionReducer, EMPTY_SELECTION);
	const hasSelection = selection.ids.length > 0;
	useEffect(() => {
		if (!hasSelection) return undefined;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") dispatchSelection({type: "clear"});
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [hasSelection]);
	const latestSelected = useRef<readonly string[]>([]);
	const [revealed, setRevealed] = useState<RevealedPages>({});
	const [loadingKey, setLoadingKey] = useState<string | null>(null);

	const {pinnedIds, pinnedOrder} = usePins();

	const split = useMemo(() => {
		if (data === undefined) return undefined;
		const rows = data.pages.flatMap((page) => page.sessions.map(toGroupRow));
		return splitPinned(rows, {pinnedIds, pinnedOrder}, sessionRowComparator(prefs.sortBy, prefs.sortDirection));
	}, [data, prefs.sortBy, prefs.sortDirection, pinnedIds, pinnedOrder]);

	const toast = useToast();
	const {settings, setSetting} = useSettings();
	// The first successful drag pin retires the one-time "drag to pin" tip.
	const markDragPinHintSeen = () => {
		closeDragPinHint();
		if (!settings.seenDragPinHint) setSetting("seenDragPinHint", true);
	};
	const latestSplit = useRef<SplitPinned<SidebarSessionRow> | undefined>(undefined);
	latestSplit.current = split;
	const latestGroups = useRef<SessionGroup<SidebarSessionRow>[] | undefined>(undefined);
	const custom = prefs.groupBy === "custom";
	const recentsRef = useRef<HTMLDivElement>(null);
	const {drag, rowProps, listRef, zoneRef} = useSidebarDrag({
		onDrop: (drop) => {
			const sectionGroupId = sectionOfDragId(drop.srcId);
			if (sectionGroupId !== null) {
				applySectionDrop(sectionGroupId, drop);
				return;
			}
			const selected = latestSelected.current;
			if (selected.length > 1 && selected.includes(drop.srcId)) {
				const applied =
					custom && applyMultiGroupDrop(selected, drop, latestGroups.current ?? [], latestSplit.current);
				if (applied) dispatchSelection({type: "clear"});
				return;
			}
			if (custom && applyGroupDrop(drop, latestGroups.current ?? [], latestSplit.current)) return;
			applyPinDrop(drop, () => latestSplit.current, toast, markDragPinHintSeen);
		},
		getScrollContainer: () => recentsRef.current?.closest("[data-testid=nav-scroll]") ?? null,
	});

	const {groups: customGroups, assignments, order} = useSessionGroups();
	const groups = useMemo(
		() =>
			split === undefined
				? undefined
				: buildGroups(split.rest, prefs, Date.now(), revealed, {
						groups: customGroups,
						assignments,
						order,
					}),
		[split, prefs, revealed, customGroups, assignments, order],
	);
	latestGroups.current = groups;

	const loadedRows = useMemo(() => (split === undefined ? [] : [...split.pinned, ...split.rest]), [split]);
	const canLoadNextPage = (visibleGroups: readonly SessionGroup<SidebarSessionRow>[]) =>
		hasNextPage && !isFetchingNextPage && shouldLoadNextPage(visibleGroups, loadedRows, prefs, Date.now());
	const loadOnScroll = groups !== undefined && canLoadNextPage(groups);
	const listEndRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const end = listEndRef.current;
		if (!loadOnScroll || end === null || typeof IntersectionObserver === "undefined") return undefined;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
			},
			{root: end.closest("[data-testid=nav-scroll]"), rootMargin: "200px"},
		);
		observer.observe(end);
		return () => {
			observer.disconnect();
		};
	}, [loadOnScroll, fetchNextPage]);

	if (split === undefined || groups === undefined) {
		if (isError) {
			return (
				<EmptyGroupSection
					label={EMPTY_LIST_GROUP_LABELS[prefs.groupBy]}
					filterSlot={filterSlot}
					reason={{kind: "failed", onRetry: () => void refetch()}}
				/>
			);
		}
		return (
			<div className="px-2">
				<LoadingBars />
			</div>
		);
	}

	const collapsed = new Set(collapsedGroups);
	const familyHeadIds = groups.flatMap((group) => [...group.nested.keys()]);
	const displayOrder = displayedRowIds(split, groups, collapsed, new Set(collapsedFamilies));
	const selectedIds = visibleSelection(selection, displayOrder);
	latestSelected.current = selectedIds;
	const selectionApi: SidebarSelectionApi = {
		selectedIds,
		sessions: new Map(
			[...split.pinned, ...split.rest].map((row): [string, SessionListItem] => [row.id, row.session]),
		),
		onRowClick: (id, modifiers) => {
			const kind = selectionClickKind(modifiers);
			if (kind === "plain") {
				dispatchSelection({type: "clear"});
				return false;
			}
			dispatchSelection(
				kind === "toggle"
					? {type: "toggle", id, order: displayOrder}
					: {type: "extend", id, order: displayOrder, focusedId: activeItemId},
			);
			return true;
		},
		selectAll: (ids) => {
			dispatchSelection({type: "add", ids, order: displayOrder});
		},
		clear: () => {
			dispatchSelection({type: "clear"});
		},
	};
	const sectionDrag = drag !== null && sectionOfDragId(drag.srcId) !== null;
	const rowDrag = drag !== null && !sectionDrag;
	const multiDrag = rowDrag && selectedIds.length > 1 && selectedIds.includes(drag.srcId);
	const draggedIds = rowDrag ? (multiDrag ? selectedIds : [drag.srcId]) : [];
	const showUngroupRow = custom && draggedIds.some((id) => assignments[id] !== undefined);
	const target = drag?.target ?? null;
	const hotGroupId = groups
		.map((group) => customGroupIdOfKey(group.key))
		.find(
			(id) =>
				id !== null &&
				target !== null &&
				(target.type === "zone" ? target.zoneId === groupHeaderZoneId(id) : target.listId === groupListId(id)),
		);
	const firstUngroupedIndex = groups.findIndex((group) => customGroupIdOfKey(group.key) === null);

	const ungroupRow = showUngroupRow ? (
		<UngroupDropRow
			key={UNGROUP_ZONE}
			ref={zoneRef(UNGROUP_ZONE)}
			hot={target?.type === "zone" && target.zoneId === UNGROUP_ZONE}
		/>
	) : null;

	const emptyListReason: EmptyListReason =
		(data?.pages.every((page) => page.sessions.length === 0) ?? false) &&
		prefs.statusFilter === DEFAULT_SESSION_LIST_PREFS.statusFilter &&
		prefs.activityDays === DEFAULT_SESSION_LIST_PREFS.activityDays
			? {kind: "none"}
			: {
					kind: "filtered",
					onShowAll: () => {
						setSetting("sessionListPrefs", {...prefs, statusFilter: "all", activityDays: "all"});
					},
				};
	return (
		// oxlint-disable-next-line react/jsx-no-constructed-context-values -- built after the loading early return, where hooks cannot run, from selection state that changes whenever the rows re-render anyway
		<SidebarSelectionContext.Provider value={selectionApi}>
			<div data-sidebar-selecting={selectedIds.length > 0 ? "" : undefined} className="contents">
				<PinnedSubList
					rows={split.pinned}
					expanded={!collapsed.has(PINNED_GROUP_KEY)}
					activeItemId={activeItemId}
					dragging={rowDrag && !multiDrag}
					dropRowHot={drag?.target?.type === "zone" && drag.target.zoneId === PIN_DROP_ZONE}
					// A multi-row drag cannot pin, so Pinned is no drop target while one is under way.
					{...(multiDrag ? {} : {listRef: listRef(PINNED_LIST), dropRowRef: zoneRef(PIN_DROP_ZONE)})}
					dragRowProps={rowProps}
				/>
				<div
					ref={(element) => {
						recentsRef.current = element;
						zoneRef(UNPIN_ZONE)(element);
					}}
					data-testid="sidebar-recents"
					data-tab-section=""
					data-perf-region="sidebar_recents"
					className="flex min-h-[120px] shrink-0 grow flex-col"
				>
					{groups.map((group, index) => {
						const groupId = custom ? customGroupIdOfKey(group.key) : null;
						const ungroupedSection = custom && groupId === null;
						const section = (
							<GroupSection
								key={group.key}
								group={group}
								groupBy={prefs.groupBy}
								expanded={!collapsed.has(group.key)}
								activeItemId={activeItemId}
								filterSlot={filterSlot}
								leadsList={index === 0}
								onShowMore={() => {
									setRevealed((previous) => ({
										...previous,
										[group.key]: (previous[group.key] ?? 0) + 1,
									}));
									if (
										group.hiddenCount <= GROUP_PAGE_SIZE &&
										canLoadNextPage(groups.filter((other) => other.key !== group.key))
									) {
										setLoadingKey(group.key);
										void fetchNextPage();
									}
								}}
								onShowLess={() => {
									setRevealed((previous) => ({...previous, [group.key]: 0}));
								}}
								loadingMore={isFetchingNextPage && loadingKey === group.key}
								dragRowProps={rowProps}
								familyHeadIds={familyHeadIds}
								{...(groupId === null
									? {}
									: {
											headerDragProps: rowProps(sectionDragId(groupId)),
											headerRef: zoneRef(groupHeaderZoneId(groupId)),
											dropHot: hotGroupId === groupId,
											...(sectionDrag ? {} : {rowsRef: listRef(groupListId(groupId))}),
										})}
								{...(ungroupedSection ? {sectionRef: zoneRef(UNGROUPED_SECTION_ZONE)} : {})}
							/>
						);
						return index === firstUngroupedIndex && ungroupRow !== null ? [ungroupRow, section] : section;
					})}
					{groups.length === 0 && (
						<EmptyGroupSection
							label={EMPTY_LIST_GROUP_LABELS[prefs.groupBy]}
							filterSlot={filterSlot}
							reason={emptyListReason}
						/>
					)}
					{firstUngroupedIndex === -1 && ungroupRow}
					<div ref={listEndRef} aria-hidden="true" data-sidebar-list-end />
				</div>
			</div>
		</SidebarSelectionContext.Provider>
	);
}

const PINNED_LIST = "pinned";
const PIN_DROP_ZONE = "pin-drop";
/** The recents list below Pinned: dropping a pinned row here unpins it. */
const UNPIN_ZONE = "unpin";

/**
 * Every session row the sidebar shows, in display order: Pinned, then each expanded
 * section's rows with their expanded families. ⇧-click ranges run over this.
 */
function displayedRowIds(
	split: SplitPinned<SidebarSessionRow>,
	groups: readonly SessionGroup<SidebarSessionRow>[],
	collapsed: ReadonlySet<string>,
	collapsedFamilies: ReadonlySet<string>,
): string[] {
	const pinned = collapsed.has(PINNED_GROUP_KEY) ? [] : split.pinned.map((row) => row.id);
	const sections = groups
		.filter((group) => !collapsed.has(group.key))
		.flatMap((group) =>
			group.rows.flatMap((row) => [
				row.sessionId,
				...(collapsedFamilies.has(familyKey(row.sessionId))
					? []
					: (group.nested.get(row.sessionId) ?? []).map((child) => child.sessionId)),
			]),
		);
	return [...pinned, ...sections];
}

/** Move a dragged custom group header to the section it was dropped on. */
function applySectionDrop(groupId: string, {target}: SidebarDrop): void {
	const outcome = sectionDropOutcome({
		groupId,
		target,
		groupIds: readSessionGroupState().groups.map((group) => group.id),
	});
	if (outcome !== null) moveGroup(outcome.groupId, outcome.toIndex);
}

/** Each custom group's displayed rows in DOM order, families included. */
function groupLists(
	groups: readonly SessionGroup<SidebarSessionRow>[],
): Record<string, GroupDropGeometry["lists"][string]> {
	const lists: Record<string, GroupDropGeometry["lists"][string]> = {};
	for (const group of groups) {
		const groupId = customGroupIdOfKey(group.key);
		if (groupId === null) continue;
		lists[groupId] = group.rows.flatMap((row) => [
			{id: row.sessionId, nested: false},
			...(group.nested.get(row.sessionId) ?? []).map((child) => ({
				id: child.sessionId,
				nested: true,
			})),
		]);
	}
	return lists;
}

/**
 * Apply a released multi-row drag: every selected row joins the group it was dropped
 * on (in display order, at the slot) or leaves its group on Ungroup. Pinned rows
 * among them are unpinned so they show where they were dropped. False when nothing moved.
 */
function applyMultiGroupDrop(
	srcIds: readonly string[],
	{target}: SidebarDrop,
	groups: readonly SessionGroup<SidebarSessionRow>[],
	split: SplitPinned<SidebarSessionRow> | undefined,
): boolean {
	const lists = groupLists(groups);
	const {assignments} = readSessionGroupState();
	const outcome = multiGroupDropOutcome({
		srcIds,
		srcGroupIds: srcIds.map((id) => assignments[id] ?? null),
		target,
		lists,
	});
	if (outcome === null) return false;
	const pinned = new Set(split?.pinned.map((row) => row.id));
	for (const id of srcIds) if (pinned.has(id)) unpin(id);
	switch (outcome.type) {
		case "ungroup":
			for (const id of srcIds) assign(id, null);
			return true;
		case "group": {
			const selected = new Set(srcIds);
			setGroupOrder(
				outcome.groupId,
				(lists[outcome.groupId] ?? [])
					.filter((row) => !row.nested && !selected.has(row.id))
					.map((row) => row.id),
			);
			for (const id of srcIds) assign(id, outcome.groupId, {before: outcome.before});
			return true;
		}
		default:
			return assertNever(outcome);
	}
}

/**
 * Apply a released row drag to the custom groups. A drop at a slot pins the group's
 * displayed order first so the row lands exactly there; a pinned row placed in a
 * group is unpinned so it shows where it was dropped. False when it is not a group drop.
 */
function applyGroupDrop(
	{srcId, target}: SidebarDrop,
	groups: readonly SessionGroup<SidebarSessionRow>[],
	split: SplitPinned<SidebarSessionRow> | undefined,
): boolean {
	const lists = groupLists(groups);
	const srcGroupId = readSessionGroupState().assignments[srcId] ?? null;
	const outcome = groupDropOutcome({srcId, srcGroupId, target, lists});
	if (outcome === null) return false;
	if (split?.pinned.some((row) => row.id === srcId) === true) unpin(srcId);
	switch (outcome.type) {
		case "ungroup":
			assign(srcId, null);
			return true;
		case "group": {
			const displayed = (lists[outcome.groupId] ?? [])
				.filter((row) => !row.nested && row.id !== srcId)
				.map((row) => row.id);
			setGroupOrder(outcome.groupId, displayed);
			assign(srcId, outcome.groupId, {before: outcome.before});
			return true;
		}
		default:
			return assertNever(outcome);
	}
}

/** Apply a released sidebar row drag to the pins, like claude.ai/code. */
function applyPinDrop(
	{srcId, target}: SidebarDrop,
	getSplit: () => SplitPinned<SidebarSessionRow> | undefined,
	toast: ReturnType<typeof useToast>,
	onPin: () => void,
): void {
	const split = getSplit();
	if (split === undefined) return;
	const displayed = split.pinned.map((row) => row.id);
	const srcIdx = displayed.indexOf(srcId);
	let slot: number | null = null;
	if (target.type === "slot" && target.listId === PINNED_LIST) slot = target.slot;
	if (target.type === "zone" && target.zoneId === PIN_DROP_ZONE) slot = displayed.length;
	// Every target outside Pinned (the recents zone, a custom group section) is below it.
	const outcome = dropOutcome({
		srcPinned: srcIdx !== -1,
		slot,
		belowPinnedBottom:
			!(target.type === "slot" && target.listId === PINNED_LIST) &&
			!(target.type === "zone" && target.zoneId === PIN_DROP_ZONE),
	});
	switch (outcome) {
		case "pin":
		case "reorder": {
			if (slot === null) return;
			const index = slotToIndex(slot, srcIdx === -1 ? null : srcIdx);
			writePinState(placePin(readPinState(), displayed, srcId, index));
			if (outcome === "pin") onPin();
			return;
		}
		case "unpin": {
			const title = split.pinned[srcIdx]?.title ?? srcId;
			unpin(srcId);
			toast({
				kind: "success",
				message: `Unpinned ${title}`,
				action: {
					label: "Undo",
					onAction: () => {
						const pins = readPinState();
						const now = getSplit();
						if (pins.pinnedIds.includes(srcId) || now === undefined) return;
						if (!now.rest.some((row) => row.id === srcId)) return;
						const pinnedNow = now.pinned.map((row) => row.id);
						writePinState(placePin(pins, pinnedNow, srcId, srcIdx));
					},
				},
			});
			return;
		}
		case "cancel":
			return;
		default:
			assertNever(outcome);
	}
}

/** The drop row shown between the custom groups and Ungrouped while a grouped row is dragged. */
function UngroupDropRow({ref, hot}: {ref: (element: HTMLElement | null) => void; hot: boolean}) {
	return (
		<div
			ref={ref}
			data-ungroup-drop-row
			data-hot={hot ? "" : undefined}
			className={`${ROW_CLASS} mt-[var(--sb-group-band-mt)] ${hot ? "bg-[var(--sb-hover)] text-secondary" : "text-ink-muted opacity-80"}`}
		>
			<span className="df-leading-slot">
				<Ungroup aria-hidden="true" />
			</span>
			Ungroup
		</div>
	);
}
