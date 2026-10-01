import {Link, useNavigate} from "@tanstack/react-router";
import {ChevronRight} from "lucide-react";
import {Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode} from "react";

import type {SidebarDragRowProps} from "../../hooks/use-sidebar-drag";
import type {SessionListItem} from "../../lib/api/sessions";
import type {GroupAppearance} from "../../lib/group-appearance";
import {useProjectAppearance} from "../../lib/project-appearance-store";
import {useSessionGroups} from "../../lib/session-group-store";
import {customGroupIdOfKey, isProjectGroupKey, type SessionGroup, type SessionGroupRow} from "../../lib/session-groups";
import {
	familyKey,
	setFamiliesCollapsed,
	toggleFamilyCollapsed,
	toggleSidebarGroup,
	useSidebarState,
} from "../../lib/sidebar-store";
import {ArchivedBadge} from "../archived-badge";
import {SessionActionsMenu, SessionRowTitle} from "../session-actions-menu";
import {SessionHoverCard} from "../session-hover-card";
import {SessionRowStatusDot} from "../session-unread-control";
import {Tooltip} from "../ui/tooltip";
import {CustomGroupHeader} from "./custom-group-header";
import {GroupAppearanceMark} from "./group-appearance";
import {ProjectGroupHeader} from "./project-group-header";
import {useSidebarSelection} from "./selection-context";
import {ROVING_ITEM_PROPS} from "./use-roving-focus";

export interface SidebarSessionRow extends SessionGroupRow {
	id: string;
	session: SessionListItem;
}

export function toGroupRow(session: SessionListItem): SidebarSessionRow {
	return {
		session,
		id: session.id,
		sessionId: session.id,
		title: session.title,
		bucket: session.bucket,
		project: session.projectName,
		archived: session.archived,
		createdAt: Date.parse(session.created),
		lastActivityAt: Date.parse(session.mtime),
		forkedFromSessionId: session.forkedFromSessionId,
	};
}

/** The section's unarchived sessions, family members included, for Archive all. */
function archivableIds(group: SessionGroup<SidebarSessionRow>): string[] {
	const rows = group.rows.flatMap((row) => [row, ...(group.nested.get(row.sessionId) ?? [])]);
	return rows.filter((row) => !row.archived).map((row) => row.sessionId);
}

export const ROW_CLASS =
	"flex h-[var(--sb-row-h)] w-full shrink-0 items-center gap-[var(--sb-row-gap)] rounded-[var(--sb-radius)] px-[var(--sb-row-px)] text-left text-[length:var(--sb-row-font)] no-underline";

/** A collapsible sidebar group: label row (caret on hover), session rows, "Show N more" / "Show less". */
export function GroupSection({
	group,
	expanded,
	activeItemId,
	filterSlot,
	onShowMore,
	onShowLess,
	dragRowProps,
	pinnedIds,
	familyHeadIds = [],
	headerDragProps,
	headerRef,
	rowsRef,
	sectionRef,
	dropHot = false,
}: {
	group: SessionGroup<SidebarSessionRow>;
	expanded: boolean;
	activeItemId: string | null;
	filterSlot: ReactNode;
	onShowMore: () => void;
	onShowLess: () => void;
	/** Makes each row a sidebar drag source (pin, reorder, unpin). */
	dragRowProps?: (id: string) => SidebarDragRowProps;
	/** Set for the Pinned section: its display order, which enables Move up / Move down. */
	pinnedIds?: readonly string[];
	/** Every family head in the list, for the Alt-click that hides or shows all nested sessions. */
	familyHeadIds?: readonly string[];
	/** Makes the label row a drag source (a custom group header reorders sections). */
	headerDragProps?: SidebarDragRowProps;
	/** Registers the label row as a drop zone. */
	headerRef?: (element: HTMLElement | null) => void;
	/** Registers the rows as a drag list whose slots are drop positions. */
	rowsRef?: (element: HTMLElement | null) => void;
	/** Registers the whole section as a drop zone. */
	sectionRef?: (element: HTMLElement | null) => void;
	/** A dragged row or header is over this section's header or rows. */
	dropHot?: boolean;
}) {
	const customGroupId = customGroupIdOfKey(group.key);
	const isProject = isProjectGroupKey(group.key);
	const appearance = useSectionAppearance(group.key, customGroupId, isProject);
	const toggle = (
		<button
			type="button"
			{...ROVING_ITEM_PROPS}
			data-group-toggle
			aria-expanded={expanded}
			onClick={() => toggleSidebarGroup(group.key)}
			className="group/label -my-1 -ml-1 flex min-w-0 flex-1 items-center gap-1 rounded-[var(--sb-radius)] py-1 pl-1 text-left hover:text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
		>
			<GroupAppearanceMark appearance={appearance} />
			<span data-group-name className="min-w-0 truncate">
				{group.label}
			</span>
			<ChevronRight
				aria-hidden="true"
				data-group-caret
				className={`h-3 w-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${
					expanded
						? "rotate-90 opacity-0 group-hover/section:opacity-100 group-focus-visible/label:opacity-100"
						: "opacity-100"
				}`}
			/>
		</button>
	);
	return (
		<div
			ref={sectionRef}
			data-group-key={group.key}
			className="group/section relative isolate flex flex-col gap-px"
		>
			<div
				{...headerDragProps}
				ref={headerRef}
				data-sidebar-group-label
				data-drop-hot={dropHot ? "" : undefined}
				className="group/labelrow df-label-inset rounded-[var(--sb-radius)] data-[drop-hot]:bg-[var(--sb-hover)] flex min-h-[calc(var(--sb-group-pt)+var(--sb-row-h)-4px)] w-full items-center gap-[var(--sb-row-gap)] pt-[var(--sb-group-pt)] pr-[calc((var(--sb-row-h)-24px)/2)] pb-1 text-[length:var(--sb-group-font)] leading-4 text-ink-muted"
			>
				{customGroupId === null ? (
					isProject ? (
						<ProjectGroupHeader groupKey={group.key} label={group.label}>
							{toggle}
						</ProjectGroupHeader>
					) : (
						toggle
					)
				) : (
					<CustomGroupHeader
						groupId={customGroupId}
						groupKey={group.key}
						label={group.label}
						archivableIds={archivableIds(group)}
					>
						{toggle}
					</CustomGroupHeader>
				)}
				{filterSlot}
			</div>
			{expanded && (
				<div ref={rowsRef} data-group-rows className="flex flex-col gap-px">
					{group.rows.map((row) => {
						const nested = group.nested.get(row.sessionId);
						return (
							<Fragment key={row.sessionId}>
								<div {...dragRowProps?.(row.sessionId)} className="df-drag-shiftable relative">
									<SessionRowLink
										row={row}
										selected={row.sessionId === activeItemId}
										pinnedIds={pinnedIds}
									/>
								</div>
								{nested !== undefined && (
									<SessionFamily
										head={row}
										nested={nested}
										activeItemId={activeItemId}
										familyHeadIds={familyHeadIds}
										dragRowProps={dragRowProps}
									/>
								)}
							</Fragment>
						);
					})}
					{group.hiddenCount > 0 && (
						<OverflowRow
							ariaLabel={`Show ${group.hiddenCount} more in ${group.label}`}
							onClick={onShowMore}
						>
							Show {group.hiddenCount} more
						</OverflowRow>
					)}
					{group.canShowLess && (
						<OverflowRow ariaLabel={`Show less in ${group.label}`} onClick={onShowLess}>
							Show less
						</OverflowRow>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * Stands in for the group list when no group renders (say, Status Archived with nothing
 * archived): a header row carrying the Filter slot over a muted "No sessions" row, so a
 * filter can never hide its own control.
 */
export function EmptyGroupSection({label, filterSlot}: {label: string; filterSlot: ReactNode}) {
	return (
		<div data-group-key="empty" className="group/section relative isolate flex flex-col gap-px">
			<div
				data-sidebar-group-label
				className="df-label-inset flex min-h-[calc(var(--sb-group-pt)+var(--sb-row-h)-4px)] w-full items-center gap-[var(--sb-row-gap)] pt-[var(--sb-group-pt)] pr-[calc((var(--sb-row-h)-24px)/2)] pb-1 text-[length:var(--sb-group-font)] leading-4 text-ink-muted"
			>
				<span className="min-w-0 flex-1 truncate">{label}</span>
				{filterSlot}
			</div>
			<div data-sidebar-empty className={`${ROW_CLASS} text-ink-muted`}>
				<span className="df-leading-slot" />
				No sessions
			</div>
		</div>
	);
}

/** A group's muted "Show N more" / "Show less" row. */
function OverflowRow({ariaLabel, onClick, children}: {ariaLabel: string; onClick: () => void; children: ReactNode}) {
	return (
		<button
			type="button"
			{...ROVING_ITEM_PROPS}
			data-row
			aria-label={ariaLabel}
			onClick={onClick}
			className={`${ROW_CLASS} text-ink-muted hover:bg-[var(--sb-hover)] hover:text-secondary`}
		>
			<span className="df-leading-slot" />
			{children}
		</button>
	);
}

/** The header icon and color of a custom group or project section. */
function useSectionAppearance(
	key: string,
	customGroupId: string | null,
	isProject: boolean,
): GroupAppearance | undefined {
	const {groups} = useSessionGroups();
	const projects = useProjectAppearance();
	if (customGroupId !== null) return groups.find((entry) => entry.id === customGroupId);
	return isProject ? projects[key] : undefined;
}

/**
 * A family head's nested sessions (upstream `.df-family`): indented 20px under a tree
 * line, with an invisible handle over the line that hides them behind a stub row.
 * Alt-click on the handle hides or shows every family.
 */
function SessionFamily({
	head,
	nested,
	activeItemId,
	familyHeadIds,
	dragRowProps,
}: {
	head: SidebarSessionRow;
	nested: readonly SidebarSessionRow[];
	activeItemId: string | null;
	familyHeadIds: readonly string[];
	dragRowProps: ((id: string) => SidebarDragRowProps) | undefined;
}) {
	const {collapsedFamilies} = useSidebarState();
	const collapsed = collapsedFamilies.includes(familyKey(head.sessionId));
	const [hot, setHot] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const focusFirstChild = useRef(false);

	useEffect(() => {
		if (collapsed || !focusFirstChild.current) return;
		focusFirstChild.current = false;
		ref.current?.querySelector<HTMLElement>("[data-family-child] a[data-row-main-button]")?.focus();
	}, [collapsed]);

	const titles = new Map([head, ...nested].map((row) => [row.sessionId, row.title]));
	const label = collapsed ? "Show nested sessions" : "Hide nested sessions";

	return (
		<div
			ref={ref}
			data-family-head={head.sessionId}
			data-branch-hot={hot ? "" : undefined}
			className="df-family relative flex flex-col gap-px"
		>
			<Tooltip content={label} side="right" className="df-family-handle-slot">
				<button
					type="button"
					tabIndex={-1}
					aria-expanded={!collapsed}
					aria-label={label}
					onPointerEnter={() => setHot(true)}
					onPointerLeave={() => setHot(false)}
					onClick={(event) => {
						if (event.altKey) setFamiliesCollapsed(familyHeadIds, !collapsed);
						else toggleFamilyCollapsed(head.sessionId);
					}}
					className="df-family-handle h-full w-full cursor-pointer rounded-r5"
				/>
			</Tooltip>
			{collapsed ? (
				<div className="pl-5">
					<FamilyStub
						nested={nested}
						onExpand={() => {
							focusFirstChild.current = true;
							toggleFamilyCollapsed(head.sessionId);
						}}
					/>
				</div>
			) : (
				nested.map((child) => {
					const parentTitle =
						child.forkedFromSessionId === undefined ? undefined : titles.get(child.forkedFromSessionId);
					return (
						<div
							key={child.sessionId}
							data-family-child
							{...dragRowProps?.(child.sessionId)}
							className="df-drag-shiftable relative pl-5"
						>
							<SessionRowLink
								row={child}
								selected={child.sessionId === activeItemId}
								pinnedIds={undefined}
								lineage={parentTitle === undefined ? "Nested session" : `Forked from ${parentTitle}`}
							/>
						</div>
					);
				})
			)}
		</div>
	);
}

function nestedSessions(count: number): string {
	return `${count} nested session${count === 1 ? "" : "s"}`;
}

/** A collapsed family's "{n} nested sessions · ● {unread} · {working}" row. */
function FamilyStub({nested, onExpand}: {nested: readonly SidebarSessionRow[]; onExpand: () => void}) {
	const unread = nested.filter((row) => row.session.unseen).length;
	const working = nested.filter((row) => row.bucket === "working").length;
	const blocked = nested.filter((row) => row.bucket === "blocked").length;
	const ariaLabel =
		blocked > 0
			? `${nestedSessions(blocked)} ${blocked === 1 ? "needs" : "need"} input`
			: [
					nestedSessions(nested.length),
					...(unread > 0 ? [`${unread} unread`] : []),
					...(working > 0 ? [`${working} working`] : []),
				].join(", ");

	return (
		<button
			type="button"
			{...ROVING_ITEM_PROPS}
			data-row
			aria-label={ariaLabel}
			onClick={onExpand}
			className={`${ROW_CLASS} df-family-stub text-[length:var(--sb-group-font)] text-secondary hover:bg-[var(--sb-hover)] hover:text-primary`}
		>
			<span className="df-leading-slot" />
			<span className="min-w-0 truncate">
				{nestedSessions(nested.length)}
				{unread > 0 && (
					<>
						{" · "}
						<span
							aria-hidden="true"
							className="mr-1 inline-block size-1.5 rounded-full bg-[var(--status-dot-ready)] align-middle"
						/>
						{unread}
					</>
				)}
				{working > 0 && ` · ${working}`}
			</span>
		</button>
	);
}

function SessionRowLink({
	row,
	selected,
	pinnedIds,
	lineage,
}: {
	row: SidebarSessionRow;
	selected: boolean;
	pinnedIds: readonly string[] | undefined;
	/** Screen-reader note on a nested row, e.g. "Forked from {title}". */
	lineage?: string;
}) {
	const navigate = useNavigate();
	const selection = useSidebarSelection();
	const multiSelected = selection?.selectedIds.includes(row.sessionId) === true;
	return (
		<SessionHoverCard
			sessionId={row.sessionId}
			title={row.title.trim() || "Untitled session"}
			summary={row.session.summary ?? null}
			blocked={row.bucket === "blocked"}
			onOpen={(id) => void navigate({to: "/session/$id", params: {id}})}
			render={<div />}
		>
			<SessionActionsMenu
				session={row.session}
				kebabTabIndex={-1}
				{...(pinnedIds === undefined ? {} : {pinnedIds})}
			>
				<Link
					to="/session/$id"
					params={{id: row.sessionId}}
					{...ROVING_ITEM_PROPS}
					data-row-main-button
					data-selected={selected ? "focused" : undefined}
					data-multi-selected={multiSelected ? "" : undefined}
					onClick={(event) => {
						if (selection?.onRowClick(row.sessionId, event) === true) event.preventDefault();
					}}
					className={`${ROW_CLASS} text-secondary hover:bg-[var(--sb-hover)] focus-visible:bg-[var(--sb-hover)] data-[selected=focused]:bg-[var(--sb-selected)] data-[selected=focused]:text-primary data-[multi-selected]:bg-[var(--sb-selected)] data-[multi-selected]:text-primary`}
				>
					<span className="df-leading-slot text-secondary">
						<SessionRowStatusDot session={row.session} tabIndex={-1} />
					</span>
					<span data-row-label className="min-w-0 flex-1">
						<SessionRowTitle render={(title) => <FadeLabel text={title} />} />
					</span>
					{lineage !== undefined && (
						<span data-family-lineage className="sr-only">
							{lineage}
						</span>
					)}
					{row.archived && <ArchivedBadge />}
				</Link>
			</SessionActionsMenu>
		</SessionHoverCard>
	);
}

/** Marks itself `data-overflowing` when the title is clipped, so CSS fades its end. */
function FadeLabel({text}: {text: string}) {
	const ref = useRef<HTMLSpanElement>(null);
	const [overflowing, setOverflowing] = useState(false);

	useLayoutEffect(() => {
		const element = ref.current;
		if (element === null) return;
		const measure = () => setOverflowing(element.scrollWidth > element.clientWidth);
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [text]);

	return (
		<span ref={ref} className="dframe-fade-label" data-overflowing={overflowing ? "" : undefined}>
			<span className="inline-block align-top whitespace-nowrap">{text}</span>
		</span>
	);
}
