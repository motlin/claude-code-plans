import {keepPreviousData, useQuery} from "@tanstack/react-query";
import {ArrowUp, Folder} from "lucide-react";
import
{
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import {useDebouncedValue} from "../../hooks/use-debounced-value";
import {useFileColumnResize} from "../../hooks/use-file-column-resize";
import {type SessionFilesResponse, sessionFilesQueryOptions} from "../../lib/api/session-files";
import type {AttachContextHandler} from "../../lib/context-attach";
import {CONTENT_SEARCH_MESSAGES, parseContentSearchQuery} from "../../lib/files-content-search";
import {FileTypeIcon} from "../file-type-icon";
import {useFileColumnOnRight} from "./file-column-side";
import {useSettings} from "../settings-context";
import {clampFilesTreeWidth, FILES_TREE_NARROW_HIDDEN_CLASS, goUpTarget, parseTreeQuery} from "./files-tree-layout";
import {ContextMenu, ContextMenuTrigger, MenuContent} from "../ui/menu";
import {FILE_COLUMN_HANDLE_Z, FileColumnEdgeHandle} from "../ui/file-column-edge-handle";
import {FileColumnResizeShield} from "../ui/file-column-resize-shield";
import {Icon} from "../ui/icon";
import {Spinner} from "../ui/spinner";
import {ResizeHandle} from "../ui/resize-handle";
import {RESIZE_HANDLE_HALF_CLIP_CLASS} from "../ui/resize-pill";
import {Field, TextInput} from "../ui/text-input";
import {Tooltip} from "../ui/tooltip";
import
{
	type ContentMatchOpenOptions,
	type ContentSearchNav,
	type ContentSearchState,
	ContentSearchResults,
} from "./content-search-results";
import {TreeRowMenuItems} from "./file-context-menu";

/** Upstream's 24px row pitch; each row's hover box is 19px tall inside it. */
const ROW_HEIGHT = 24;
const OVERSCAN_ROWS = 8;
/** Assumed viewport height until the tree has been measured (and in jsdom, which never lays out). */
const FALLBACK_VIEWPORT_HEIGHT = 480;
const QUERY_DEBOUNCE_MS = 120;
/** Upstream `$T`: a "?" content query waits longer than path filtering. */
const CONTENT_QUERY_DEBOUNCE_MS = 250;
const PARTIAL_FOOTER = "Some entries may not be listed. Keep typing to narrow.";
const IDLE_CONTENT_SEARCH: ContentSearchState =
{
	outcome: undefined,
	searching: false,
};

type WorkspaceEntry = Extract<
	SessionFilesResponse,
	{
		kind: "listing";
	}
>["entries"][number];

function parentDir(relPath: string): string
{
	const lastSlash = relPath.lastIndexOf("/");
	return lastSlash === -1 ? "" : relPath.slice(0, lastSlash);
}

/** Whether the row's name is truncated, the only case its full-name tooltip opens. */
function nameOverflows(anchor: HTMLElement): boolean
{
	const name = anchor.querySelector("[data-tree-name]");
	return name !== null && name.scrollWidth > name.clientWidth;
}

function symlinkLabel(entry: WorkspaceEntry): string | undefined
{
	const {symlink} = entry;
	if (symlink === undefined) return undefined;
	if (symlink.broken) return `Broken link to ${symlink.target}`;
	if (symlink.outside) return `Link to ${symlink.target}, outside the working directory`;
	return `Link to ${symlink.target}`;
}

const FILES_TREE_COLUMN_CLASS = "relative flex min-h-0 shrink-0 flex-col";
/** Upstream's tree when it fills a pane too narrow for it to sit beside a file. */
const FILES_TREE_FILL_CLASS = "flex min-h-0 min-w-0 flex-1 flex-col";

/**
 * The Files pane's tree column shell: 240px wide, resizable 160–640 with a "Resize file tree" cds
 * ResizeHandle, and the width persisted across reloads. Like upstream (c9bd7af9c `Wk` over cf3dc7910), a
 * click or Enter/Space on the handle, or a drag below 80px, hides the tree; a 3px edge handle then
 * shows it again. The element stays mounted while hidden (class `hidden`), keeping its filter and scroll.
 * `fill` makes it the pane's only column (a pane under 400px with no file shown). `besideFile` adds the
 * container query that CSS-hides it beside a file under 400px; `canFit` false drops both handles.
 */
export function FilesTreeColumn({
	children,
	shown = true,
	onShownChange,
	fill = false,
	besideFile = false,
	canFit = true,
}: {
	children: ReactNode;
	shown?: boolean;
	onShownChange?: (shown: boolean) => void;
	fill?: boolean;
	besideFile?: boolean;
	canFit?: boolean;
})
{
	const {settings, setSetting} = useSettings();
	const onRight = useFileColumnOnRight();
	const {columnRef, columnStyle, resizing, handleProps, edgeHandleProps} = useFileColumnResize(
		{
			width: clampFilesTreeWidth(settings.filesTreeWidth),
			onWidthChange: (next) =>
			{
				setSetting("filesTreeWidth", next);
			},
			shown,
			onShownChange,
			side: onRight ? "inline-start" : "inline-end",
		},
	);
	const column = !fill && (shown || besideFile);
	let className = "hidden";
	if (fill) className = FILES_TREE_FILL_CLASS;
	else if (column)
	{
		const border = `${onRight ? "border-s" : "border-e"} border-border`;
		className = `${FILES_TREE_COLUMN_CLASS} ${border}${besideFile ? ` ${FILES_TREE_NARROW_HIDDEN_CLASS}` : ""}`;
	}
	return (
		<>
			<div data-files-tree ref={columnRef} className={className} style={column ? columnStyle : undefined}>
				{children}
				{column && shown && canFit && (
					<ResizeHandle
						{...handleProps}
						aria-label="Resize file tree"
						onBorder
						className={RESIZE_HANDLE_HALF_CLIP_CLASS}
						style={
						{
							zIndex: FILE_COLUMN_HANDLE_Z,
						}}
					/>
				)}
			</div>
			{edgeHandleProps && canFit && (
				<FileColumnEdgeHandle handleProps={edgeHandleProps} label="Resize file tree" />
			)}
			<FileColumnResizeShield active={resizing} />
		</>
	);
}

/** Double-click pins the tab; a single click or Enter opens a preview tab. A content match adds its line and query. */
type OpenFileOptions = ContentMatchOpenOptions;

interface FilesTreeProps
{
	sessionId: string;
	filterRef?: RefObject<HTMLInputElement | null>;
	onOpenFile?: (relPath: string, options: OpenFileOptions) => void;
	/** The active tab's path relative to the root, marked `aria-current`. */
	activeRelPath?: string | null;
	/** Pinned tabs' paths relative to the root, marked `aria-selected`. */
	pinnedRelPaths?: ReadonlySet<string>;
	/** Shown instead of the "No working directory" state when the session has no `cwd`. */
	noCwdFallback?: ReactNode;
	/** Controls the filter from outside, so the Files pane can keep it across modes. */
	query?: string;
	onQueryChange?: (query: string) => void;
	/** The listed working directory; rows get a context menu once it is known. */
	cwd?: string | undefined;
	onAttachContext?: AttachContextHandler | undefined;
	/** "Ask about this" on a content search match: puts a question in the chat input. */
	onAsk?: ((prompt: string) => void) | undefined;
}

/**
 * claude.ai/code's Files tree: a filter over a flat, virtualized listing of
 * one folder of the working directory. Clicking a folder drills in by setting
 * the filter to "folder/"; typing fuzzy-searches paths inside that folder.
 */
export function FilesTree({
	sessionId,
	filterRef,
	onOpenFile,
	activeRelPath = null,
	pinnedRelPaths,
	noCwdFallback,
	query: controlledQuery,
	onQueryChange,
	cwd,
	onAttachContext,
	onAsk,
}: FilesTreeProps): ReactNode
{
	const {settings} = useSettings();
	const [localQuery, setLocalQuery] = useState("");
	const query = controlledQuery ?? localQuery;
	const setQuery = onQueryChange ?? setLocalQuery;
	// "?" searches file contents under the working directory instead of paths.
	const contentQuery = cwd === undefined ? null : parseContentSearchQuery(query);
	const debouncedQuery = useDebouncedValue(
		query,
		contentQuery === null ? QUERY_DEBOUNCE_MS : CONTENT_QUERY_DEBOUNCE_MS,
	);
	const localInputRef = useRef<HTMLInputElement>(null);
	const inputRef = filterRef ?? localInputRef;
	const treeRef = useRef<HTMLDivElement>(null);
	const treeId = useId();
	const hintId = useId();
	const capNoteId = useId();
	const [capNoteShown, setCapNoteShown] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const [focusRequest, setFocusRequest] = useState(0);
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);
	const contentNavRef = useRef<ContentSearchNav | null>(null);
	const [contentSearch, setContentSearch] = useState<ContentSearchState>(IDLE_CONTENT_SEARCH);
	/** Upstream `ye`: what had focus before the filter, which Escape on an empty filter returns to. */
	const focusedBeforeRef = useRef<HTMLElement | null>(null);

	// A drill-in or "Go up" changes only the folder, so it skips the typing debounce.
	const requested = parseTreeQuery(parseTreeQuery(query).search === "" ? query : debouncedQuery);
	const displayedDir = parseTreeQuery(query).dir;
	const filesQuery = useQuery(
		{
			...sessionFilesQueryOptions(
				sessionId,
				{
					dir: requested.dir,
					query: requested.search,
					hideIgnored: settings.filesHideIgnored,
				},
			),
			placeholderData: keepPreviousData,
			enabled: contentQuery === null,
		},
	);
	const data = filesQuery.data;
	const entries: readonly WorkspaceEntry[] =
		data === undefined || data.kind === "no-cwd" ? [] : data.kind === "listing" ? data.entries : data.results;

	useEffect(() =>
	{
		const tree = treeRef.current;
		if (tree === null || typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver(() =>
		{
			if (tree.clientHeight > 0) setViewportHeight(tree.clientHeight);
		});
		observer.observe(tree);
		return () =>
		{
			observer.disconnect();
		};
	}, []);

	useEffect(() =>
	{
		setActiveIndex(-1);
		setScrollTop(0);
		if (treeRef.current !== null) treeRef.current.scrollTop = 0;
	}, [data]);

	useLayoutEffect(() =>
	{
		if (focusRequest === 0 || activeIndex < 0) return;
		const tree = treeRef.current;
		if (tree === null) return;
		const rowTop = activeIndex * ROW_HEIGHT;
		if (rowTop < tree.scrollTop) tree.scrollTop = rowTop;
		else if (rowTop + ROW_HEIGHT > tree.scrollTop + viewportHeight)
		{
			tree.scrollTop = rowTop + ROW_HEIGHT - viewportHeight;
		}
		setScrollTop(tree.scrollTop);
		tree.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`)?.focus();
	}, [activeIndex, focusRequest, viewportHeight]);

	function focusRow(index: number): void
	{
		setActiveIndex(index);
		setFocusRequest((request) => request + 1);
	}

	function changeQuery(next: string): void
	{
		setQuery(next);
		setActiveIndex(-1);
	}

	function activate(entry: WorkspaceEntry, options: OpenFileOptions): void
	{
		if (entry.isDirectory)
		{
			changeQuery(`${entry.relPath}/`);
			return;
		}
		onOpenFile?.(entry.relPath, options);
	}

	function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void
	{
		if (event.key === "ArrowDown" && contentQuery !== null)
		{
			if (contentNavRef.current?.focusFirst() === true) event.preventDefault();
		}
		else if (event.key === "Enter" && !event.repeat && contentQuery !== null && contentQuery !== "")
		{
			event.preventDefault();
			contentNavRef.current?.focusFirstWhenSettled();
		}
		else if (event.key === "ArrowDown" && entries.length > 0)
		{
			event.preventDefault();
			focusRow(0);
		}
		else if (event.key === "Escape" && query !== "")
		{
			event.preventDefault();
			event.stopPropagation();
			changeQuery("");
		}
		else if (event.key === "Escape")
		{
			focusedBeforeRef.current?.focus(
				{
					preventScroll: true,
				},
			);
		}
	}

	function handleTreeKeyDown(event: KeyboardEvent<HTMLDivElement>): void
	{
		if (entries.length === 0) return;
		const index = activeIndex;
		if (event.key === "ArrowDown")
		{
			event.preventDefault();
			focusRow(Math.min(entries.length - 1, index + 1));
		}
		else if (event.key === "ArrowUp")
		{
			event.preventDefault();
			if (index <= 0)
			{
				setActiveIndex(-1);
				inputRef.current?.focus();
			}
			else
			{
				focusRow(index - 1);
			}
		}
		else if (event.key === "Home")
		{
			event.preventDefault();
			focusRow(0);
		}
		else if (event.key === "End")
		{
			event.preventDefault();
			focusRow(entries.length - 1);
		}
		else if (event.key === "Enter")
		{
			const entry = entries[index];
			if (entry === undefined) return;
			event.preventDefault();
			activate(
				entry,
				{
					pin: false,
				},
			);
			if (entry.isDirectory) inputRef.current?.focus();
		}
	}

	if (data?.kind === "no-cwd")
	{
		return (
			noCwdFallback ?? (
				<p className="px-3 py-6 text-center text-footnote text-ink-muted">
					No working directory for this session
				</p>
			)
		);
	}

	const isSearch = data?.kind === "search";
	const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
	const lastRow = Math.min(entries.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS);
	const goUp = displayedDir === "" ? null : goUpTarget(displayedDir);

	let footer: string | null = null;
	if (data?.kind === "search" && data.capped)
	{
		footer = `Only the first ${data.results.length} results are shown. Keep typing to narrow.`;
	}
	else if (data?.partial === true)
	{
		footer = PARTIAL_FOOTER;
	}

	let emptyMessage: string | null = null;
	if (filesQuery.isError && data === undefined) emptyMessage = "Couldn’t read this folder.";
	else if (data !== undefined && entries.length === 0)
	{
		emptyMessage = isSearch ? "No matching files" : "Folder is empty";
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			{/* Upstream `BD(Bn)` inside a pane: the toolbar-padded filter row. */}
			<div className="flex shrink-0 items-center h-auto min-h-[calc(var(--cds-h-control)+2*var(--cds-toolbar-pad-block,0.5rem))] py-[var(--cds-toolbar-pad-block,0.5rem)] px-sm">
				<Field className="min-w-0 flex-1">
					<TextInput
						ref={inputRef}
						aria-label="Filter files"
						aria-controls={treeId}
						aria-describedby={capNoteShown && contentQuery !== null ? `${hintId} ${capNoteId}` : hintId}
						spellCheck={false}
						autoComplete="off"
						value={query}
						onChange={(event) =>
						{
							changeQuery(event.target.value);
						}}
						onKeyDown={handleInputKeyDown}
						onFocus={(event) =>
						{
							focusedBeforeRef.current =
								event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
						}}
						onBlur={() =>
						{
							focusedBeforeRef.current = null;
						}}
						placeholder={cwd === undefined ? "Filter files…" : "Filter, or ? to search in files"}
						style={
						{
							textOverflow: "ellipsis",
						}}
						slotStart={
							<span className="grid size-4 shrink-0 place-items-center">
								{contentQuery !== null && contentSearch.searching ? (
									<Spinner size="sm" label="Searching files" />
								) : (
									<Icon name="Search" size="sm" />
								)}
							</span>
						}
						clearable
						clearLabel="Clear filter"
						onClear={() =>
						{
							changeQuery("");
						}}
					/>
				</Field>
				<p id={hintId} className="sr-only">
					Results update as you type. Press Down Arrow to go to results, and Up Arrow on the first result to
					return here.
				</p>
				<p role="status" className="sr-only">
					{contentQuery !== null && contentSearch.outcome !== undefined
						? CONTENT_SEARCH_MESSAGES[contentSearch.outcome]
						: null}
				</p>
			</div>
			{contentQuery !== null && cwd !== undefined ? (
				<ContentSearchResults
					query={contentQuery}
					debouncedQuery={parseContentSearchQuery(debouncedQuery) ?? ""}
					cwd={cwd}
					inputRef={inputRef}
					navRef={contentNavRef}
					onOpenFile={onOpenFile}
					onAsk={onAsk}
					onAttachContext={onAttachContext}
					capNoteId={capNoteId}
					onCapNoteShownChange={setCapNoteShown}
					onSearchStateChange={setContentSearch}
				/>
			) : (
				<>
					{goUp !== null && (
						<div className="shrink-0 px-1 pt-1.25">
							<button
								type="button"
								onClick={() =>
								{
									changeQuery(goUp.query);
								}}
								className="flex h-[21.33px] w-full cursor-pointer items-center gap-1 rounded-r5 bg-fill-control px-2 text-pane text-primary hover:bg-fill-ghost-hover"
							>
								<ArrowUp aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
								<span className="truncate">{goUp.label}</span>
							</button>
						</div>
					)}
					<div
						ref={treeRef}
						id={treeId}
						role="tree"
						aria-label="Project files"
						tabIndex={0}
						onKeyDown={handleTreeKeyDown}
						onScroll={(event) =>
						{
							setScrollTop(event.currentTarget.scrollTop);
						}}
						onFocus={(event) =>
						{
							if (event.target === event.currentTarget && entries.length > 0)
							{
								focusRow(Math.max(0, activeIndex));
							}
						}}
						className="min-h-0 flex-1 overflow-y-auto px-1 py-1.25 outline-none [contain:strict]"
					>
						{emptyMessage === null ? (
							<div
								role="none"
								style={
								{
									height: entries.length * ROW_HEIGHT,
									position: "relative",
								}}
							>
								{entries.slice(firstRow, lastRow).map((entry, offset) =>
								{
									const index = firstRow + offset;
									const dirSuffix = isSearch ? parentDir(entry.relPath) : "";
									return (
										<ContextMenu key={entry.relPath} disabled={cwd === undefined}>
											<ContextMenuTrigger
												data-tree-row
												data-row-index={index}
												role="treeitem"
												aria-level={1}
												aria-selected={pinnedRelPaths?.has(entry.relPath) ?? false}
												aria-current={entry.relPath === activeRelPath ? "true" : undefined}
												tabIndex={-1}
												title={symlinkLabel(entry)}
												onFocus={() =>
												{
													setActiveIndex(index);
												}}
												className="absolute left-0 flex h-[19px] w-full items-center rounded-r3 text-pane text-primary outline-none select-none hover:bg-fill-ghost-hover focus-visible:bg-fill-ghost-hover"
												style={
												{
													top: index * ROW_HEIGHT,
													paddingLeft: 8,
												}}
											>
												<Tooltip
													content={entry.name}
													openWhen={nameOverflows}
													className="min-w-0 flex-1"
												>
													<button
														type="button"
														data-tree-primary
														tabIndex={-1}
														onClick={() =>
														{
															activate(
																entry,
																{
																	pin: false,
																},
															);
														}}
														onDoubleClick={() =>
														{
															if (!entry.isDirectory)
																onOpenFile?.(
																	entry.relPath,
																	{
																		pin: true,
																	},
																);
														}}
														className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1 border-0 bg-transparent pr-2 text-left outline-none"
													>
														{entry.isDirectory ? (
															<Folder
																aria-hidden="true"
																className="size-3 shrink-0 self-center text-ink-muted"
															/>
														) : (
															<FileTypeIcon
																fileName={entry.name}
																size="xs"
																className="self-center text-ink-muted"
															/>
														)}
														<span data-tree-name className="truncate text-primary">
															{entry.name}
														</span>
														{dirSuffix !== "" && (
															<span
																data-tree-dir
																className="min-w-0 truncate text-footnote text-ink-muted"
															>
																{dirSuffix}
															</span>
														)}
													</button>
												</Tooltip>
											</ContextMenuTrigger>
											{cwd !== undefined && (
												<MenuContent>
													<TreeRowMenuItems
														path={`${cwd.replace(/\/+$/, "")}/${entry.relPath}`}
														cwd={cwd}
														isDirectory={entry.isDirectory}
														onAttachContext={onAttachContext}
													/>
												</MenuContent>
											)}
										</ContextMenu>
									);
								})}
							</div>
						) : (
							<p className="px-2 py-1.5 text-footnote text-ink-muted select-none">{emptyMessage}</p>
						)}
						{footer !== null && emptyMessage === null && (
							<div
								className="py-1.5 pr-2 text-footnote text-ink-muted select-none"
								style={
								{
									paddingLeft: 8,
								}}
							>
								{footer}
							</div>
						)}
					</div>
				</>
			)}
		</div>
	);
}
