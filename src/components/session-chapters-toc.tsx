import {memo, useCallback, useEffect, useId, useRef, useState, type RefObject} from "react";

import {useActiveChapter} from "../hooks/use-active-chapter";
import {removeUserChapter, renameChapter, setChapterHidden} from "../lib/chapter-store";
import {hasOutline, type SessionChapter} from "../lib/session-chapters";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem, MenuSeparator} from "./ui/menu";
import {Tooltip, TooltipGroup} from "./ui/tooltip";

// Upstream claude.ai/code's session outline (cf74bc599 `PO`/`FO`/`IO`), class for class, but for two local
// conventions: `rounded-r4` is the token for upstream's 5px row radius, and the rail dash's scale transition is gated
// with `motion-reduce:transition-none`, which upstream leaves ungated.
const ROOT_CLASS =
	"epitaxy-toc absolute top-[20px] bottom-[32px] -start-[var(--session-rail-band-start,0px)] z-[11] pointer-events-none [.epitaxy-chat-panel[data-chat-gutter-end=bleed]:not([data-chat-gutter-start])_&]:[--chat-gutter:var(--chat-gutter-end,clamp(16px,(100cqw_-_var(--chat-column-measure,var(--transcript-measure))_-_16px)_*_0.4_+_16px,32px))]";
const NAV_CLASS =
	"relative h-full w-[var(--chat-gutter)] [.epitaxy-chat-panel_&]:[@container_tile-slot_(max-width:560px)]:[--chat-gutter:16px] focus-visible:outline-hidden focus-visible:shadow-focus";
const RAIL_CLASS =
	"max-h-full flex flex-col py-1.25 ps-[calc(var(--chat-gutter)*3/16)] overflow-hidden pointer-events-auto";
const RAIL_DASH_CLASS =
	"block h-[2px] rounded-full transition-[scale,background-color] motion-reduce:transition-none duration-200 w-[calc(var(--chat-gutter)*3/8+2px)] origin-left [&:where(:root[dir=rtl]_:dir(rtl))]:origin-right";
const POPOVER_CLASS =
	"absolute start-0 top-0 isolate rounded-card bg-surface-3 shadow-panel forced-colors:border forced-colors:border-solid forced-colors:border-[color:CanvasText] rounded-lg w-max min-w-[232px] max-w-[320px] max-h-full flex flex-col py-sm transition-[opacity,transform,visibility] motion-reduce:transition-none duration-150 ease-out";
const ROW_BUTTON_CLASS =
	"group/ch hit-row-main w-full flex items-center gap-sm px-1.25 h-list-row rounded-r4 text-start text-body hover:bg-fill-ghost-hover";
const ROW_DASH_CLASS = "block h-[2px] rounded-full shrink-0 transition-[background-color] duration-150";

/** Whether a row's title is clipped, the only case its full-title tooltip opens (upstream's OverflowTooltip). */
function titleOverflows(anchor: HTMLElement): boolean {
	const title = anchor.querySelector("[data-chapter-title]");
	return title !== null && title.scrollWidth > title.clientWidth;
}

interface SessionChaptersTocProps {
	sessionId: string;
	/** The outline's rows (`buildSessionChapters`); memoized by the caller, since the scroll tracker re-reads on a new list. */
	chapters: readonly SessionChapter[];
	/** The transcript scroller the active chapter is read from. */
	scrollRef: RefObject<HTMLElement | null>;
	scrollKey: string;
	onJump: (chapter: SessionChapter) => void;
}

/**
 * The session outline in the chat column's start gutter: a rail of dashes, one per chapter, that
 * opens a "Session chapters" list on hover or focus. Renders nothing until the session has a
 * chapter besides its start.
 */
export const SessionChaptersToc = memo(function SessionChaptersToc({
	sessionId,
	chapters,
	scrollRef,
	scrollKey,
	onJump,
}: SessionChaptersTocProps) {
	const [expanded, setExpanded] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const editingRef = useRef(false);
	const menuOpenRef = useRef(false);
	const navRef = useRef<HTMLElement>(null);
	const active = useActiveChapter({chapters, scrollRef, scrollKey});

	const startRename = useCallback((id: string | null) => {
		editingRef.current = id !== null;
		setEditingId(id);
	}, []);
	const expand = useCallback(() => {
		setExpanded(true);
	}, []);
	// An open row menu or a rename in progress holds the list open.
	const collapse = useCallback(() => {
		if (menuOpenRef.current || editingRef.current) return;
		setExpanded(false);
		startRename(null);
	}, [startRename]);
	const onContextMenuOpenChange = useCallback(
		(open: boolean) => {
			menuOpenRef.current = open;
			if (open) return;
			requestAnimationFrame(() => {
				if (navRef.current !== null && !navRef.current.matches(":hover")) collapse();
			});
		},
		[collapse],
	);

	if (!hasOutline(chapters)) return null;

	return (
		<div className={`${ROOT_CLASS} ${active === null ? "invisible" : "epitaxy-toc-fade-in"}`}>
			{/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- upstream's outline opens and closes with the pointer and focus entering and leaving the nav */}
			<nav
				ref={navRef}
				aria-label="Session chapters"
				// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's outline opens when Tab reaches the nav itself, ahead of its row buttons
				tabIndex={0}
				onMouseLeave={collapse}
				onFocus={expand}
				onBlur={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget)) collapse();
				}}
				className={NAV_CLASS}
			>
				<ol aria-hidden data-dash-rail="" onMouseEnter={expand} className={RAIL_CLASS}>
					{chapters.map((chapter) => (
						<li key={chapter.id} className="h-[8px] flex items-center">
							<span
								className={`${RAIL_DASH_CLASS} ${chapter.id === active ? "bg-alpha-8" : "scale-x-[calc(9/14)] bg-alpha-3"}`}
							/>
						</li>
					))}
				</ol>
				<div
					data-surface="popover"
					className={`${POPOVER_CLASS} ${
						expanded
							? "visible opacity-100 pointer-events-auto"
							: "invisible opacity-0 -translate-x-1 [&:where(:root[dir=rtl]_:dir(rtl))]:translate-x-1"
					}`}
				>
					{/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- upstream restates the list role, which Safari drops from a list-style:none list */}
					<ol role="list" className="flex-1 min-h-0 flex flex-col hit-gap-y-0.75 overflow-y-auto px-xs">
						<TooltipGroup closeDelay={0}>
							{chapters.map((chapter) => (
								<ChapterRow
									key={chapter.id}
									chapter={chapter}
									sessionId={sessionId}
									isActive={chapter.id === active}
									isEditing={chapter.id === editingId}
									isListExpanded={expanded}
									onJump={onJump}
									onStartRename={startRename}
									onContextMenuOpenChange={onContextMenuOpenChange}
								/>
							))}
						</TooltipGroup>
					</ol>
				</div>
			</nav>
		</div>
	);
});

interface ChapterRowProps {
	chapter: SessionChapter;
	sessionId: string;
	isActive: boolean;
	isEditing: boolean;
	isListExpanded: boolean;
	onJump: (chapter: SessionChapter) => void;
	onStartRename: (id: string | null) => void;
	onContextMenuOpenChange: (open: boolean) => void;
}

const ChapterRow = memo(function ChapterRow({
	chapter,
	sessionId,
	isActive,
	isEditing,
	isListExpanded,
	onJump,
	onStartRename,
	onContextMenuOpenChange,
}: ChapterRowProps) {
	const summaryId = useId();
	// Rename mounts the input while the menu is still closing, so the menu must not hand focus back to its row.
	const renamePicked = useRef(false);

	if (isEditing) {
		return (
			<li className="flex items-center gap-sm px-1.25 h-list-row rounded-r4">
				<span aria-hidden className="block h-[2px] w-[10px] rounded-full bg-alpha-8 shrink-0" />
				<ChapterRowInput
					title={chapter.title}
					onDone={(next) => {
						if (next !== undefined) renameChapter(sessionId, chapter.id, next);
						onStartRename(null);
					}}
				/>
			</li>
		);
	}

	const isSessionStart = chapter.source === "session";
	const button = (
		<button
			type="button"
			onClick={() => {
				onJump(chapter);
			}}
			onDoubleClick={
				isSessionStart
					? undefined
					: () => {
							onStartRename(chapter.id);
						}
			}
			aria-current={isActive ? "true" : undefined}
			className={`${ROW_BUTTON_CLASS} ${isActive ? "text-primary" : "text-secondary hover:text-primary"}`}
		>
			<span
				aria-hidden
				className={`${ROW_DASH_CLASS} ${isActive ? "w-[14px] bg-alpha-8" : "w-[9px] bg-alpha-3 group-hover/ch:bg-alpha-5"}`}
			/>
			<Tooltip portal content={chapter.title} side="right" openWhen={titleOverflows} className="min-w-0 flex-1">
				<span data-chapter-title="" className="block truncate">
					{chapter.title}
				</span>
			</Tooltip>
			{chapter.summary !== undefined && (
				<span id={summaryId} hidden>
					{chapter.summary}
				</span>
			)}
		</button>
	);
	const describedBy = chapter.summary === undefined ? undefined : summaryId;
	/** Upstream's summary tooltip: the summary as the tip's detail, under the title while the list is open. */
	const withSummary = (row: React.ReactElement<{"aria-describedby"?: string}>) =>
		chapter.summary === undefined ? (
			row
		) : (
			<Tooltip
				portal
				side="right"
				content={isListExpanded ? chapter.title : null}
				detail={chapter.summary}
				className="flex w-full"
			>
				{row}
			</Tooltip>
		);

	if (isSessionStart) return <li className="hit-row">{withSummary(button)}</li>;

	return (
		<li className="hit-row">
			<ContextMenu
				onOpenChange={(open) => {
					if (open) renamePicked.current = false;
					onContextMenuOpenChange(open);
				}}
			>
				{withSummary(<ContextMenuTrigger render={button} aria-describedby={describedBy} />)}
				<MenuContent finalFocus={() => !renamePicked.current}>
					<MenuItem
						onSelect={() => {
							renamePicked.current = true;
							onStartRename(chapter.id);
						}}
					>
						Rename
					</MenuItem>
					<MenuSeparator />
					<MenuItem
						variant="danger"
						onSelect={() => {
							if (chapter.source === "user") removeUserChapter(sessionId, chapter.id);
							else setChapterHidden(sessionId, chapter.id, true);
						}}
					>
						Delete
					</MenuItem>
				</MenuContent>
			</ContextMenu>
		</li>
	);
});

/** The row's rename input: Enter or blur commits a trimmed, non-empty, changed title; Escape cancels. */
function ChapterRowInput({title, onDone}: {title: string; onDone: (next: string | undefined) => void}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const doneRef = useRef(false);

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	const finish = (commit: boolean) => {
		if (doneRef.current) return;
		doneRef.current = true;
		const next = inputRef.current?.value.trim() ?? "";
		onDone(commit && next !== "" && next !== title ? next : undefined);
	};

	return (
		<input
			ref={inputRef}
			defaultValue={title}
			size={Math.max(title.length, 1)}
			aria-label="Chapter title"
			className="flex-1 min-w-0 [field-sizing:content] bg-transparent text-body text-primary focus-visible:outline-hidden focus-visible:shadow-focus"
			onBlur={() => {
				finish(true);
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					finish(true);
				} else if (event.key === "Escape") {
					event.preventDefault();
					// The session page binds Escape to stopping the response; a rename's Escape must not reach it.
					event.stopPropagation();
					finish(false);
				}
			}}
		/>
	);
}
