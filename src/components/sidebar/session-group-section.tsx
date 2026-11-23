import {sectionHoverWithinProps} from "../../lib/section-hover-within";
import {LABEL_SHIFT_FADE_PX, recomputeLabelShift, registerTruncatingLabel} from "../../lib/find-in-page/label-shift";
import {Link, useNavigate} from "@tanstack/react-router";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import
{
	Fragment,
	useCallback,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type KeyboardEvent,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
	type SyntheticEvent,
} from "react";

import {projectsQueryOptions} from "../../lib/api/projects";
import {requestHomeComposerFocus, requestHomeLaunchFolder} from "../../lib/home-composer-focus";
import {useSecondaryAiTitle} from "../../hooks/use-secondary-ai-title";
import type {SidebarDragRowProps} from "../../hooks/use-sidebar-drag";
import {startSessionSwitchJourney} from "../../lib/perf/field-journeys";
import {prEntries, type PrEntry} from "../../lib/pr-entries";
import {prGlyph} from "../../lib/pr-status";
import {approvalsQueryOptions} from "../../lib/api/approvals";
import {blockedDetail} from "../../lib/blocked-detail";
import {metaStatus, sessionMetaLine, sessionMetaMessage, type SessionMetaLine} from "../../lib/session-meta-line";
import {MetaLine} from "./meta-line";
import {sessionRowIconKind, type SessionStateKind} from "../../lib/session-state";
import {hasUnseenWork, subscribeUnseenWork} from "../../lib/unread-store";
import type {GroupAppearance} from "../../lib/group-appearance";
import {useProjectAppearance} from "../../lib/project-appearance-store";
import {setPendingLaunchGroup, useSessionGroups} from "../../lib/session-group-store";
import {assertNever} from "../../lib/assert-never";
import
{
	customGroupIdOfKey,
	customGroupLaunchTarget,
	isProjectGroupKey,
	type SessionGroup,
	type SessionListPrefs,
	truncates,
} from "../../lib/session-groups";
import {guardDoubleClicks, guardRowClicks} from "../../lib/sidebar-click-guard";
import {revealThrough, withHeads} from "../../lib/sidebar-section-reveal";
import {clearRevealRow, useRevealRow} from "./reveal-row-store";
import {familyKey, toggleFamilyCollapsed, toggleSidebarGroup, useSidebarState} from "../../lib/sidebar-store";
import {splitFoldedFamily, useFoldOpenKeysContext} from "../../lib/family-fold";
import {usePins} from "../../lib/pin-store";
import {familyStubLabel, familyStubTally, type FamilyStubTally} from "./family-stub-label";
import {SessionActionsMenu, SessionRowTitle} from "../session-actions-menu";
import {SessionHoverCard} from "../session-hover-card";
import {RowHoverCardContext} from "../row-hover-card-context";
import {TOUCH_QUERY} from "../../lib/touch-reveal";
import {useMediaQuery} from "../../lib/use-phone-sheet";
import {QUICK_REPLY_HINT} from "../session-hover-card-classes";
import {SidebarRowDecoration, SidebarRowSrText} from "../session-unread-control";
import {type RowAttention, useRowAttention} from "../use-row-icon-kind";
import {useSettings} from "../settings-context";
import {PrTailGlyph, SessionStateIcon} from "../status-dot";
import {PrListCard} from "./pr-list-card";
import {Icon} from "../ui/icon";
import {Tooltip} from "../ui/tooltip";
import {CustomGroupHeader} from "./custom-group-header";
import type {SectionActivator} from "./sortable-sections";
import {GroupHeaderContextMenu} from "./group-header-context-menu";
import {GroupNewSessionButton} from "./group-new-session-button";
import {GroupAppearanceMark} from "./group-appearance";
import {useOpenRowAutoExpand, useSectionFocusRescue} from "./group-section-focus";
import {ProjectGroupHeader, type ProjectReorder} from "./project-group-header";
import {UNTITLED_SESSION_TITLE} from "../../lib/session-stand-in-title";
import {useSidebarSelection} from "./selection-context";
import {JumpHint} from "./jump-hint";
import type {SidebarSessionRow} from "./sidebar-session-row";
import {useSectionHold} from "./use-section-hold";
import {ROVING_ITEM_PROPS} from "./use-roving-focus";
import {SessionTitleSkeleton} from "./session-title-skeleton";
import {RevealText} from "../reveal-text";
import {type PendingLaunchEntry, useLaunchTitleReveal} from "../../lib/pending-launch-store";

/** The section's unarchived sessions, family members included, for Archive all. */
/** The section's rows with each family's nested sessions after its head. */
function allRows(group: SessionGroup<SidebarSessionRow>): SidebarSessionRow[]
{
	return group.rows.flatMap((row) => [row, ...(group.nested.get(row.sessionId) ?? [])]);
}

/** A section's rows, stacked with the row gap. */
const ROWS_CLASS = "flex flex-col gap-[var(--sb-row-stack-gap)]";

export const ROW_CLASS =
	"flex h-[var(--sb-row-h)] w-full shrink-0 items-center gap-[var(--sb-row-gap)] rounded-[var(--sb-radius)] px-[var(--sb-row-px)] text-left text-[length:var(--sb-row-font)] no-underline";

/** Upstream's described variant (`xL` described): ROW_CLASS stacked into two lines, with no fixed height. */
const DESCRIBED_ROW_CLASS =
	"df-described-row flex w-full shrink-0 flex-col items-stretch justify-center rounded-[var(--sb-radius)] px-[var(--sb-row-px)] text-left text-[length:var(--sb-row-font)] no-underline";

/**
 * A section header's trailing controls, as upstream lays them out: Group and sort revealed on hover
 * or keyboard focus (always on touch, and while its menu is open), then a folder or manual section's
 * own +. Upstream's hub-rail sidebar puts no generic New session + on any header: the New nav row has it.
 */
function HeaderControls({filterSlot, trailing}: {filterSlot: ReactNode; trailing?: ReactNode})
{
	const hasFilter = filterSlot !== undefined && filterSlot !== null;
	if (!hasFilter && trailing === undefined) return null;
	return (
		<div data-header-controls="" className="flex items-center">
			{hasFilter && (
				// Upstream's hub sidebar (`Cs` `o_(open && !held, inHubSidebar)`) keeps Group and sort's width; CSS fades it by opacity.
				<span data-header-reveal="" className="flex">
					{filterSlot}
				</span>
			)}
			{trailing}
		</div>
	);
}

/**
 * Upstream `U8`'s `onNewSession`: go home with this project section's folder as the launch folder
 * and focus the composer. "Other" and a project whose folder is gone have nowhere to start one, so
 * they get null.
 */
function useProjectNewSession(group: SessionGroup<SidebarSessionRow>, isProject: boolean): (() => void) | null
{
	const navigate = useNavigate();
	const {data: projects} = useQuery(
		{
			...projectsQueryOptions(),
			enabled: isProject,
		},
	);
	const projectId = allRows(group)[0]?.session.project;
	const project = projects?.find((candidate) => candidate.id === projectId);
	if (!isProject || typeof project?.projectPath !== "string") return null;
	return () =>
	{
		setPendingLaunchGroup(null);
		requestHomeLaunchFolder(project.id);
		void navigate(
			{
				to: "/",
			},
		).then(requestHomeComposerFocus);
	};
}

/**
 * Upstream `uF` → `P4` for a custom section: go home with the group's folder (`$R`) as the launch
 * folder, focus the composer, and add the session launched from there to this group.
 */
function useCustomGroupNewSession(
	group: SessionGroup<SidebarSessionRow>,
	customGroupId: string | null,
):
{
	target: string | null;
	onNewSession: () => void;
} | null
{
	const navigate = useNavigate();
	const {data: projects} = useQuery(
		{
			...projectsQueryOptions(),
			enabled: customGroupId !== null,
		},
	);
	if (customGroupId === null) return null;
	const launchRows = allRows(group).map((row) => (
	{
		projectId: row.session.project,
		lastActivityAt: row.lastActivityAt,
	}));
	const {projectId, folderName} = customGroupLaunchTarget(launchRows, projects ?? []);
	return {
		target: folderName,
		onNewSession: () =>
		{
			setPendingLaunchGroup(customGroupId);
			if (projectId !== null) requestHomeLaunchFolder(projectId);
			void navigate(
				{
					to: "/",
				},
			).then(requestHomeComposerFocus);
		},
	};
}

/** The section's own +: a custom group's (with its folder target), else a project's, else none. */
function sectionNewSessionButton(
	groupLabel: string,
	custom:
	{
		target: string | null;
		onNewSession: () => void;
	} | null,
	project: (() => void) | null,
): ReactNode
{
	if (custom !== null)
	{
		return (
			<GroupNewSessionButton groupLabel={groupLabel} target={custom.target} onNewSession={custom.onNewSession} />
		);
	}
	if (project !== null) return <GroupNewSessionButton groupLabel={groupLabel} onNewSession={project} />;
	return undefined;
}

/**
 * Collapsed-header badge precedence, most urgent first: needs input, its error, unread, running.
 * Mirrors upstream's sU priorities (awaiting 0, error 1, ready 2, running 3), so an error only wins when no
 * hidden row is awaiting.
 */
const BADGE_KIND_RANK: readonly SessionStateKind[] = ["awaiting", "error", "ready", "running"];

/**
 * The most urgent status among a collapsed section's hidden rows (nested family members included,
 * the open rows it still shows left out), or null when every hidden row is settled and read.
 * Re-derived when the unread store changes.
 */
function useCollapsedBadgeKind(
	group: SessionGroup<SidebarSessionRow>,
	collapsed: boolean,
	openKeys: readonly string[],
): SessionStateKind | null
{
	const {settings} = useSettings();
	const showPrStatus = settings.sessionListPrefs.showPrStatus;
	const getSnapshot = useCallback((): SessionStateKind | null =>
	{
		if (!collapsed) return null;
		let best: number = BADGE_KIND_RANK.length;
		for (const row of allRows(group))
		{
			if (openKeys.includes(row.sessionId)) continue;
			const {session} = row;
			const kind = sessionRowIconKind(
				{
					bucket: session.bucket,
					unseen: hasUnseenWork(session.id),
					serverUnseen: session.unseen,
					unseenError: session.unseenError === true,
					prStatus: session.prStatus,
					showPrStatus,
				},
			);
			const rank = BADGE_KIND_RANK.indexOf(kind);
			if (rank !== -1 && rank < best) best = rank;
		}
		return BADGE_KIND_RANK[best] ?? null;
	}, [collapsed, group, openKeys, showPrStatus]);
	return useSyncExternalStore(subscribeUnseenWork, getSnapshot, getSnapshot);
}

/** Upstream's held Show less reason (`rr`), shown in its tooltip and describing the button. */
const HELD_REASON = "Something open or selected is near the end of this list.";

/** Date and None's last section fetch the next feed page from a count-0 Show more (upstream `canFetchMore`). */
export interface SectionFetchMore
{
	loading: boolean;
	onFetch: (event: MouseEvent<HTMLElement>) => void;
}

/** A collapsible sidebar group: label row (caret on hover), session rows, "Show more" / "Show less". */
export function GroupSection({
	group: listedGroup,
	groupBy = "state",
	expanded,
	activeItemId,
	filterSlot,
	subgroups = null,
	collapsedKeys,
	showMetadata,
	onReveal,
	fetchMore,
	dragRowProps,
	pinnedIds,
	headerActivator,
	headerRef,
	rowsRef,
	sectionRef,
	dropHot = false,
	sectionKeys,
	projectReorder = null,
}: {
	group: SessionGroup<SidebarSessionRow>;
	/** The list's grouping: grouped by status, the open session moving into a collapsed section expands it. */
	groupBy?: SessionListPrefs["groupBy"];
	expanded: boolean;
	activeItemId: string | null;
	filterSlot: ReactNode;
	/** A manual section's own Date or Status headings (upstream `v8`), drawn in place of its flat rows. */
	subgroups?: readonly SessionGroup<SidebarSessionRow>[] | null;
	/** Collapsed section keys, for the subgroups' own collapse. */
	collapsedKeys?: ReadonlySet<string>;
	/** The section's own Show ▸ Metadata (a manual section's); defaults to the list's. */
	showMetadata?: boolean;
	/** Sets how many rows past its first page a section (this one or a subgroup, by key) reveals. */
	onReveal: (key: string, extraRevealed: number) => void;
	/** Set on Date's last section and None's Recents while the feed has another page. */
	fetchMore?: SectionFetchMore | undefined;
	/** Makes each row a sidebar drag source (pin, reorder, unpin). */
	dragRowProps?: (id: string) => SidebarDragRowProps;
	/** Set for the Pinned section: its display order, which enables Move up / Move down. */
	pinnedIds?: readonly string[];
	/** Makes the label row its sortable section's drag activator (a manual section header reorders sections). */
	headerActivator?: SectionActivator | undefined;
	/** Registers the label row as a drop zone. */
	headerRef?: (element: HTMLElement | null) => void;
	/** Registers the rows as a drag list whose slots are drop positions. */
	rowsRef?: (element: HTMLElement | null) => void;
	/** Registers the whole section as a drop zone. */
	sectionRef?: (element: HTMLElement | null) => void;
	/** A dragged row or header is over this section's header or rows. */
	dropHot?: boolean;
	/** Every section shown in the list, for the header menu's Collapse all / Expand all; defaults to this one. */
	sectionKeys?: readonly string[];
	/** A folder section's place in the folder order (Move up / Move down / Sort A to Z); null for Other. */
	projectReorder?: ProjectReorder | null;
})
{
	const {settings} = useSettings();
	const prefs = settings.sessionListPrefs;
	// Upstream `fn#f`: a new grouping, filter or Show less drops the hold's baseline.
	const [showLessCount, setShowLessCount] = useState(0);
	const hold = useSectionHold(
		listedGroup,
		{
			epoch: `${prefs.groupBy}|${prefs.statusFilter}|${prefs.activityDays}#${showLessCount}`,
			order: `${prefs.sortBy}:${prefs.sortDirection}`,
		},
	);
	const group = hold.group;
	const customGroupId = customGroupIdOfKey(group.key);
	const isProject = isProjectGroupKey(group.key);
	const projectNewSession = useProjectNewSession(group, isProject);
	const customNewSession = useCustomGroupNewSession(group, customGroupId);
	const appearance = useSectionAppearance(group.key, customGroupId, isProject);
	// Upstream omits the env glyph on pinned rows and when the section is itself a place.
	const envGlyph = pinnedIds === undefined && !isProject;
	const place: RowPlace =
	{
		heading: group.label,
		underStatusHeading: groupBy === "state",
		metadata: showMetadata ?? settings.sessionListPrefs.showMetadata,
	};
	const sectionElement = useRef<HTMLDivElement | null>(null);
	const rows = useMemo(() => allRows(group), [group]);
	const rowKeys = useMemo(() => rows.map((row) => row.sessionId), [rows]);
	const openKeys = useMemo(() => (activeItemId === null ? [] : [activeItemId]), [activeItemId]);
	const {extraRevealed, pageSize, sorted, headOf} = group;
	// Upstream `R = rz(L, heldBy)`: open rows plus their family heads. The code sidebar's multi-selection
	// is not part of upstream's keptInView, so Show less hides selected rows past the cap.
	const revealOpenKeys = useMemo(() => withHeads(openKeys, headOf), [openKeys, headOf]);
	const sortedKeys = useMemo(() => sorted.map((row) => row.sessionId), [sorted]);
	const revealRequest = useRevealRow();
	const revealKey = revealRequest === null ? null : (headOf.get(revealRequest.id) ?? revealRequest.id);
	// Upstream `AE`, grow-only: reveal through the last open or moved row hidden past the page.
	const grownTo = revealThrough(
		{
			keys: sortedKeys,
			truncateAt: pageSize,
			extraRevealed: Math.max(extraRevealed, hold.extraRevealed),
			hiddenCount: group.hiddenCount,
			collapsed: !expanded,
			openKeys: revealOpenKeys,
			revealKey,
		},
	);
	useEffect(() =>
	{
		if (grownTo > extraRevealed) onReveal(group.key, grownTo);
	}, [grownTo, extraRevealed, group.key, onReveal]);
	useEffect(() =>
	{
		if (revealRequest === null || revealKey === null) return;
		if (!group.rows.some((row) => row.sessionId === revealKey)) return;
		clearRevealRow(revealRequest.id);
		if (!revealRequest.focus) return;
		sectionElement.current
			?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(revealRequest.id)}"] [data-row-main-button]`)
			?.focus();
	}, [revealRequest, revealKey, group.rows]);
	// Upstream `sP` (`Me`) + `kM`/`xc`: open rows stay visible under a collapsed header, an open nested row with its head.
	const openFamilies = expanded
		? []
		: group.rows.flatMap((row) =>
			{
				const members = (group.nested.get(row.sessionId) ?? []).filter((child) =>
					openKeys.includes(child.sessionId),
				);
				return openKeys.includes(row.sessionId) || members.length > 0
					? [
							{
								row,
								members,
							},
						]
					: [];
			});
	const openRows = openFamilies.flatMap(({row, members}) => [row, ...members]);
	const badgeKind = useCollapsedBadgeKind(group, !expanded, openKeys);
	useOpenRowAutoExpand(
		{
			groupBy,
			groupKey: group.key,
			rowKeys,
			openKeys,
			collapsed: !expanded,
			customGroup: customGroupId !== null,
			sectionRef: sectionElement,
		},
	);
	useSectionFocusRescue(group.key, sectionElement);
	const [announcement, announce] = useOverflowAnnouncement();
	const heldHintId = useId();
	// Upstream shares one quick-reply hint per section across its Needs input rows.
	const awaitingHintId = useId();
	const hasAwaiting = (subgroups === null ? rows : openRows).some((row) => row.bucket === "blocked");
	const awaitingDescribedBy = (row: SidebarSessionRow) => (row.bucket === "blocked" ? awaitingHintId : undefined);
	// Upstream `fe`/`pe`/`me`: Show less folds back to the floor that keeps open and selected rows in view,
	// and is held when that floor would leave fewer than two rows hidden.
	const showLessFloor = group.canShowLess
		? revealThrough(
				{
					keys: sortedKeys,
					truncateAt: pageSize,
					extraRevealed: 0,
					hiddenCount: sortedKeys.length - pageSize,
					collapsed: false,
					openKeys: revealOpenKeys,
				},
			)
		: 0;
	const showLessLive =
		group.canShowLess && extraRevealed > showLessFloor && truncates(sortedKeys.length, pageSize, showLessFloor);
	const showLessHeld = group.canShowLess && !showLessLive;
	const toggle = (
		<h3 className="flex min-w-0 flex-1">
			<button
				type="button"
				{...ROVING_ITEM_PROPS}
				data-group-toggle
				aria-expanded={expanded}
				onClick={() =>
				{
					toggleSidebarGroup(group.key);
				}}
				className="group/label -my-1 -ml-1 flex min-w-0 flex-1 items-center gap-1.25 rounded-[var(--sb-radius)] py-1 pl-1 text-left hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--upstream-fill-accent),0_0_6px_0_color-mix(in_srgb,var(--upstream-fill-accent)_20%,transparent)]"
			>
				<span data-group-name className="min-w-0">
					<FadeLabel text={group.label} />
				</span>
				{appearance !== undefined && (appearance.icon !== undefined || appearance.color !== undefined) && (
					<span
						data-group-mark
						className="flex shrink-0 text-[color:var(--muted-as-secondary,var(--color-ink-muted))]"
					>
						<GroupAppearanceMark appearance={appearance} />
					</span>
				)}
				{/* Upstream `SH` (shared-18): the caret always stays visible (`data-group-caret="stays"`). */}
				<Icon
					name="CaretRightFilled"
					customSize={14}
					data-group-caret="stays"
					style={
					{
						translate: "0 0.5px",
					}}
					className={`size-3.5 shrink-0 transition-transform duration-[60ms] motion-reduce:transition-none ${
						expanded ? "rotate-90 " : ""
					}group-data-[hover-within]/section:opacity-100 group-focus-visible/label:opacity-100 opacity-100`}
				/>
				{badgeKind !== null && (
					<span data-group-badge className="-my-1 ms-auto flex size-6 shrink-0 items-center justify-center">
						<SessionStateIcon
							kind={badgeKind}
							live={false}
							{...(badgeKind === "ready"
								?
									{
										label: "Unread response",
									}
								: {})}
						/>
					</span>
				)}
			</button>
		</h3>
	);
	return (
		<div
			ref={(element) =>
			{
				sectionElement.current = element;
				sectionRef?.(element);
			}}
			data-group-key={group.key}
			{...sectionHoverWithinProps}
			className="group/section relative isolate flex flex-col pb-[var(--sb-group-pb)]"
		>
			<div
				ref={(element) =>
				{
					headerRef?.(element);
					headerActivator?.setActivatorNodeRef(element);
				}}
				onPointerDown={headerActivator?.onPointerDown}
				data-sidebar-group-label
				data-drop-hot={dropHot ? "" : undefined}
				data-rowless={expanded || openRows.length > 0 ? undefined : ""}
				className="group/labelrow df-label-inset rounded-[var(--sb-radius)] data-[drop-hot]:bg-[var(--sb-hover)] mb-[var(--sb-row-stack-gap)] flex mt-[var(--sb-group-band-mt)] h-[var(--sb-group-band-h)] w-full items-center gap-[var(--sb-row-gap)] pt-[var(--sb-group-pt)] pr-[var(--sb-row-ctl-inset)] pb-[var(--sb-group-label-pb)] text-[length:var(--sb-group-font)] leading-4 [--sb-heading-ink:var(--color-ink-muted)] hover:[--sb-heading-ink:var(--color-secondary)] text-[color:var(--sb-heading-ink)]"
			>
				{customGroupId === null ? (
					isProject ? (
						<ProjectGroupHeader
							group={group}
							sectionKeys={sectionKeys ?? [group.key]}
							activeItemId={activeItemId}
							onNewSession={projectNewSession}
							reorder={projectReorder}
						>
							{toggle}
						</ProjectGroupHeader>
					) : (
						<GroupHeaderContextMenu
							group={group}
							sectionKeys={sectionKeys ?? [group.key]}
							activeItemId={activeItemId}
							pinned={pinnedIds !== undefined}
						>
							{toggle}
						</GroupHeaderContextMenu>
					)
				) : (
					<CustomGroupHeader
						groupId={customGroupId}
						group={group}
						sectionKeys={sectionKeys ?? [group.key]}
						activeItemId={activeItemId}
						onNewSession={
							customNewSession?.onNewSession ??
							(() =>
							{
							})
						}
					>
						{toggle}
					</CustomGroupHeader>
				)}
				<HeaderControls
					filterSlot={filterSlot}
					trailing={sectionNewSessionButton(group.label, customNewSession, projectNewSession)}
				/>
			</div>
			{hasAwaiting && (
				<div className="contents">
					<span id={awaitingHintId} data-find-omitted="" className="sr-only select-none">
						{QUICK_REPLY_HINT}
					</span>
				</div>
			)}
			{/* Upstream P3: collapsed rows stay mounted in a hidden wrapper, keeping their state. */}
			{subgroups === null ? (
				<div ref={rowsRef} data-group-rows hidden={!expanded} className={expanded ? ROWS_CLASS : "hidden"}>
					{(expanded ? group.rows : group.rows.filter((row) => !openRows.includes(row))).map((row) =>
					{
						const nested = group.nested.get(row.sessionId);
						return (
							<Fragment key={row.sessionId}>
								<div
									{...dragRowProps?.(row.sessionId)}
									data-row-key={row.sessionId}
									data-jump-hint-row=""
									aria-describedby={awaitingDescribedBy(row)}
									className="df-drag-shiftable relative"
								>
									{row.pendingLaunch === undefined ? (
										<SessionRowLink
											row={row}
											selected={row.sessionId === activeItemId}
											pinnedIds={pinnedIds}
											envGlyph={envGlyph}
											place={place}
											awaitingHintId={awaitingHintId}
											{...(nested === undefined
												? {}
												:
													{
														nameSuffix: (
															<FamilyCaret headId={row.sessionId} title={row.title} />
														),
														familyHead: true,
													})}
										/>
									) : (
										<PendingLaunchRow row={row} launch={row.pendingLaunch} envGlyph={envGlyph} />
									)}
									<JumpHint rowKey={row.sessionId} />
								</div>
								{nested !== undefined && (
									<SessionFamily
										head={row}
										nested={nested}
										activeItemId={activeItemId}
										dragRowProps={dragRowProps}
										pinnedIds={pinnedIds}
										envGlyph={envGlyph}
										place={place}
										awaitingHintId={awaitingHintId}
									/>
								)}
							</Fragment>
						);
					})}
					{group.hiddenCount > 0 ? (
						<OverflowRow
							rowKey={`label:showmore:${group.key}`}
							ariaLabel={`Show ${group.revealCount} more in ${group.label}`}
							onClick={() =>
							{
								announce(`Showing ${group.revealCount} more in ${group.label}`);
								onReveal(group.key, extraRevealed + hold.showMoreStep);
							}}
							awaiting={group.hiddenAwaiting}
						>
							Show more
						</OverflowRow>
					) : fetchMore === undefined ? (
						group.canShowLess && (
							<OverflowRow
								rowKey={`label:showmore:${group.key}`}
								ariaLabel={`Show less in ${group.label}`}
								held={showLessHeld ? heldHintId : undefined}
								onClick={() =>
								{
									announce(`Showing less in ${group.label}`);
									setShowLessCount((count) => count + 1);
									onReveal(group.key, showLessFloor);
								}}
							>
								Show less
							</OverflowRow>
						)
					) : (
						// Upstream `rr` count 0 with `canFetchMore`: "Show more", aria "Show more sessions", fetching the next page.
						<OverflowRow
							rowKey={`label:showmore:${group.key}`}
							ariaLabel="Show more sessions"
							disabled={fetchMore.loading}
							onClick={fetchMore.onFetch}
						>
							{fetchMore.loading ? "Loading…" : "Show more"}
						</OverflowRow>
					)}
					{announcement !== null && (
						<span className="sr-only" role="status">
							{announcement.text}
							{announcement.nonce % 2 === 1 ? "\u200B" : ""}
						</span>
					)}
				</div>
			) : (
				<div data-group-rows hidden={!expanded} className={expanded ? "flex flex-col" : "hidden"}>
					{subgroups.map((subgroup) => (
						<GroupSection
							key={subgroup.key}
							group={subgroup}
							groupBy={groupBy}
							expanded={collapsedKeys?.has(subgroup.key) !== true}
							activeItemId={activeItemId}
							filterSlot={undefined}
							{...(showMetadata === undefined
								? {}
								:
									{
										showMetadata,
									})}
							onReveal={onReveal}
							{...(dragRowProps === undefined
								? {}
								:
									{
										dragRowProps,
									})}
							sectionKeys={sectionKeys ?? [group.key]}
						/>
					))}
				</div>
			)}
			{openRows.length > 0 && (
				<div data-group-rows className={ROWS_CLASS}>
					{openFamilies.map(({row, members}) => (
						<Fragment key={row.sessionId}>
							<div
								data-row-key={row.sessionId}
								data-jump-hint-row=""
								aria-describedby={awaitingDescribedBy(row)}
								className="relative"
							>
								<SessionRowLink
									row={row}
									selected={row.sessionId === activeItemId}
									pinnedIds={pinnedIds}
									envGlyph={envGlyph}
									place={place}
									awaitingHintId={awaitingHintId}
								/>
								<JumpHint rowKey={row.sessionId} />
							</div>
							{members.length > 0 && (
								<SessionFamily
									head={row}
									nested={members}
									activeItemId={activeItemId}
									dragRowProps={undefined}
									pinnedIds={pinnedIds}
									foldable={false}
									envGlyph={envGlyph}
									place={place}
									awaitingHintId={awaitingHintId}
								/>
							)}
						</Fragment>
					))}
				</div>
			)}
		</div>
	);
}

/** Which of upstream's empty sidebar lists to show: nothing yet, filtered to nothing, or a failed load. */
export type EmptyListReason =
	|
	  {
			kind: "none";
	  }
	|
	  {
			kind: "filtered";
			onShowAll: () => void;
	  }
	|
	  {
			kind: "failed";
			onRetry: () => void;
	  };

/** Upstream's empty sidebar list bodies, centered under the header. */
function EmptyListBody({reason}: {reason: EmptyListReason})
{
	switch (reason.kind)
	{
		case "none":
			return (
				<div
					data-sidebar-empty
					className="flex min-h-[200px] flex-col items-center justify-center px-4 text-center text-footnote text-ink-muted"
				>
					Sessions you start will show up here
				</div>
			);
		case "filtered":
			return (
				<div data-sidebar-empty className="flex flex-col items-center gap-2 px-4 py-6 text-center">
					<p className="m-0 text-footnote text-ink-muted">No sessions match the current filters</p>
					<button
						type="button"
						onClick={reason.onShowAll}
						className="cursor-pointer text-footnote text-secondary hover:underline"
					>
						Show all sessions
					</button>
				</div>
			);
		case "failed":
			return (
				<div role="alert" data-sidebar-empty className="flex flex-col items-center gap-2 px-4 py-6 text-center">
					<p className="m-0 text-footnote text-ink-muted">Couldn’t load your sessions</p>
					<button
						type="button"
						onClick={reason.onRetry}
						className="h-6 cursor-pointer rounded-r5 px-2 text-footnote text-secondary shadow-[inset_0_0_0_1px_var(--color-border)] hover:bg-fill-ghost-hover"
					>
						Try again
					</button>
				</div>
			);
		default:
			return assertNever(reason);
	}
}

/**
 * Stands in for the group list when no group renders: a header row carrying the Group and sort
 * slot, so a filter can never hide its own control, over upstream's empty state for the reason.
 */
export function EmptyGroupSection({
	label,
	filterSlot,
	reason,
}: {
	label: string;
	filterSlot: ReactNode;
	reason: EmptyListReason;
})
{
	return (
		<div data-group-key="empty" className="group/section relative isolate flex flex-col pb-[var(--sb-group-pb)]">
			<StaticGroupLabel label={label} filterSlot={filterSlot} />
			<EmptyListBody reason={reason} />
		</div>
	);
}

/** A group label row with no fold toggle, over the empty list or the loading placeholder rows. */
export function StaticGroupLabel({
	label,
	filterSlot,
	stacked = false,
}: {
	label: string;
	filterSlot: ReactNode;
	/** Over rows, the label ends one row stack gap above them, as a group header does. */
	stacked?: boolean;
})
{
	return (
		<div
			data-sidebar-group-label
			className={`group/labelrow df-label-inset ${stacked ? "mb-[var(--sb-row-stack-gap)] " : ""}flex mt-[var(--sb-group-band-mt)] h-[var(--sb-group-band-h)] w-full items-center gap-[var(--sb-row-gap)] pt-[var(--sb-group-pt)] pr-[var(--sb-row-ctl-inset)] pb-[var(--sb-group-label-pb)] text-[length:var(--sb-group-font)] leading-4 [--sb-heading-ink:var(--color-ink-muted)] hover:[--sb-heading-ink:var(--color-secondary)] text-[color:var(--sb-heading-ink)]`}
		>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			<HeaderControls filterSlot={filterSlot} />
		</div>
	);
}

/**
 * A group's muted "Show more" / "Show less" / "Loading…" row (upstream `rr`): double-clicks
 * and clicks while disabled or held are ignored, and `awaiting` puts an awaiting dot at the row end.
 * `held` (the id for its sr-only reason) marks a Show less that would hide the open session.
 */
function OverflowRow({
	rowKey,
	ariaLabel,
	onClick,
	disabled = false,
	held,
	awaiting = false,
	children,
}: {
	/** Upstream's `label:showmore:<groupKey>` row key on the drag-shiftable wrapper. */
	rowKey: string;
	ariaLabel?: string;
	onClick: (event: MouseEvent<HTMLElement>) => void;
	disabled?: boolean;
	held?: string | undefined;
	awaiting?: boolean;
	children: ReactNode;
})
{
	const inert = disabled || held !== undefined;
	const button = (
		<button
			type="button"
			{...ROVING_ITEM_PROPS}
			data-row
			aria-label={ariaLabel}
			aria-disabled={inert ? true : undefined}
			aria-describedby={held}
			data-held={held === undefined ? undefined : ""}
			onClick={(event) =>
			{
				if (inert || event.detail > 1) return;
				onClick(event);
			}}
			className={`${ROW_CLASS} text-ink-muted hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--upstream-fill-accent),0_0_6px_0_color-mix(in_srgb,var(--upstream-fill-accent)_20%,transparent)] hover:bg-[var(--sb-hover)] hover:text-secondary aria-disabled:pointer-events-none aria-disabled:opacity-70 aria-disabled:data-[held]:pointer-events-auto data-[held]:hover:bg-transparent data-[held]:hover:text-ink-muted`}
		>
			<span className="ps-[var(--sb-iconless-pad)]">{children}</span>
			{awaiting && (
				<span className="ms-auto flex size-[var(--sb-row-ctl)] shrink-0 items-center justify-center">
					<SessionStateIcon kind="awaiting" live={false} />
				</span>
			)}
		</button>
	);
	// Upstream wraps the row in a `label:showmore:<groupKey>` drag-shiftable div, and a held row's button
	// in a lazy 350ms inline-end disabled-reason tooltip (`JJ`) that stays open on click.
	return (
		<div data-row-key={rowKey} className="df-drag-shiftable [overflow-anchor:none]">
			{held === undefined ? (
				button
			) : (
				<>
					<Tooltip
						content={HELD_REASON}
						side="right"
						variant="reason"
						closeOnClick={false}
						delay={350}
						className="flex w-full"
					>
						{button}
					</Tooltip>
					<span id={held} hidden>
						{HELD_REASON}
					</span>
				</>
			)}
		</div>
	);
}

/**
 * Upstream `DN`'s announcement: each one bumps a nonce whose odd values append U+200B, so a repeated
 * message still changes and is re-announced, and it clears after 4s so the status span unmounts.
 */
function useOverflowAnnouncement(): [
	{
		text: string;
		nonce: number;
	} | null,
	(text: string) => void,
]
{
	const [announcement, setAnnouncement] = useState<
	{
		text: string;
		nonce: number;
	} | null>(null);
	const nonceRef = useRef(0);
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(
		() => () =>
		{
			clearTimeout(timerRef.current);
		},
		[],
	);
	const announce = useCallback((text: string) =>
	{
		nonceRef.current += 1;
		setAnnouncement(
			{
				text,
				nonce: nonceRef.current,
			},
		);
		clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() =>
		{
			setAnnouncement(null);
		}, 4000);
	}, []);
	return [announcement, announce];
}

/** Upstream `Ri`'s iconless row recipe with `u3`'s inset and `Yn`'s group gap, for the list-level Load more row. */
const LOAD_MORE_CLASS =
	"hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--upstream-fill-accent),0_0_6px_0_color-mix(in_srgb,var(--upstream-fill-accent)_20%,transparent)] hit-row [--cds-hit-gap-y:7px] hit-row-main flex h-[var(--sb-row-h)] w-full shrink-0 items-center gap-[var(--sb-row-gap)] rounded-[var(--sb-radius)] text-start text-[length:var(--sb-row-font)] text-ink-muted hover:bg-[var(--sb-hover)] hover:text-secondary aria-disabled:pointer-events-none aria-disabled:opacity-70 pe-[var(--sb-row-px)] ps-[calc(var(--sb-row-px)+var(--sb-iconless-pad))] mt-[var(--sb-group-pt-token)]";

/**
 * Upstream `Ks` (`p$` with `loadSessionsFace`): the list-level "Load more sessions" row after the last
 * section. Its text sits straight in the button with no leading slot, reads "Loading…" while the next
 * page loads (aria-disabled, keeping focus), and ignores double clicks.
 */
export function LoadMoreSessionsRow({
	rowKey,
	loading,
	announcement,
	onLoad,
}: {
	rowKey: "label:fetchmore:recents" | "label:fetchmore:date";
	loading: boolean;
	/** "Loaded N more sessions" once a load lands. */
	announcement: string;
	onLoad: (event: MouseEvent<HTMLElement>) => void;
})
{
	const hintId = useId();
	return (
		<div data-row-key={rowKey} className="df-drag-shiftable [overflow-anchor:none]">
			<button
				type="button"
				{...ROVING_ITEM_PROPS}
				data-row
				aria-label="Load more sessions"
				aria-disabled={loading ? true : undefined}
				onClick={(event) =>
				{
					if (loading || event.detail > 1) return;
					onLoad(event);
				}}
				className={LOAD_MORE_CLASS}
			>
				{loading ? "Loading…" : "Load more sessions"}
			</button>
			<span id={hintId} hidden />
			<span className="sr-only" role="status">
				{announcement}
			</span>
		</div>
	);
}

/** The header icon and color of a custom group or project section. */
function useSectionAppearance(
	key: string,
	customGroupId: string | null,
	isProject: boolean,
): GroupAppearance | undefined
{
	const {groups} = useSessionGroups();
	const projects = useProjectAppearance();
	if (customGroupId !== null) return groups.find((entry) => entry.id === customGroupId);
	return isProject ? projects[key] : undefined;
}

/**
 * Upstream's fold caret (shared-21 `o$`): sits after a family head row's title and hides or shows the
 * family's nested sessions. Named "Hide nested sessions {title}" through a hidden title span; it is an
 * arrows-only row control (`data-row-action`, tabIndex -1) inside the row link, so it stops the link's
 * click, press, drag and middle-click, and a mouse click arms the list's 500ms double-click guard.
 */
function FamilyCaret({headId, title}: {headId: string; title: string})
{
	const {collapsedFamilies} = useSidebarState();
	const collapsed = collapsedFamilies.includes(familyKey(headId));
	const id = useId();
	const label = collapsed ? "Show nested sessions" : "Hide nested sessions";
	const toggle = (event: MouseEvent | KeyboardEvent) =>
	{
		event.preventDefault();
		event.stopPropagation();
		toggleFamilyCollapsed(headId);
		if (event.type === "click" && event.detail > 0) guardDoubleClicks(500);
	};
	const stop = (event: SyntheticEvent) =>
	{
		event.stopPropagation();
	};
	return (
		<Tooltip content={label}>
			<span className="flex ms-0.25">
				<span id={`${id}-title`} hidden>
					{title.trim() || UNTITLED_SESSION_TITLE}
				</span>
				<span
					role="button"
					data-container-icon=""
					data-row-action=""
					tabIndex={-1}
					id={id}
					aria-expanded={!collapsed}
					aria-label={label}
					aria-labelledby={`${id} ${id}-title`}
					onClick={toggle}
					onPointerDown={stop}
					onDoubleClick={stop}
					onAuxClick={(event) =>
					{
						if (event.button !== 1) return;
						event.preventDefault();
						event.stopPropagation();
					}}
					onKeyDown={(event) =>
					{
						if (event.key === "Enter" || event.key === " ") toggle(event);
					}}
					className="hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--upstream-fill-accent),0_0_6px_0_color-mix(in_srgb,var(--upstream-fill-accent)_20%,transparent)] -m-0.5 flex shrink-0 cursor-pointer items-center justify-center rounded p-0.5 hover:bg-[var(--upstream-fill-ghost-hover)] hover:text-primary text-[color:var(--muted-as-secondary,var(--color-ink-muted))]"
				>
					<Icon
						name="CaretDownSmall"
						customSize={14}
						data-open={collapsed ? undefined : ""}
						style={
						{
							contain: "layout paint",
							pointerEvents: "none",
							translate: "0 0.5px",
						}}
						className={`transition-transform duration-[60ms] motion-reduce:transition-none${
							collapsed ? " -rotate-90 rtl:rotate-90" : ""
						}`}
					/>
				</span>
			</span>
		</Tooltip>
	);
}

/**
 * A family head's nested sessions (upstream `.df-family`): indented 20px under an elbow guide;
 * the head row's caret folds them behind a stub row. Under a pinned head (upstream `WA`) the family
 * sits in a `[data-pinned-family]` wrapper that shifts with the head's drag slot, indents by the
 * pinned `--sb-row-indent`, and its rows take the pinned look and are no Pinned drag slots.
 * `foldable={false}` (a collapsed section keeping an open row) lists every row and no stub.
 */
function SessionFamily({
	head,
	nested,
	activeItemId,
	dragRowProps,
	pinnedIds,
	foldable = true,
	envGlyph,
	place,
	awaitingHintId,
}: {
	head: SidebarSessionRow;
	nested: readonly SidebarSessionRow[];
	activeItemId: string | null;
	dragRowProps: ((id: string) => SidebarDragRowProps) | undefined;
	/** Set under a pinned head: the Pinned slots, as GroupSection's `pinnedIds`. */
	pinnedIds?: readonly string[] | undefined;
	foldable?: boolean;
	envGlyph: boolean;
	place: RowPlace;
	/** The section's shared quick-reply hint, describing its Needs input rows. */
	awaitingHintId: string;
})
{
	const {collapsedFamilies} = useSidebarState();
	const collapsed = foldable && collapsedFamilies.includes(familyKey(head.sessionId));
	const underPinnedHead = pinnedIds !== undefined;
	const pins = usePins();
	const openKeys = useFoldOpenKeysContext();
	const {kept, hidden} = splitFoldedFamily(
		nested,
		{
			collapsed,
			pinnedIds: pins.pinnedIds,
			openKeys,
		},
	);
	const ref = useRef<HTMLDivElement>(null);
	// Upstream `nU` queues focus for the first row the stub hid, not the first listed nested row.
	const focusAfterUnfold = useRef<string | null>(null);

	useEffect(() =>
	{
		const id = focusAfterUnfold.current;
		if (collapsed || id === null) return;
		focusAfterUnfold.current = null;
		ref.current
			?.querySelector<HTMLElement>(
				`[data-family-child][data-row-key="${CSS.escape(id)}"] a[data-row-main-button]`,
			)
			?.focus();
	}, [collapsed]);

	const titles = new Map([head, ...nested].map((row) => [row.sessionId, row.title]));

	const family = (
		<div
			ref={ref}
			data-family-head={head.sessionId}
			className="df-family relative flex flex-col gap-[var(--sb-row-stack-gap)] [--sb-row-indent:calc(var(--sb-group-indent,0px)+20px)]"
		>
			{kept.map((child) =>
			{
				const parentTitle =
					child.forkedFromSessionId === undefined ? undefined : titles.get(child.forkedFromSessionId);
				return (
					<div
						key={child.sessionId}
						data-family-child
						data-row-key={child.sessionId}
						data-jump-hint-row=""
						aria-describedby={child.bucket === "blocked" ? awaitingHintId : undefined}
						{...dragRowProps?.(child.sessionId)}
						data-drag-nested={underPinnedHead ? "" : undefined}
						className={`df-drag-shiftable relative ${underPinnedHead ? "pl-[var(--sb-row-indent)]" : "pl-5"}`}
					>
						<SessionRowLink
							row={child}
							selected={child.sessionId === activeItemId}
							pinnedIds={pinnedIds}
							envGlyph={envGlyph}
							place={place}
							awaitingHintId={awaitingHintId}
							lineage={parentTitle === undefined ? "Nested session" : `Forked from ${parentTitle}`}
						/>
						<JumpHint rowKey={child.sessionId} />
					</div>
				);
			})}
			{hidden.length > 0 && (
				// Upstream `Fe`: the stub shifts with a drag like any row but is no drag slot itself.
				<div data-row-key={`family-stub:${head.sessionId}`} className="df-drag-shiftable relative">
					<FamilyStub
						tally={familyStubTally(hidden)}
						someListed={kept.length > 0}
						onExpand={(focusNext) =>
						{
							focusAfterUnfold.current = focusNext ? (hidden[0]?.sessionId ?? null) : null;
							toggleFamilyCollapsed(head.sessionId);
						}}
					/>
				</div>
			)}
		</div>
	);
	if (!underPinnedHead) return family;
	return (
		<div data-pinned-family="" data-drag-follow={head.sessionId} className="df-drag-shiftable">
			{family}
		</div>
	);
}

/**
 * A folded family's stub row (upstream `nU`): the hidden count as a fading label, then only the first
 * news segment of "· {n} needs input" (warning ink), "· {n} failed", "· {n} unread" (accent ink) and
 * "· {n} working" (the aria label keeps them all), and a trailing glyph for the first of waiting
 * (awaiting icon) or failed (error icon).
 */
function FamilyStub({
	tally,
	someListed,
	onExpand,
}: {
	tally: FamilyStubTally;
	someListed: boolean;
	/** Unfold the family; `focusNext` moves focus to the first row the stub hid. */
	onExpand: (focusNext: boolean) => void;
})
{
	const {label, shown, ariaLabel} = familyStubLabel(tally, someListed);
	const separator = (
		<span aria-hidden="true" className="px-1.5 text-secondary">
			·
		</span>
	);

	return (
		<button
			type="button"
			{...ROVING_ITEM_PROPS}
			data-row
			aria-label={ariaLabel}
			onClick={(event) =>
			{
				// The rest of a double- or triple-click must not refold or open a revealed row.
				if (event.detail > 1) return;
				// Upstream `X7(e, true)`: follow with focus only from the keyboard or a focused stub.
				const stub = event.currentTarget;
				onExpand(event.detail === 0 || stub.matches(":focus-visible") || document.activeElement === stub);
				if (event.detail > 0) guardRowClicks(500);
			}}
			onPointerDown={(event) =>
			{
				event.stopPropagation();
			}}
			className="df-family-stub hit-row [--cds-hit-gap-y:7px] hit-row-main flex h-[var(--sb-row-h)] w-full min-w-0 items-center rounded-[var(--sb-radius)] pe-[var(--sb-row-px)] ps-[calc(var(--sb-row-px)+var(--sb-row-indent,0px)+var(--sb-iconless-pad,calc((var(--sb-leading-slot)-var(--sb-icon))/2)))] text-start text-[length:var(--sb-group-font)] text-primary hover:bg-[var(--sb-hover)] hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--upstream-fill-accent),0_0_6px_0_color-mix(in_srgb,var(--upstream-fill-accent)_20%,transparent)]"
		>
			<span className="df-fade-truncate flex items-center whitespace-nowrap">
				<span data-row-label="" className="min-w-0">
					<FadeLabel text={label} />
				</span>
				{shown !== undefined && (
					<span className="flex shrink-0 items-center">
						{separator}
						{shown.kind === "waiting" ? (
							<span className="text-warning">{shown.text}</span>
						) : shown.kind === "unread" ? (
							<span className="flex items-center gap-1.5 text-upstream-accent">{shown.text}</span>
						) : (
							shown.text
						)}
					</span>
				)}
			</span>
			{(tally.waiting > 0 || tally.failed > 0) && (
				<span
					aria-hidden="true"
					data-row-decoration=""
					className="me-[calc(var(--sb-row-ctl-inset,calc((var(--sb-row-h)-var(--sb-row-ctl))/2))-var(--sb-row-px))] ms-auto flex size-[var(--sb-row-ctl)] shrink-0 items-center justify-center"
				>
					{tally.waiting > 0 ? (
						<SessionStateIcon kind="awaiting" live={false} />
					) : (
						<SessionStateIcon kind="error" label="Something went wrong" live={false} />
					)}
				</span>
			)}
		</button>
	);
}

const NO_PR_ENTRIES: readonly PrEntry[] = [];

function SessionRowLink({
	row,
	selected,
	pinnedIds,
	envGlyph,
	place,
	lineage,
	awaitingHintId,
	nameSuffix,
	familyHead = false,
}: {
	row: SidebarSessionRow;
	selected: boolean;
	pinnedIds: readonly string[] | undefined;
	/** Draw the settled row's environment glyph in the trailing slot. */
	envGlyph: boolean;
	/** The section the row sits in, which the metadata line avoids repeating. */
	place: RowPlace;
	/** Screen-reader note on a nested row, e.g. "Forked from {title}". */
	lineage?: string;
	/** The section's shared quick-reply hint, describing a Needs input row. */
	awaitingHintId: string;
	/** Upstream's `nameSuffix`: a control right after the title (a family head's fold caret). */
	nameSuffix?: ReactNode;
	/** The row heads a foldable fork family, so its menu offers Hide/Show nested sessions. */
	familyHead?: boolean;
})
{
	const queryClient = useQueryClient();
	const selection = useSidebarSelection();
	const multiSelected = selection?.selectedIds.includes(row.sessionId) === true;
	const title = row.title.trim() || UNTITLED_SESSION_TITLE;
	const aiTitle = useSecondaryAiTitle(title, row.session.aiTitle);
	const {settings} = useSettings();
	const blocked = row.bucket === "blocked";
	const attention = useRowAttention(row.session, selected);
	const revealTitle = useLaunchTitleReveal(row.sessionId);
	// Upstream draws no PR tail on pinned rows.
	const prTail =
		pinnedIds === undefined && settings.sessionListPrefs.showPrStatus && row.session.prStatus !== undefined
			? prGlyph(row.session.prStatus).state
			: undefined;
	const {prStatus, pr} = row.session;
	const entries = useMemo(
		() => (prTail === undefined ? NO_PR_ENTRIES : prEntries(prStatus, pr)),
		[prTail, prStatus, pr],
	);
	const metaLine = useRowMetaLine(row, pinnedIds === undefined && place.metadata, place);
	const labelId = useId();
	const descriptionId = `${labelId}-description`;
	const lineageId = `${labelId}-lineage`;
	const rowClass = metaLine === undefined ? ROW_CLASS : DESCRIBED_ROW_CLASS;
	const rowTitleLabel = (
		<SessionRowTitle
			render={(title) => (
				<FadeLabel text={title} attention={attention} reveal={revealTitle}>
					{/* Upstream's o_: archived rows get a sr-only " Archived" right after the title, no pill */}
					{row.archived && <span className="sr-only"> Archived</span>}
					<SidebarRowSrText session={row.session} paneSelected={selected} title={title} />
				</FadeLabel>
			)}
		/>
	);
	const titleLine = (
		<>
			{/* Upstream starts the title 10px into the row; the trailing span below keeps it clear of the 24px slot */}
			{nameSuffix === undefined ? (
				<span id={labelId} data-row-label className="min-w-0 flex-1 ps-2">
					{rowTitleLabel}
				</span>
			) : (
				// Upstream `Xx` with a nameSuffix: the title truncates in its own span, the suffix follows it.
				<span data-row-label className="flex min-w-0 flex-1 items-center ps-2">
					<span id={labelId} className="min-w-0">
						{rowTitleLabel}
					</span>
					<span className="flex shrink-0 items-center ps-1">{nameSuffix}</span>
				</span>
			)}
			{/* Upstream's title tail: reserves the trailing slot and holds the PR glyph left of it */}
			<span className="shrink-0 flex items-center gap-1.5 text-xs text-muted-as-secondary me-[calc(var(--sb-row-ctl-inset)+var(--sb-row-ctl)-var(--sb-row-px))]">
				{prTail !== undefined && <PrTailGlyph state={prTail} entries={entries} />}
			</span>
		</>
	);
	return (
		<SessionHoverCard
			sessionId={row.sessionId}
			title={title}
			aiTitle={aiTitle}
			summary={row.session.summary ?? null}
			blocked={blocked}
			render={<div />}
		>
			<SessionActionsMenu
				session={row.session}
				kebabTabIndex={-1}
				touchMenu={selected}
				described={metaLine !== undefined}
				familyHead={familyHead}
				{...(entries.length === 0
					? {}
					:
						{
							// Upstream `bV`: the kebab covers the PR tail on hover or focus, so keyboard users reach the
							// same card from it. Arrows-only, so Tab skips it.
							wrapKebab: (kebab: ReactElement) => (
								<PrListCard entries={entries} keyboardOnly>
									<span className="flex items-center" data-arrows-only="">
										{kebab}
									</span>
								</PrListCard>
							),
						})}
				// Upstream's row shell owns the background. The selected tint keys off the link's data-selected
				// (which nav-scroll and roving focus watch), so switching rows mutates no extra attribute.
				className={ROW_SHELL_CLASS}
				{...(pinnedIds === undefined
					? {}
					:
						{
							pinnedIds,
						})}
			>
				<Link
					to="/session/$id"
					params={
					{
						id: row.sessionId,
					}}
					{...ROVING_ITEM_PROPS}
					data-row-main-button
					aria-describedby={blocked ? awaitingHintId : undefined}
					// Upstream names a described row by its title and description; the sr-only lineage note stays in it.
					// A row with a name suffix is named by its title alone, so the caret's label stays out of it.
					aria-labelledby={
						metaLine === undefined
							? nameSuffix === undefined
								? undefined
								: labelId
							: [labelId, descriptionId, ...(lineage === undefined ? [] : [lineageId])].join(" ")
					}
					data-selected={selected ? "focused" : undefined}
					data-multi-selected={multiSelected ? "" : undefined}
					onPointerDown={(event) =>
					{
						startSessionSwitchJourney(event.nativeEvent, row.sessionId, queryClient);
					}}
					onClick={(event) =>
					{
						if (selection?.onRowClick(row.sessionId, event) === true) event.preventDefault();
					}}
					className={`${rowClass} text-secondary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--upstream-fill-accent),0_0_6px_0_color-mix(in_srgb,var(--upstream-fill-accent)_20%,transparent)] data-[selected=focused]:text-primary data-[multi-selected]:not-data-[selected=focused]:bg-[var(--sb-session-selected)] data-[multi-selected]:text-primary`}
				>
					{metaLine === undefined ? (
						titleLine
					) : (
						<>
							<span className="df-described-title flex min-w-0 items-center gap-[var(--sb-row-gap)]">
								{titleLine}
							</span>
							<span
								id={descriptionId}
								className="df-row-description flex min-w-0 items-center text-ink-muted ps-2"
							>
								<MetaLine line={metaLine} />
							</span>
						</>
					)}
					{lineage !== undefined && (
						<span id={lineageId} data-family-lineage className="sr-only">
							{lineage}
						</span>
					)}
				</Link>
				{/* Upstream's aria-hidden status mark sits beside the link; its sr text is inside the title */}
				<SidebarRowDecoration session={row.session} envGlyph={envGlyph} paneSelected={selected} />
			</SessionActionsMenu>
		</SessionHoverCard>
	);
}

/** The row shell's background recipe, shared by session rows and the pending launch row. */
const ROW_SHELL_CLASS =
	"rounded-[var(--sb-radius)] hover:bg-[var(--sb-hover)] has-[:focus-visible]:bg-[var(--sb-hover)] data-[menu-open=true]:bg-[var(--sb-hover)] data-[context-menu-open=true]:bg-[var(--sb-hover)] has-[[data-row-main-button][data-selected=focused]]:bg-[var(--sb-session-selected)] hover:has-[[data-row-main-button][data-selected=focused]]:bg-[var(--selected-hover,var(--sb-session-selected))]";

const ROW_MAIN_CLASS = `${ROW_CLASS} text-secondary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--upstream-fill-accent),0_0_6px_0_color-mix(in_srgb,var(--upstream-fill-accent)_20%,transparent)] data-[selected=focused]:text-primary data-[multi-selected]:not-data-[selected=focused]:bg-[var(--sb-session-selected)] data-[multi-selected]:text-primary`;

/**
 * Upstream's optimistic spawn row (`EY` while `rowKey in A_.pending`): a launch this tab started, drawn in Working
 * before its session has a row. The title is the `RM` skeleton with its sr "Loading", beside the persistent " Running"
 * status and the running mark. It has no menu or hover card, and links to the session only once herdr names it.
 */
function PendingLaunchRow({
	row,
	launch,
	envGlyph,
}: {
	row: SidebarSessionRow;
	launch: PendingLaunchEntry;
	envGlyph: boolean;
})
{
	const selected = launch.opens;
	const titleLine = (
		<>
			<span data-row-label className="min-w-0 flex-1 ps-2">
				<FadeLabel text="" skeleton>
					<SidebarRowSrText session={row.session} paneSelected={selected} />
				</FadeLabel>
			</span>
			<span className="shrink-0 flex items-center gap-1.5 text-xs text-muted-as-secondary me-[calc(var(--sb-row-ctl-inset)+var(--sb-row-ctl)-var(--sb-row-px))]" />
		</>
	);
	return (
		<div data-row="" data-session-actions="" className={`group/session-row relative ${ROW_SHELL_CLASS}`}>
			{launch.sessionId === null ? (
				<span data-row-main-button data-selected={selected ? "focused" : undefined} className={ROW_MAIN_CLASS}>
					{titleLine}
				</span>
			) : (
				<Link
					to="/session/$id"
					params={
					{
						id: launch.sessionId,
					}}
					{...ROVING_ITEM_PROPS}
					data-row-main-button
					data-selected={selected ? "focused" : undefined}
					className={ROW_MAIN_CLASS}
				>
					{titleLine}
				</Link>
			)}
			<SidebarRowDecoration session={row.session} envGlyph={envGlyph} paneSelected={selected} />
		</div>
	);
}

/**
 * Marks itself `data-overflowing` when the title is clipped, so CSS fades its end. A session row
 * passes upstream's `data-attention` look for its title's `span.relative`.
 */
export function FadeLabel({
	text,
	attention,
	reveal = false,
	skeleton = false,
	children,
}: {
	text: string;
	attention?: RowAttention | undefined;
	/** Draw the title through upstream's grapheme reveal (`CR`), first text included: a just-launched row's title. */
	reveal?: boolean;
	/** The title is still unknown: upstream's `RM` skeleton stands in for the text. */
	skeleton?: boolean;
	children?: ReactNode;
})
{
	const ref = useRef<HTMLSpanElement>(null);
	const textRef = useRef<HTMLSpanElement>(null);
	const [overflowing, setOverflowing] = useState(false);
	// Upstream `a_`: a hover-capable device makes the label a tooltip trigger, disabled while the row's card is live.
	const touch = useMediaQuery(TOUCH_QUERY);
	const cardLive = useContext(RowHoverCardContext);
	const triggerMark = touch
		? undefined
		: cardLive
			?
				{
					"data-trigger-disabled": "",
				}
			:
				{
					"data-base-ui-tooltip-trigger": "",
				};

	useLayoutEffect(() =>
	{
		const element = ref.current;
		const textElement = textRef.current;
		if (element === null || textElement === null) return undefined;
		const isOverflowing = () => element.scrollWidth > element.clientWidth;
		// Every local label keeps its trailing slot outside the box: upstream's `cleared` case, a 24px band.
		const unregister = registerTruncatingLabel(
			{
				box: element,
				text: textElement,
				endBandPx: () => (isOverflowing() ? LABEL_SHIFT_FADE_PX : 0),
			},
		);
		const measure = () =>
		{
			setOverflowing(isOverflowing());
			recomputeLabelShift(textElement);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return unregister;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () =>
		{
			observer.disconnect();
			unregister();
		};
	}, [text]);

	return (
		<span
			ref={ref}
			dir="auto"
			className="dframe-fade-label"
			{...triggerMark}
			data-overflowing={overflowing ? "" : undefined}
		>
			<span ref={textRef} className="inline-block whitespace-nowrap align-top">
				<span className="relative" data-attention={attention}>
					{skeleton ? <SessionTitleSkeleton /> : reveal ? <RevealText text={text} /> : <span>{text}</span>}
					{children}
				</span>
			</span>
		</span>
	);
}

/** Where a row sits: its section heading, and whether that heading names a status. */
interface RowPlace
{
	heading: string;
	/** The section is a state grouping's, so its heading already says the row's status. */
	underStatusHeading: boolean;
	/** Show ▸ Metadata for this row's section. */
	metadata: boolean;
}

/** A row's described second line (Show ▸ Metadata), or undefined for a one-line row. */
function useRowMetaLine(row: SidebarSessionRow, enabled: boolean, place: RowPlace): SessionMetaLine | undefined
{
	const status = metaStatus(row.session);
	const blocked = status === "blocked";
	const {data: toolName} = useQuery(
		{
			...approvalsQueryOptions(),
			enabled: enabled && blocked,
			select: (data) => data.approvals.find((approval) => approval.sessionId === row.sessionId)?.toolName,
		},
	);
	if (!enabled) return undefined;
	return sessionMetaLine(
		{
			status,
			underStatusHeading: place.underStatusHeading,
			reason: blocked ? blockedReason(toolName, row.session.awaitingPermission === true) : undefined,
			message: sessionMetaMessage(row.session, status),
			place:
			{
				text: row.session.projectName,
				spoken: true,
			},
			heading: place.heading,
		},
	);
}

/** Why a blocked row waits, only when a pending approval or permission prompt says so (upstream `p9`). */
function blockedReason(toolName: string | undefined, awaitingPermission: boolean): string | undefined
{
	if (toolName !== undefined) return blockedDetail(toolName);
	return awaitingPermission ? "Needs permission" : undefined;
}
