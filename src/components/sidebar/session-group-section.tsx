import {Link} from "@tanstack/react-router";
import {useQueryClient} from "@tanstack/react-query";
import {ChevronRight} from "lucide-react";
import {Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode} from "react";

import {useSecondaryAiTitle} from "../../hooks/use-secondary-ai-title";
import type {SidebarDragRowProps} from "../../hooks/use-sidebar-drag";
import {startSessionSwitchJourney} from "../../lib/perf/field-journeys";
import {prGlyph} from "../../lib/pr-status";
import type {GroupAppearance} from "../../lib/group-appearance";
import {useProjectAppearance} from "../../lib/project-appearance-store";
import {useSessionGroups} from "../../lib/session-group-store";
import {assertNever} from "../../lib/assert-never";
import {customGroupIdOfKey, isProjectGroupKey, type SessionGroup} from "../../lib/session-groups";
import {
	familyKey,
	setFamiliesCollapsed,
	toggleFamilyCollapsed,
	toggleSidebarGroup,
	useSidebarState,
} from "../../lib/sidebar-store";
import {SessionActionsMenu, SessionRowTitle} from "../session-actions-menu";
import {SessionHoverCard} from "../session-hover-card";
import {QUICK_REPLY_HINT} from "../session-hover-card-classes";
import {SidebarRowDecoration, SidebarRowSrText} from "../session-unread-control";
import {useSettings} from "../settings-context";
import {PrTailGlyph} from "../status-dot";
import {Tooltip} from "../ui/tooltip";
import {CustomGroupHeader} from "./custom-group-header";
import {GroupAppearanceMark} from "./group-appearance";
import {NewSessionHeaderButton} from "./new-session-row";
import {ProjectGroupHeader} from "./project-group-header";
import {SelectAllGroupHeader} from "./select-all-group-header";
import {useSidebarSelection} from "./selection-context";
import type {SidebarSessionRow} from "./sidebar-session-row";
import {ROVING_ITEM_PROPS} from "./use-roving-focus";

const NO_FAMILY_HEAD_IDS: readonly string[] = [];

/** The section's unarchived sessions, family members included, for Archive all. */
function archivableIds(group: SessionGroup<SidebarSessionRow>): string[] {
	const rows = group.rows.flatMap((row) => [row, ...(group.nested.get(row.sessionId) ?? [])]);
	return rows.filter((row) => !row.archived).map((row) => row.sessionId);
}

export const ROW_CLASS =
	"flex h-[var(--sb-row-h)] w-full shrink-0 items-center gap-[var(--sb-row-gap)] rounded-[var(--sb-radius)] px-[var(--sb-row-px)] text-left text-[length:var(--sb-row-font)] no-underline";

/**
 * A section header's trailing controls, as upstream lays them out: Group and sort revealed on hover
 * or keyboard focus (always on touch, and while its menu is open), then the first section's
 * always-visible New session +.
 */
function HeaderControls({filterSlot, leadsList}: {filterSlot: ReactNode; leadsList: boolean}) {
	const hasFilter = filterSlot !== undefined && filterSlot !== null;
	if (!hasFilter && !leadsList) return null;
	return (
		<div className="flex items-center">
			{hasFilter && (
				<span
					data-header-reveal=""
					className="flex w-0 overflow-hidden group-hover/labelrow:w-auto group-hover/labelrow:overflow-visible group-has-[:focus-visible]/labelrow:w-auto group-has-[:focus-visible]/labelrow:overflow-visible has-[[data-popup-open]]:w-auto has-[[data-popup-open]]:overflow-visible pointer-coarse:w-auto pointer-coarse:overflow-visible"
				>
					{filterSlot}
				</span>
			)}
			{leadsList && <NewSessionHeaderButton />}
		</div>
	);
}

/** A collapsible sidebar group: label row (caret on hover), session rows, "Show N more" / "Show less". */
export function GroupSection({
	group,
	expanded,
	activeItemId,
	filterSlot,
	leadsList = false,
	onShowMore,
	onShowLess,
	dragRowProps,
	pinnedIds,
	familyHeadIds = NO_FAMILY_HEAD_IDS,
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
	/** The list's first section, whose header also carries New session. */
	leadsList?: boolean;
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
	// Upstream omits the env glyph on pinned rows and when the section is itself a place.
	const envGlyph = pinnedIds === undefined && !isProject;
	const toggle = (
		<button
			type="button"
			{...ROVING_ITEM_PROPS}
			data-group-toggle
			aria-expanded={expanded}
			onClick={() => {
				toggleSidebarGroup(group.key);
			}}
			className="group/label -my-1 -ml-1 flex min-w-0 flex-1 items-center gap-1 rounded-[var(--sb-radius)] py-1 pl-1 text-left hover:text-secondary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),0_0_6px_0_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)]"
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
			className="group/section relative isolate flex flex-col pb-[var(--sb-group-pb)]"
		>
			<div
				{...headerDragProps}
				ref={headerRef}
				data-sidebar-group-label
				data-drop-hot={dropHot ? "" : undefined}
				className="group/labelrow df-label-inset rounded-[var(--sb-radius)] data-[drop-hot]:bg-[var(--sb-hover)] flex mt-[var(--sb-group-band-mt)] h-[var(--sb-group-band-h)] w-full items-center gap-[var(--sb-row-gap)] pt-[var(--sb-group-pt)] pr-[var(--sb-row-ctl-inset)] pb-[var(--sb-group-label-pb)] text-[length:var(--sb-group-font)] leading-4 text-ink-muted"
			>
				{customGroupId === null ? (
					isProject ? (
						<ProjectGroupHeader groupKey={group.key} label={group.label}>
							{toggle}
						</ProjectGroupHeader>
					) : (
						<SelectAllGroupHeader group={group}>{toggle}</SelectAllGroupHeader>
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
				<HeaderControls filterSlot={filterSlot} leadsList={leadsList} />
			</div>
			{expanded && (
				<div ref={rowsRef} data-group-rows className="flex flex-col gap-[var(--sb-row-stack-gap)]">
					{group.rows.map((row) => {
						const nested = group.nested.get(row.sessionId);
						return (
							<Fragment key={row.sessionId}>
								<div {...dragRowProps?.(row.sessionId)} className="df-drag-shiftable relative">
									<SessionRowLink
										row={row}
										selected={row.sessionId === activeItemId}
										pinnedIds={pinnedIds}
										envGlyph={envGlyph}
									/>
								</div>
								{nested !== undefined && (
									<SessionFamily
										head={row}
										nested={nested}
										activeItemId={activeItemId}
										familyHeadIds={familyHeadIds}
										dragRowProps={dragRowProps}
										envGlyph={envGlyph}
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

/** Which of upstream's empty sidebar lists to show: nothing yet, filtered to nothing, or a failed load. */
export type EmptyListReason =
	| {kind: "none"}
	| {kind: "filtered"; onShowAll: () => void}
	| {kind: "failed"; onRetry: () => void};

/** Upstream's empty sidebar list bodies, centered under the header. */
function EmptyListBody({reason}: {reason: EmptyListReason}) {
	switch (reason.kind) {
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
}) {
	return (
		<div data-group-key="empty" className="group/section relative isolate flex flex-col pb-[var(--sb-group-pb)]">
			<div
				data-sidebar-group-label
				className="group/labelrow df-label-inset flex mt-[var(--sb-group-band-mt)] h-[var(--sb-group-band-h)] w-full items-center gap-[var(--sb-row-gap)] pt-[var(--sb-group-pt)] pr-[var(--sb-row-ctl-inset)] pb-[var(--sb-group-label-pb)] text-[length:var(--sb-group-font)] leading-4 text-ink-muted"
			>
				<span className="min-w-0 flex-1 truncate">{label}</span>
				<HeaderControls filterSlot={filterSlot} leadsList />
			</div>
			<EmptyListBody reason={reason} />
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
			className={`${ROW_CLASS} text-ink-muted hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),0_0_6px_0_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)] hover:bg-[var(--sb-hover)] hover:text-secondary`}
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
	envGlyph,
}: {
	head: SidebarSessionRow;
	nested: readonly SidebarSessionRow[];
	activeItemId: string | null;
	familyHeadIds: readonly string[];
	dragRowProps: ((id: string) => SidebarDragRowProps) | undefined;
	envGlyph: boolean;
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
					onPointerEnter={() => {
						setHot(true);
					}}
					onPointerLeave={() => {
						setHot(false);
					}}
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
								envGlyph={envGlyph}
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
	envGlyph,
	lineage,
}: {
	row: SidebarSessionRow;
	selected: boolean;
	pinnedIds: readonly string[] | undefined;
	/** Draw the settled row's environment glyph in the trailing slot. */
	envGlyph: boolean;
	/** Screen-reader note on a nested row, e.g. "Forked from {title}". */
	lineage?: string;
}) {
	const queryClient = useQueryClient();
	const selection = useSidebarSelection();
	const multiSelected = selection?.selectedIds.includes(row.sessionId) === true;
	const title = row.title.trim() || "Untitled session";
	const aiTitle = useSecondaryAiTitle(title, row.session.aiTitle);
	const {settings} = useSettings();
	const blocked = row.bucket === "blocked";
	const hintId = useId();
	// Upstream draws no PR tail on pinned rows.
	const prTail =
		pinnedIds === undefined && settings.sessionListPrefs.showPrStatus && row.session.prStatus !== undefined
			? prGlyph(row.session.prStatus).state
			: undefined;
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
				// Upstream's row shell owns the background. The selected tint keys off the link's data-selected
				// (which nav-scroll and roving focus watch), so switching rows mutates no extra attribute.
				className="rounded-[var(--sb-radius)] hover:bg-[var(--sb-hover)] has-[:focus-visible]:bg-[var(--sb-hover)] data-[menu-open=true]:bg-[var(--sb-hover)] data-[context-menu-open=true]:bg-[var(--sb-hover)] has-[[data-row-main-button][data-selected=focused]]:bg-[var(--sb-session-selected)]"
				{...(pinnedIds === undefined ? {} : {pinnedIds})}
			>
				<Link
					to="/session/$id"
					params={{id: row.sessionId}}
					{...ROVING_ITEM_PROPS}
					data-row-main-button
					aria-describedby={blocked ? hintId : undefined}
					data-selected={selected ? "focused" : undefined}
					data-multi-selected={multiSelected ? "" : undefined}
					onPointerDown={(event) => {
						startSessionSwitchJourney(event.nativeEvent, row.sessionId, queryClient);
					}}
					onClick={(event) => {
						if (selection?.onRowClick(row.sessionId, event) === true) event.preventDefault();
					}}
					className={`${ROW_CLASS} text-secondary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),0_0_6px_0_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)] data-[selected=focused]:text-primary data-[multi-selected]:bg-[var(--sb-session-selected)] data-[multi-selected]:text-primary`}
				>
					{/* Upstream starts the title 10px into the row; the trailing span below keeps it clear of the 24px slot */}
					<span data-row-label className="min-w-0 flex-1 ps-2">
						<SessionRowTitle
							render={(title) => (
								<FadeLabel text={title}>
									{/* Upstream's o_: archived rows get a sr-only " Archived" right after the title, no pill */}
									{row.archived && <span className="sr-only"> Archived</span>}
									<SidebarRowSrText session={row.session} />
								</FadeLabel>
							)}
						/>
					</span>
					{lineage !== undefined && (
						<span data-family-lineage className="sr-only">
							{lineage}
						</span>
					)}
					{/* Upstream's title tail: reserves the trailing slot and holds the PR glyph left of it */}
					<span className="shrink-0 flex items-center gap-1.5 text-xs text-ink-muted me-[calc(var(--sb-row-ctl-inset)+var(--sb-row-ctl)-var(--sb-row-px))]">
						{prTail !== undefined && <PrTailGlyph state={prTail} />}
					</span>
				</Link>
				{blocked && (
					<span id={hintId} data-find-omitted="" className="sr-only select-none">
						{QUICK_REPLY_HINT}
					</span>
				)}
				{/* Upstream's aria-hidden status mark sits beside the link; its sr text is inside the title */}
				<SidebarRowDecoration session={row.session} envGlyph={envGlyph} />
			</SessionActionsMenu>
		</SessionHoverCard>
	);
}

/** Marks itself `data-overflowing` when the title is clipped, so CSS fades its end. */
function FadeLabel({text, children}: {text: string; children?: ReactNode}) {
	const ref = useRef<HTMLSpanElement>(null);
	const [overflowing, setOverflowing] = useState(false);

	useLayoutEffect(() => {
		const element = ref.current;
		if (element === null) return undefined;
		const measure = () => {
			setOverflowing(element.scrollWidth > element.clientWidth);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => {
			observer.disconnect();
		};
	}, [text]);

	return (
		<span ref={ref} dir="auto" className="dframe-fade-label" data-overflowing={overflowing ? "" : undefined}>
			<span className="relative inline-block align-top whitespace-nowrap">
				{text}
				{children}
			</span>
		</span>
	);
}
