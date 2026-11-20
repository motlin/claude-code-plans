import {keepPreviousData, useInfiniteQuery} from "@tanstack/react-query";
import {useCallback, useEffect, useMemo, useReducer, useRef, useState, type MouseEvent, type ReactNode} from "react";

import {Ungroup} from "lucide-react";

import {type SidebarDrop, useSidebarDrag} from "../../hooks/use-sidebar-drag";
import {useAnsweredSessionIds, withAnsweredHold} from "../../lib/answered-sessions";
import {recentSessionsInfiniteQueryOptions, type SessionListItem} from "../../lib/api/sessions";
import {withAwaitingAck} from "../../lib/awaiting-ack-overlay";
import {ackedAt, useAwaitingAckVersion} from "../../lib/awaiting-ack-store";
import {withFailedError} from "../../lib/failed-error-overlay";
import {useLiveApprovalIds} from "../../lib/live-approval-sessions";
import {closeDragPinHint} from "../../lib/drag-pin-hint";
import {readPinState, unpin, usePins, writePinState} from "../../lib/pin-store";
import {mergeProjectOrder, moveProjectIndex, moveProjectKey} from "../../lib/project-order";
import {readProjectOrder, resetProjectOrder, setProjectOrder, useProjectOrder} from "../../lib/project-order-store";
import {dropOutcome, placePin, splitPinned, type SplitPinned} from "../../lib/pinned-sessions";
import
{
	groupDropOutcome,
	groupHeaderZoneId,
	groupListId,
	groupLists,
	multiGroupDropOutcome,
	UNGROUP_ZONE,
	UNGROUPED_SECTION_ZONE,
} from "../../lib/group-drop";
import
{
	buildSidebarSections,
	DEFAULT_SESSION_LIST_PREFS,
	EMPTY_LIST_GROUP_LABELS,
	nextPageCanHoldVisibleRows,
	PINNED_GROUP_KEY,
	projectOrderKey,
	type ManualSectionGroups,
	type RevealedRows,
	type SessionGroup,
	sessionRowComparator,
	type SessionListPrefs,
} from "../../lib/session-groups";
import {swallowGuardedClick} from "../../lib/sidebar-click-guard";
import {revealThrough} from "../../lib/sidebar-section-reveal";
import {assign, readSessionGroupState, setGroupOrder, useSessionGroups} from "../../lib/session-group-store";
import
{
	moveSidebarSection,
	readSidebarSections,
	type SidebarSection,
	useSidebarSections,
} from "../../lib/sidebar-sections";
import {slotToIndex} from "../../lib/sidebar-drag";
import
{
	clearsSelectionOnPress,
	EMPTY_SELECTION,
	selectionClickKind,
	sidebarSelectionReducer,
	visibleSelection,
} from "../../lib/sidebar-selection";
import {clearFamilyHeads, publishFamilyHeads} from "../../lib/sidebar-family-heads-store";
import {recordRecentsRowCount, rememberedRecentsRows, useSidebarState} from "../../lib/sidebar-store";
import {displayedNested, type FamilyFoldState, FoldOpenKeysContext, useFoldOpenKeys} from "../../lib/family-fold";
import {assertNever} from "../../lib/assert-never";
import {useSettings} from "../settings-context";
import {useToast} from "../toast-context";
import {PlaceholderRows} from "./primitives/PlaceholderRows";
import
{
	EmptyGroupSection,
	type EmptyListReason,
	GroupSection,
	LoadMoreSessionsRow,
	ROW_CLASS,
	type SectionFetchMore,
	StaticGroupLabel,
} from "./session-group-section";
import {requestRevealRow} from "./reveal-row-store";
import {useLoadMoreFocus} from "./use-load-more-focus";
import {type SidebarSessionRow, toGroupRow, toPendingLaunchRow} from "./sidebar-session-row";
import {findLaunchedRow, settlePendingLaunch, usePendingLaunches} from "../../lib/pending-launch-store";
import {SidebarSelectionContext, type SidebarSelectionApi} from "./selection-context";
import {SectionViewMenu} from "./section-view-menu";
import type {ProjectReorder} from "./project-group-header";
import {SORTABLE_FOLDER_SECTION_CLASS} from "./sortable-section-classes";
import {type SectionActivator, SortableSection, SortableSections} from "./sortable-sections";
import {PinnedSubList} from "./sublists";
import {SidebarWhitespaceMenu, type WhitespaceScopes} from "./whitespace-context-menu";

/**
 * The sidebar session list in claude.ai/code's sections layout: Pinned, then the user's manual
 * sections (custom groups, each with its own Group and sort), each in a `df-sortable-section`, then
 * Recents grouped by the list's Group by. Collapsed groups persist in the sidebar store; "Show
 * more" reveals a group's next 20 rows and "Show less" folds it back. The next feed page loads only
 * on a click, while it can still hold sessions inside Last activity: Date's last section and None's
 * Recents keep a count-0 Show more that fetches, and every other grouping ends the list with a
 * "Load more sessions" row (upstream `Ks`). Nothing auto-loads on scroll. Dragging any row pins it at a Pinned slot, reorders a
 * pinned row, or (dropped below Pinned) unpins it. A row dropped on a manual section's header or
 * row slot joins that section there, and a row dropped on "Remove from …" or on Recents leaves it. Manual
 * section headers drag their whole section to reorder (`SortableSections`). ⌘-click and ⇧-click select several rows for the bulk row menu;
 * dragging a selected row moves the whole selection, which can only drop on a manual section. A plain
 * click, Escape, or a press outside the list clears the selection.
 */
export function SessionGroups({
	activeItemId,
	filterSlot,
	prefs = DEFAULT_SESSION_LIST_PREFS,
}: {
	activeItemId: string | null;
	/** Recents' Group and sort: at the end of each of its group headers, or of the empty-list header. */
	filterSlot?: ReactNode;
	prefs?: SessionListPrefs;
})
{
	const feed = recentSessionsInfiniteQueryOptions(undefined, prefs.statusFilter);
	const {data, hasNextPage, isFetchingNextPage, fetchNextPage, isError, isPlaceholderData, refetch} =
		useInfiniteQuery(
			{
				...feed,
				// Keep the current rows (and the filter button) up while a new Status loads.
				placeholderData: keepPreviousData,
			},
		);
	const {collapsedGroups, collapsedFamilies} = useSidebarState();
	const [selection, dispatchSelection] = useReducer(sidebarSelectionReducer, EMPTY_SELECTION);
	const hasSelection = selection.ids.length > 0;
	useEffect(() =>
	{
		if (!hasSelection) return undefined;
		const onKeyDown = (event: KeyboardEvent) =>
		{
			if (event.key === "Escape")
				dispatchSelection(
					{
						type: "clear",
					},
				);
		};
		window.addEventListener("keydown", onKeyDown);
		return () =>
		{
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [hasSelection]);
	// Upstream `uq`: a capture-phase press outside the list clears the selection before the target acts.
	useEffect(() =>
	{
		if (!hasSelection) return undefined;
		const onPointerDown = (event: PointerEvent) =>
		{
			if (clearsSelectionOnPress(event))
				dispatchSelection(
					{
						type: "clear",
					},
				);
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () =>
		{
			document.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, [hasSelection]);
	const latestSelected = useRef<readonly string[]>([]);
	const whitespaceScopes = useRef<WhitespaceScopes>(
		{
			shown: [],
			all: [],
			pinnedShown: [],
			pinnedAll: [],
		},
	);
	const [revealed, setRevealed] = useState<RevealedRows>({});
	// Upstream's context epoch (`fn`): a new grouping or filter folds every section back.
	const epoch = `${prefs.groupBy}|${prefs.statusFilter}|${prefs.activityDays}`;
	const [revealedEpoch, setRevealedEpoch] = useState(epoch);
	if (revealedEpoch !== epoch)
	{
		setRevealedEpoch(epoch);
		setRevealed({});
	}
	const onReveal = useCallback((key: string, extraRevealed: number) =>
	{
		setRevealed((previous) =>
			previous[key] === extraRevealed
				? previous
				:
					{
						...previous,
						[key]: extraRevealed,
					},
		);
	}, []);
	const [landedAnnouncement, setLandedAnnouncement] = useState("");

	const {pinnedIds, pinnedOrder} = usePins();
	const foldOpenKeys = useFoldOpenKeys(collapsedFamilies, activeItemId);
	const familyFold: FamilyFoldState =
	{
		collapsedFamilies,
		pinnedIds,
		openKeys: foldOpenKeys,
	};
	const latestFamilyFold = useRef(familyFold);
	latestFamilyFold.current = familyFold;

	// A session this tab just answered draws as Working at the click, as upstream's responding row does.
	const answeredIds = useAnsweredSessionIds();
	// A row marked completed in this browser draws idle until new activity, as upstream's acked row does; a failed
	// row draws the error, read or not, until that ack (upstream `Q$`).
	const ackVersion = useAwaitingAckVersion();
	const liveApprovalIds = useLiveApprovalIds();
	const pendingLaunches = usePendingLaunches();
	// A pending launch whose session's row has arrived settles: the skeleton row gives way to the real one.
	useEffect(() =>
	{
		if (data === undefined) return;
		const sessions = data.pages.flatMap((page) => page.sessions);
		for (const launch of pendingLaunches)
		{
			const id = findLaunchedRow(sessions, launch);
			if (id !== null) settlePendingLaunch(launch.key, id);
		}
	}, [data, pendingLaunches]);
	const split = useMemo(() =>
	{
		if (data === undefined) return undefined;
		const sessions = data.pages.flatMap((page) => page.sessions);
		const launching = pendingLaunches
			.filter((launch) => findLaunchedRow(sessions, launch) === null)
			.map(toPendingLaunchRow);
		const loaded = data.pages.flatMap((page) =>
			page.sessions.map((session) =>
				toGroupRow(
					withAnsweredHold(
						withFailedError(
							withAwaitingAck(session, ackedAt(session.id), liveApprovalIds.has(session.id)),
							ackedAt(session.id),
						),
						answeredIds.has(session.id),
					),
				),
			),
		);
		const rows = [...launching, ...loaded];
		return splitPinned(
			rows,
			{
				pinnedIds,
				pinnedOrder,
			},
			sessionRowComparator(prefs.sortBy, prefs.sortDirection),
		);
		// ackVersion re-runs the memo when an ack changes; ackedAt reads the store.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		data,
		pendingLaunches,
		answeredIds,
		ackVersion,
		liveApprovalIds,
		prefs.sortBy,
		prefs.sortDirection,
		pinnedIds,
		pinnedOrder,
	]);

	const toast = useToast();
	const {settings, setSetting} = useSettings();
	// The first successful drag pin retires the one-time "drag to pin" tip.
	const markDragPinHintSeen = () =>
	{
		closeDragPinHint();
		if (!settings.seenDragPinHint) setSetting("seenDragPinHint", true);
	};
	const latestSplit = useRef<SplitPinned<SidebarSessionRow> | undefined>(undefined);
	latestSplit.current = split;
	const latestManual = useRef<ManualSectionGroups<SidebarSessionRow>[]>([]);
	const recentsRef = useRef<HTMLDivElement>(null);
	const {drag, rowProps, listRef, zoneRef} = useSidebarDrag(
		{
			onDrop: (drop) =>
			{
				const selected = latestSelected.current;
				if (selected.length > 1 && selected.includes(drop.srcId))
				{
					if (
						applyMultiGroupDrop(
							selected,
							drop,
							latestManual.current,
							latestFamilyFold.current,
							latestSplit.current,
						)
					)
					{
						dispatchSelection(
							{
								type: "clear",
							},
						);
					}
					return;
				}
				if (applyGroupDrop(drop, latestManual.current, latestFamilyFold.current, latestSplit.current)) return;
				applyPinDrop(drop, () => latestSplit.current, toast, markDragPinHintSeen);
			},
			getScrollContainer: () => recentsRef.current?.closest("[data-testid=nav-scroll]") ?? null,
		},
	);

	const {assignments, order} = useSessionGroups();
	const sections = useSidebarSections();
	const manualSections = useMemo(() => sections.filter((section) => section.kind === "manual"), [sections]);
	const projectOrder = useProjectOrder();
	const built = useMemo(
		() =>
			split === undefined
				? undefined
				: buildSidebarSections(
						split.rest,
						prefs,
						Date.now(),
						revealed,
						{
							sections: manualSections,
							assignments,
							order,
						},
						projectOrder,
					),
		[split, prefs, revealed, manualSections, assignments, order, projectOrder],
	);
	const groups = built?.sessions;
	latestManual.current = built?.manual ?? [];
	const latestBuilt = useRef(built);
	latestBuilt.current = built;

	const loadedRows = useMemo(
		() => (split === undefined ? [] : [...split.pinned, ...[...split.nested.values()].flat(), ...split.rest]),
		[split],
	);
	const loadedIds = useMemo(() => loadedRows.map((row) => row.id), [loadedRows]);
	const familyHeadIds =
		split === undefined || built === undefined ? [] : visibleFamilyHeads(split, built.manual, built.sessions);
	const familyHeadsKey = familyHeadIds.join("\n");
	const familyHeadsOwner = useRef(Symbol("session-groups"));
	useEffect(() =>
	{
		publishFamilyHeads(familyHeadsOwner.current, familyHeadsKey === "" ? [] : familyHeadsKey.split("\n"));
	}, [familyHeadsKey]);
	useEffect(() =>
	{
		const owner = familyHeadsOwner.current;
		return () =>
		{
			clearFamilyHeads(owner);
		};
	}, []);
	const canFetchMore = hasNextPage && nextPageCanHoldVisibleRows(loadedRows, prefs, Date.now());
	const collapsedSet = new Set(collapsedGroups);
	// Upstream `recordSidebarRowCount(…, "code.recents", n)`: a settled list remembers how many Recents rows it shows.
	const recentsRowCount =
		groups === undefined || isPlaceholderData
			? undefined
			: groups.reduce((count, group) => count + (collapsedSet.has(group.key) ? 0 : group.rows.length), 0);
	useEffect(() =>
	{
		if (recentsRowCount !== undefined) recordRecentsRowCount(recentsRowCount);
	}, [recentsRowCount]);
	const displayOrder =
		split === undefined || built === undefined
			? []
			: displayedRowIds(split, built.manual, built.sessions, collapsedSet, familyFold);
	const startLoad = useLoadMoreFocus(
		{
			loadedIds,
			displayedIds: displayOrder,
			isFetching: isFetchingNextPage,
			containerRef: recentsRef,
		},
	);
	const fetchFrom = (event: MouseEvent<HTMLElement>, onLanded?: (landedIds: readonly string[]) => void) =>
	{
		if (isFetchingNextPage) return;
		startLoad(event, onLanded);
		void fetchNextPage();
	};
	// Upstream `no` → `ZS`: rows a list-level load brought in reveal through the last of them in each section.
	const revealLanded = (landedIds: readonly string[]) =>
	{
		if (landedIds.length === 0) return;
		setLandedAnnouncement(
			landedIds.length === 1 ? "1 more session loaded" : `${landedIds.length} more sessions loaded`,
		);
		const latest = latestBuilt.current;
		if (latest === undefined) return;
		const landedKeys = new Set(landedIds);
		const sections = [
			...latest.manual.flatMap((section) => [section.group, ...(section.subgroups ?? [])]),
			...latest.sessions,
		];
		for (const section of sections)
		{
			const reveal = revealThrough(
				{
					keys: section.sorted.map((row) => row.sessionId),
					truncateAt: section.pageSize,
					extraRevealed: section.extraRevealed,
					hiddenCount: section.hiddenCount,
					collapsed: false,
					openKeys: new Set(),
					landedKeys,
				},
			);
			if (reveal > section.extraRevealed) onReveal(section.key, reveal);
		}
	};

	if (split === undefined || built === undefined || groups === undefined)
	{
		if (isError)
		{
			return (
				<EmptyGroupSection
					label={EMPTY_LIST_GROUP_LABELS[prefs.groupBy]}
					filterSlot={filterSlot}
					reason={
					{
						kind: "failed",
						onRetry: () => void refetch(),
					}}
				/>
			);
		}
		return (
			<RecentsPlaceholder
				groupBy={prefs.groupBy}
				filterSlot={filterSlot}
				collapsed={collapsedSet.has("recents")}
				described={settings.sessionListPrefs.showMetadata}
			/>
		);
	}

	const collapsed = collapsedSet;
	const manual = built.manual;
	const selectedIds = visibleSelection(selection, displayOrder);
	latestSelected.current = selectedIds;
	const selectionApi: SidebarSelectionApi =
	{
		selectedIds,
		sessions: new Map(
			[...split.pinned, ...[...split.nested.values()].flat(), ...split.rest].map(
				(row): [string, SessionListItem] => [row.id, row.session],
			),
		),
		onRowClick: (id, modifiers) =>
		{
			const kind = selectionClickKind(modifiers);
			if (kind === "plain")
			{
				dispatchSelection(
					{
						type: "clear",
					},
				);
				return false;
			}
			dispatchSelection(
				kind === "toggle"
					?
						{
							type: "toggle",
							id,
							order: displayOrder,
						}
					:
						{
							type: "extend",
							id,
							order: displayOrder,
							focusedId: activeItemId,
						},
			);
			return true;
		},
		selectAll: (ids) =>
		{
			dispatchSelection(
				{
					type: "add",
					ids,
					order: displayOrder,
				},
			);
		},
		selectOnly: (ids) =>
		{
			dispatchSelection(
				{
					type: "set",
					ids,
					order: displayOrder,
				},
			);
		},
		clear: () =>
		{
			dispatchSelection(
				{
					type: "clear",
				},
			);
		},
	};
	const pinnedRows = pinnedRowIds(split, familyFold);
	whitespaceScopes.current =
	{
		shown: displayOrder,
		all: displayedRowIds(split, manual, groups, new Set(), familyFold),
		pinnedShown: collapsed.has(PINNED_GROUP_KEY) ? [] : pinnedRows,
		pinnedAll: pinnedRows,
	};
	const rowDrag = drag !== null;
	const multiDrag = rowDrag && selectedIds.length > 1 && selectedIds.includes(drag.srcId);
	const draggedIds = rowDrag ? (multiDrag ? selectedIds : [drag.srcId]) : [];
	const manualIds = new Set(manual.map((section) => section.id));
	const draggedSectionIds = [
		...new Set(draggedIds.flatMap((id) => (manualIds.has(assignments[id] ?? "") ? [assignments[id] ?? ""] : []))),
	];
	const target = drag?.target ?? null;
	const hotGroupId = manual
		.map((section) => section.id)
		.find(
			(id) =>
				target !== null &&
				(target.type === "zone" ? target.zoneId === groupHeaderZoneId(id) : target.listId === groupListId(id)),
		);

	const ungroupRow =
		draggedSectionIds.length > 0 ? (
			<UngroupDropRow
				ref={zoneRef(UNGROUP_ZONE)}
				hot={target?.type === "zone" && target.zoneId === UNGROUP_ZONE}
				label={
					draggedSectionIds.length === 1
						? `Remove from ${manual.find((section) => section.id === draggedSectionIds[0])?.group.label ?? ""}`
						: "Remove from sections"
				}
			/>
		) : null;

	const sectionKeys = [...manual.map((section) => section.group.key), ...groups.map((group) => group.key)];
	const projectOrderKeys = groups.flatMap((group) => projectOrderKey(group.key) ?? []);
	const reorders = projectReorders(projectOrderKeys, projectOrder.length > 0);
	const sectionById = new Map<string, SidebarSection>(manualSections.map((section) => [section.id, section]));
	const emptyListReason: EmptyListReason =
		(data?.pages.every((page) => page.sessions.length === 0) ?? false) &&
		prefs.statusFilter === DEFAULT_SESSION_LIST_PREFS.statusFilter &&
		prefs.activityDays === DEFAULT_SESSION_LIST_PREFS.activityDays
			?
				{
					kind: "none",
				}
			:
				{
					kind: "filtered",
					onShowAll: () =>
					{
						setSetting(
							"sessionListPrefs",
							{
								...prefs,
								statusFilter: "all",
								activityDays: "all",
							},
						);
					},
				};
	// Upstream `wv`: Date and None fetch from their last section's count-0 Show more, unless it is collapsed.
	const lastGroup = groups.at(-1);
	const fetchesInList = prefs.groupBy === "date" || prefs.groupBy === "none";
	const lastGroupCollapsed = lastGroup !== undefined && collapsed.has(lastGroup.key);
	const sectionFetchMore: SectionFetchMore | undefined =
		canFetchMore && fetchesInList && !lastGroupCollapsed
			?
				{
					loading: isFetchingNextPage,
					onFetch: (event) =>
					{
						fetchFrom(event);
					},
				}
			: undefined;
	// Upstream `Ks`: the list-level row closes Status and Project lists, a Date list whose last section is
	// collapsed, and a list showing no rows while the feed still has pages.
	const loadMoreRowKey = canFetchMore
		? prefs.groupBy === "date" && lastGroupCollapsed
			? "label:fetchmore:date"
			: !fetchesInList || groups.length === 0
				? "label:fetchmore:recents"
				: null
		: null;
	return (
		// oxlint-disable-next-line react/jsx-no-constructed-context-values -- built after the loading early return, where hooks cannot run, from selection state that changes whenever the rows re-render anyway
		<SidebarSelectionContext.Provider value={selectionApi}>
			<FoldOpenKeysContext.Provider value={foldOpenKeys}>
				<SidebarWhitespaceMenu
					scopesRef={whitespaceScopes}
					onSelectOnly={selectionApi.selectOnly}
					data-sidebar-selecting={selectedIds.length > 0 ? "" : undefined}
					// Upstream `zu`: a fold caret's click arms a 500ms guard that drops the double-click's second click.
					onClickCapture={swallowGuardedClick}
					onDoubleClickCapture={swallowGuardedClick}
					onMouseDownCapture={swallowGuardedClick}
				>
					<PinnedSubList
						rows={split.pinned}
						nested={split.nested}
						expanded={!collapsed.has(PINNED_GROUP_KEY)}
						activeItemId={activeItemId}
						dragging={rowDrag && !multiDrag}
						dropRowHot={drag?.target?.type === "zone" && drag.target.zoneId === PIN_DROP_ZONE}
						// A multi-row drag cannot pin, so Pinned is no drop target while one is under way.
						{...(multiDrag
							? {}
							:
								{
									listRef: listRef(PINNED_LIST),
									dropRowRef: zoneRef(PIN_DROP_ZONE),
								})}
						dragRowProps={rowProps}
					/>
					<div data-testid="sidebar-sections" className="contents">
						<SortableSections sectionIds={manual.map((section) => section.id)} onMove={applySectionMove}>
							{manual.map((section) =>
							{
								const view = sectionById.get(section.id);
								const groupId = section.id;
								return (
									<SortableSection key={section.group.key} id={groupId}>
										{(activator) => (
											<GroupSection
												group={section.group}
												groupBy={prefs.groupBy}
												subgroups={section.subgroups}
												collapsedKeys={collapsed}
												{...(view === undefined
													? {}
													:
														{
															showMetadata: view.show.metadata,
														})}
												expanded={!collapsed.has(section.group.key)}
												activeItemId={activeItemId}
												filterSlot={
													view === undefined ? undefined : (
														<SectionViewMenu
															section={view}
															statusFilter={prefs.statusFilter}
														/>
													)
												}
												onReveal={onReveal}
												dragRowProps={rowProps}
												sectionKeys={sectionKeys}
												headerActivator={activator}
												headerRef={zoneRef(groupHeaderZoneId(groupId))}
												dropHot={hotGroupId === groupId}
												// Inner date or status headings reorder the rows, so slots only make sense in a flat section.
												{...(section.subgroups === null
													?
														{
															rowsRef: listRef(groupListId(groupId)),
														}
													: {})}
											/>
										)}
									</SortableSection>
								);
							})}
						</SortableSections>
						{ungroupRow}
					</div>
					<div
						ref={(element) =>
						{
							recentsRef.current = element;
							zoneRef(UNGROUPED_SECTION_ZONE)(element);
						}}
						data-testid="sidebar-recents"
						data-tab-section=""
						data-recents-list=""
						data-perf-region="sidebar_recents"
						className="flex min-h-[120px] shrink-0 grow flex-col"
					>
						<SortableSections
							sectionIds={projectOrderKeys}
							// Upstream `ge` → `Dx`: the dragged folder takes the place of the one it was dropped over.
							onMove={(activeKey, overKey) =>
							{
								commitProjectOrder(
									projectOrderKeys,
									moveProjectKey(projectOrderKeys, activeKey, overKey),
								);
							}}
						>
							{groups.map((group, index) =>
							{
								const section = (activator?: SectionActivator) => (
									<GroupSection
										key={group.key}
										group={group}
										groupBy={prefs.groupBy}
										expanded={!collapsed.has(group.key)}
										activeItemId={activeItemId}
										filterSlot={filterSlot}
										onReveal={onReveal}
										fetchMore={index === groups.length - 1 ? sectionFetchMore : undefined}
										dragRowProps={rowProps}
										sectionKeys={sectionKeys}
										projectReorder={reorders.get(group.key) ?? null}
										headerActivator={activator}
									/>
								);
								const orderKey = projectOrderKey(group.key);
								return orderKey === null ? (
									section()
								) : (
									<SortableSection
										key={group.key}
										id={orderKey}
										className={SORTABLE_FOLDER_SECTION_CLASS}
									>
										{section}
									</SortableSection>
								);
							})}
						</SortableSections>
						{loadMoreRowKey !== null && (
							<LoadMoreSessionsRow
								rowKey={loadMoreRowKey}
								loading={isFetchingNextPage}
								announcement={landedAnnouncement}
								onLoad={(event) =>
								{
									setLandedAnnouncement("");
									// Upstream `vi`: only the grouped modes reveal landed rows; Date and None page from inside the list.
									fetchFrom(
										event,
										prefs.groupBy === "state" || prefs.groupBy === "project"
											? revealLanded
											: undefined,
									);
								}}
							/>
						)}
						{/* Upstream `Rs`: a new Status refetching under an empty kept list skeletons instead of an empty body. */}
						{groups.length === 0 && isPlaceholderData && manual.length === 0 && (
							<PlaceholderRows rows={3} testId="sidebar-refetch-skeleton" />
						)}
						{groups.length === 0 && !(isPlaceholderData && manual.length === 0) && (
							<EmptyGroupSection
								label={EMPTY_LIST_GROUP_LABELS[prefs.groupBy]}
								filterSlot={filterSlot}
								reason={emptyListReason}
							/>
						)}
					</div>
				</SidebarWhitespaceMenu>
			</FoldOpenKeysContext.Provider>
		</SidebarSelectionContext.Provider>
	);
}

/** Upstream `Uu`: the rows a cold load holds when no Recents count is remembered. */
const DEFAULT_PLACEHOLDER_ROWS = 3;

/**
 * The Recents slot while the feed's first page loads (upstream `AK`'s cold-load placeholders). A grouped
 * list holds its remembered row count under a label band (`sidebar-recents-placeholder`), or upstream's
 * 3-row `sidebar-column-placeholder` when no count is remembered. The flat list keeps its Recents header
 * over the rows, and only the header while Recents is collapsed.
 */
function RecentsPlaceholder({
	groupBy,
	filterSlot,
	collapsed,
	described,
}: {
	groupBy: SessionListPrefs["groupBy"];
	filterSlot: ReactNode;
	collapsed: boolean;
	described: boolean;
})
{
	const remembered = rememberedRecentsRows();
	let slot: ReactNode;
	if (groupBy === "none")
	{
		slot = (
			<div className="group/section flex flex-col gap-px">
				<StaticGroupLabel label={EMPTY_LIST_GROUP_LABELS.none} filterSlot={filterSlot} stacked />
				{!collapsed && (remembered ?? DEFAULT_PLACEHOLDER_ROWS) > 0 && (
					<PlaceholderRows rows={remembered ?? DEFAULT_PLACEHOLDER_ROWS} described={described} />
				)}
			</div>
		);
	}
	else if (remembered === undefined)
	{
		slot = (
			<PlaceholderRows
				rows={DEFAULT_PLACEHOLDER_ROWS}
				labelSpace
				className="group/section"
				testId="sidebar-column-placeholder"
				described={described}
			/>
		);
	}
	else if (remembered > 0)
	{
		slot = (
			<div data-testid="sidebar-recents-placeholder" className="group/section flex flex-col gap-px">
				<PlaceholderRows rows={remembered} labelSpace described={described} />
			</div>
		);
	}
	return (
		<div className="df-session-list contents">
			<div
				data-testid="sidebar-recents"
				data-tab-section=""
				data-recents-list=""
				className="flex min-h-[120px] shrink-0 grow flex-col"
			>
				{slot}
			</div>
		</div>
	);
}

const PINNED_LIST = "pinned";
const PIN_DROP_ZONE = "pin-drop";

/**
 * Every session row the sidebar shows, in display order: Pinned, then each expanded
 * section's rows, each with its family's listed rows. ⇧-click ranges run over this.
 */
function displayedRowIds(
	split: SplitPinned<SidebarSessionRow>,
	manual: readonly ManualSectionGroups<SidebarSessionRow>[],
	groups: readonly SessionGroup<SidebarSessionRow>[],
	collapsed: ReadonlySet<string>,
	familyFold: FamilyFoldState,
): string[]
{
	const manualGroups = manual.flatMap((section) =>
	{
		if (collapsed.has(section.group.key)) return [];
		return section.subgroups ?? [section.group];
	});
	const withFamilies = (rows: readonly SidebarSessionRow[], nested: ReadonlyMap<string, SidebarSessionRow[]>) =>
		rows.flatMap((row) => [
			row.sessionId,
			...displayedNested(row.sessionId, nested.get(row.sessionId) ?? [], familyFold).map(
				(child) => child.sessionId,
			),
		]);
	const pinned = collapsed.has(PINNED_GROUP_KEY) ? [] : pinnedRowIds(split, familyFold);
	const sections = [...manualGroups, ...groups]
		.filter((group) => !collapsed.has(group.key))
		.flatMap((group) => withFamilies(group.rows, group.nested));
	return [...pinned, ...sections];
}

/** Pinned's session rows as it shows them unfolded, each with its family's listed rows. */
function pinnedRowIds(split: SplitPinned<SidebarSessionRow>, familyFold: FamilyFoldState): string[]
{
	return split.pinned.flatMap((row) => [
		row.sessionId,
		...displayedNested(row.sessionId, split.nested.get(row.sessionId) ?? [], familyFold).map(
			(child) => child.sessionId,
		),
	]);
}

/**
 * Every fork-family head the list resolves, Pinned first, skipping archived heads like
 * upstream's `l6`/`iK`, for the ⌘K Hide/Show (all) nested sessions commands.
 */
function visibleFamilyHeads(
	split: SplitPinned<SidebarSessionRow>,
	manual: readonly ManualSectionGroups<SidebarSessionRow>[],
	groups: readonly SessionGroup<SidebarSessionRow>[],
): string[]
{
	const nestedMaps = [
		split.nested,
		...manual.flatMap((section) => [section.group, ...(section.subgroups ?? [])]).map((group) => group.nested),
		...groups.map((group) => group.nested),
	];
	const rows = new Map([...split.pinned, ...split.rest].map((row) => [row.sessionId, row]));
	const heads = new Set(nestedMaps.flatMap((nested) => [...nested.keys()]));
	return [...heads].filter((id) => rows.get(id)?.archived !== true);
}

/** Upstream `he`: write the reordered visible folders back into the stored folder order. */
function commitProjectOrder(orderKeys: readonly string[], next: readonly string[] | null): void
{
	if (next !== null) setProjectOrder(mergeProjectOrder(readProjectOrder(), orderKeys, next));
}

/**
 * Upstream `gd` → `sx`: each sortable folder section's Move up (`_e(i, i-1)`) below the first,
 * Move down above the last, and Sort A to Z (`ye`) while a folder order is stored. Other and
 * non-folder sections get none.
 */
function projectReorders(orderKeys: readonly string[], hasStoredOrder: boolean): Map<string, ProjectReorder>
{
	const move = (from: number, to: number) => () =>
	{
		commitProjectOrder(orderKeys, moveProjectIndex(orderKeys, from, to));
	};
	return new Map(
		orderKeys.map((orderKey, index) => [
			`project-${orderKey}`,
			{
				onMoveUp: index > 0 ? move(index, index - 1) : undefined,
				onMoveDown: index < orderKeys.length - 1 ? move(index, index + 1) : undefined,
				onReset: hasStoredOrder ? resetProjectOrder : undefined,
			},
		]),
	);
}

/** Upstream's drag commit: the dragged manual section takes the store order of the one it was dropped over. */
function applySectionMove(activeId: string, overId: string): void
{
	const over = readSidebarSections().find((section) => section.id === overId);
	if (over !== undefined) moveSidebarSection(activeId, over.order);
}

/**
 * Apply a released multi-row drag: every selected row joins the group it was dropped
 * on (in display order, at the slot) or leaves its group on Remove from … or Recents. Pinned rows
 * among them are unpinned so they show where they were dropped. False when nothing moved.
 */
function applyMultiGroupDrop(
	srcIds: readonly string[],
	{target}: SidebarDrop,
	manual: readonly ManualSectionGroups<SidebarSessionRow>[],
	familyFold: FamilyFoldState,
	split: SplitPinned<SidebarSessionRow> | undefined,
): boolean
{
	const lists = groupLists(manual, familyFold);
	const {assignments} = readSessionGroupState();
	const outcome = multiGroupDropOutcome(
		{
			srcIds,
			srcGroupIds: srcIds.map((id) => assignments[id] ?? null),
			target,
			lists,
		},
	);
	if (outcome === null) return false;
	const pinned = new Set(split?.pinned.map((row) => row.id));
	for (const id of srcIds) if (pinned.has(id)) unpin(id);
	switch (outcome.type)
	{
		case "ungroup":
			for (const id of srcIds) assign(id, null);
			return true;
		case "group":
		{
			const selected = new Set(srcIds);
			setGroupOrder(
				outcome.groupId,
				(lists[outcome.groupId] ?? [])
					.filter((row) => !row.nested && !selected.has(row.id))
					.map((row) => row.id),
			);
			for (const id of srcIds)
				assign(
					id,
					outcome.groupId,
					{
						before: outcome.before,
					},
				);
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
	manual: readonly ManualSectionGroups<SidebarSessionRow>[],
	familyFold: FamilyFoldState,
	split: SplitPinned<SidebarSessionRow> | undefined,
): boolean
{
	const lists = groupLists(manual, familyFold);
	const srcGroupId = readSessionGroupState().assignments[srcId] ?? null;
	const outcome = groupDropOutcome(
		{
			srcId,
			srcGroupId,
			target,
			lists,
		},
	);
	if (outcome === null) return false;
	if (split?.pinned.some((row) => row.id === srcId) === true) unpin(srcId);
	switch (outcome.type)
	{
		case "ungroup":
			assign(srcId, null);
			// Upstream restores a row put back in Recents into view (`Sy`).
			requestRevealRow(srcId);
			return true;
		case "group":
		{
			const displayed = (lists[outcome.groupId] ?? [])
				.filter((row) => !row.nested && row.id !== srcId)
				.map((row) => row.id);
			setGroupOrder(outcome.groupId, displayed);
			assign(
				srcId,
				outcome.groupId,
				{
					before: outcome.before,
				},
			);
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
): void
{
	const split = getSplit();
	if (split === undefined) return;
	// Upstream `$X`: a row nested under a pinned head drags with no pinned-slot payload.
	if ([...split.nested.values()].some((members) => members.some((row) => row.id === srcId))) return;
	const displayed = split.pinned.map((row) => row.id);
	const srcIdx = displayed.indexOf(srcId);
	let slot: number | null = null;
	if (target.type === "slot" && target.listId === PINNED_LIST) slot = target.slot;
	if (target.type === "zone" && target.zoneId === PIN_DROP_ZONE) slot = displayed.length;
	// Every target outside Pinned (the recents zone, a custom group section) is below it.
	const outcome = dropOutcome(
		{
			srcPinned: srcIdx !== -1,
			slot,
			belowPinnedBottom:
				!(target.type === "slot" && target.listId === PINNED_LIST) &&
				!(target.type === "zone" && target.zoneId === PIN_DROP_ZONE),
		},
	);
	switch (outcome)
	{
		case "pin":
		case "reorder":
		{
			if (slot === null) return;
			const index = slotToIndex(slot, srcIdx === -1 ? null : srcIdx);
			writePinState(placePin(readPinState(), displayed, srcId, index));
			// Upstream `aO`: a row pinned or reordered past Pinned's page comes into view.
			requestRevealRow(srcId);
			if (outcome === "pin") onPin();
			return;
		}
		case "unpin":
		{
			const title = split.pinned[srcIdx]?.title ?? srcId;
			unpin(srcId);
			toast(
				{
					kind: "success",
					message: `Unpinned ${title}`,
					action:
					{
						label: "Undo",
						onAction: () =>
						{
							const pins = readPinState();
							const now = getSplit();
							if (pins.pinnedIds.includes(srcId) || now === undefined) return;
							if (!now.rest.some((row) => row.id === srcId)) return;
							const pinnedNow = now.pinned.map((row) => row.id);
							writePinState(placePin(pins, pinnedNow, srcId, srcIdx));
						},
					},
				},
			);
			return;
		}
		case "cancel":
			return;
		default:
			assertNever(outcome);
	}
}

/** The drop row shown under the manual sections while a row in one is dragged (upstream `dragRemove`). */
function UngroupDropRow({ref, hot, label}: {ref: (element: HTMLElement | null) => void; hot: boolean; label: string})
{
	return (
		<div
			ref={ref}
			data-ungroup-drop-row
			data-hot={hot ? "" : undefined}
			className={`${ROW_CLASS} mt-[var(--sb-group-band-mt)] ${hot ? "bg-[var(--sb-hover)] text-secondary" : "text-muted-as-secondary"}`}
		>
			<span className="df-leading-slot">
				<Ungroup aria-hidden="true" />
			</span>
			{label}
		</div>
	);
}
