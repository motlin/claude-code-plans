import {keepPreviousData, useQuery} from "@tanstack/react-query";
import {ArrowUp, Folder, Search, X} from "lucide-react";
import {
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
import {useShortcutKeys} from "../../hooks/use-shortcut";
import {useResizableWidth} from "../../hooks/use-resizable-width";
import {type SessionFilesResponse, sessionFilesQueryOptions} from "../../lib/api/session-files";
import type {AttachContextHandler} from "../../lib/context-attach";
import {parseContentSearchQuery} from "../../lib/files-content-search";
import {getFileIcon} from "../file-tree";
import {settingStorageKey, useSettings} from "../settings-provider";
import {ContextMenu, ContextMenuTrigger, MenuContent} from "../ui/menu";
import {Tooltip} from "../ui/tooltip";
import {type ContentMatchOpenOptions, ContentSearchResults} from "./content-search-results";
import {TreeRowMenuItems} from "./file-context-menu";

const FILES_TREE_DEFAULT_WIDTH = 240;
const FILES_TREE_MIN_WIDTH = 160;
const FILES_TREE_MAX_WIDTH = 640;
export const FILES_TREE_WIDTH_STORAGE_KEY = settingStorageKey("filesTreeWidth");

const ROW_HEIGHT = 24;
const OVERSCAN_ROWS = 8;
/** Assumed viewport height until the tree has been measured (and in jsdom, which never lays out). */
const FALLBACK_VIEWPORT_HEIGHT = 480;
const QUERY_DEBOUNCE_MS = 120;
const PARTIAL_FOOTER = "Some entries may not be listed. Keep typing to narrow.";

type WorkspaceEntry = Extract<SessionFilesResponse, {kind: "listing"}>["entries"][number];

export function clampFilesTreeWidth(width: number): number {
	if (!Number.isFinite(width)) return FILES_TREE_DEFAULT_WIDTH;
	return Math.min(FILES_TREE_MAX_WIDTH, Math.max(FILES_TREE_MIN_WIDTH, Math.round(width)));
}

export interface TreeQuery {
	/** The drilled-in folder, relative to the working directory; "" for the root. */
	dir: string;
	/** Fuzzy path query inside `dir`; "" lists `dir`. */
	search: string;
}

/** Splits the filter at its last "/": everything before it is the drilled-in folder. */
export function parseTreeQuery(query: string): TreeQuery {
	const trimmed = query.trim();
	const lastSlash = trimmed.lastIndexOf("/");
	if (lastSlash === -1) return {dir: "", search: trimmed};
	return {
		dir: trimmed.slice(0, lastSlash).replace(/^\/+|\/+$/g, ""),
		search: trimmed.slice(lastSlash + 1),
	};
}

/** The "Go up" button for a drilled-in folder: its label and the filter it restores. */
export function goUpTarget(dir: string): {label: string; query: string} {
	const segments = dir.split("/");
	if (segments.length <= 1) return {label: "Go up to project files", query: ""};
	const parent = segments.slice(0, -1);
	return {label: `Go up to ${parent.at(-1)}`, query: `${parent.join("/")}/`};
}

function parentDir(relPath: string): string {
	const lastSlash = relPath.lastIndexOf("/");
	return lastSlash === -1 ? "" : relPath.slice(0, lastSlash);
}

function symlinkLabel(entry: WorkspaceEntry): string | undefined {
	const {symlink} = entry;
	if (symlink === undefined) return undefined;
	if (symlink.broken) return `Broken link to ${symlink.target}`;
	if (symlink.outside) return `Link to ${symlink.target}, outside the working directory`;
	return `Link to ${symlink.target}`;
}

/**
 * The Files pane's tree column shell: 240px wide, resizable 160–640 with a
 * "Resize file tree" separator, and the width persisted across reloads. A
 * click on the separator without a drag hides the tree, like upstream.
 */
export function FilesTreeColumn({children, onHide}: {children: ReactNode; onHide?: () => void}) {
	const {settings, setSetting} = useSettings();
	const hideKeys = useShortcutKeys("toggle_changes_file_list");
	const width = clampFilesTreeWidth(settings.filesTreeWidth);
	const resizeHandleProps = useResizableWidth({
		label: "Resize file tree",
		min: FILES_TREE_MIN_WIDTH,
		max: FILES_TREE_MAX_WIDTH,
		step: 8,
		edge: "end",
		value: width,
		onChange: (next) => setSetting("filesTreeWidth", next),
		...(onHide === undefined ? {} : {onClick: onHide}),
	});
	return (
		<div
			data-files-tree
			className="relative flex min-h-0 shrink-0 flex-col border-r border-border"
			style={{
				width,
				minWidth: `min(${FILES_TREE_MIN_WIDTH}px, 100% - 160px)`,
				maxWidth: `min(${FILES_TREE_MAX_WIDTH}px, 100% - 160px)`,
			}}
		>
			{children}
			<Tooltip
				content="Hide file tree"
				shortcut={hideKeys.keys}
				description="Drag to resize"
				side="right"
				className="absolute! inset-y-0 -right-1.5 z-10 w-3"
			>
				<div
					{...resizeHandleProps}
					className="group/resize flex size-full cursor-col-resize touch-none justify-center outline-none"
				>
					<div className="h-full max-h-12 w-[3px] self-center rounded-full bg-ink-muted opacity-0 transition-opacity delay-200 group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100" />
				</div>
			</Tooltip>
		</div>
	);
}

/** Double-click pins the tab; a single click or Enter opens a preview tab. A content match adds its line and query. */
type OpenFileOptions = ContentMatchOpenOptions;

interface FilesTreeProps {
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
}: FilesTreeProps) {
	const {settings} = useSettings();
	const [localQuery, setLocalQuery] = useState("");
	const query = controlledQuery ?? localQuery;
	const setQuery = onQueryChange ?? setLocalQuery;
	const debouncedQuery = useDebouncedValue(query, QUERY_DEBOUNCE_MS);
	const localInputRef = useRef<HTMLInputElement>(null);
	const inputRef = filterRef ?? localInputRef;
	const treeRef = useRef<HTMLDivElement>(null);
	const treeId = useId();
	const hintId = useId();
	const [activeIndex, setActiveIndex] = useState(-1);
	const [focusRequest, setFocusRequest] = useState(0);
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);
	const focusFirstMatchRef = useRef<(() => boolean) | null>(null);
	// "?" searches file contents under the working directory instead of paths.
	const contentQuery = cwd === undefined ? null : parseContentSearchQuery(query);

	// A drill-in or "Go up" changes only the folder, so it skips the typing debounce.
	const requested = parseTreeQuery(parseTreeQuery(query).search === "" ? query : debouncedQuery);
	const displayedDir = parseTreeQuery(query).dir;
	const filesQuery = useQuery({
		...sessionFilesQueryOptions(sessionId, {
			dir: requested.dir,
			query: requested.search,
			hideIgnored: settings.filesHideIgnored,
		}),
		placeholderData: keepPreviousData,
		enabled: contentQuery === null,
	});
	const data = filesQuery.data;
	const entries: readonly WorkspaceEntry[] =
		data === undefined || data.kind === "no-cwd" ? [] : data.kind === "listing" ? data.entries : data.results;

	useEffect(() => {
		const tree = treeRef.current;
		if (tree === null || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			if (tree.clientHeight > 0) setViewportHeight(tree.clientHeight);
		});
		observer.observe(tree);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		setActiveIndex(-1);
		setScrollTop(0);
		if (treeRef.current !== null) treeRef.current.scrollTop = 0;
	}, [data]);

	useLayoutEffect(() => {
		if (focusRequest === 0 || activeIndex < 0) return;
		const tree = treeRef.current;
		if (tree === null) return;
		const rowTop = activeIndex * ROW_HEIGHT;
		if (rowTop < tree.scrollTop) tree.scrollTop = rowTop;
		else if (rowTop + ROW_HEIGHT > tree.scrollTop + viewportHeight) {
			tree.scrollTop = rowTop + ROW_HEIGHT - viewportHeight;
		}
		setScrollTop(tree.scrollTop);
		tree.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`)?.focus();
	}, [activeIndex, focusRequest, viewportHeight]);

	function focusRow(index: number): void {
		setActiveIndex(index);
		setFocusRequest((request) => request + 1);
	}

	function changeQuery(next: string): void {
		setQuery(next);
		setActiveIndex(-1);
	}

	function activate(entry: WorkspaceEntry, options: OpenFileOptions): void {
		if (entry.isDirectory) {
			changeQuery(`${entry.relPath}/`);
			return;
		}
		onOpenFile?.(entry.relPath, options);
	}

	function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		if (event.key === "ArrowDown" && contentQuery !== null) {
			if (focusFirstMatchRef.current?.() === true) event.preventDefault();
		} else if (event.key === "ArrowDown" && entries.length > 0) {
			event.preventDefault();
			focusRow(0);
		} else if (event.key === "Escape" && query !== "") {
			event.preventDefault();
			changeQuery("");
		}
	}

	function handleTreeKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
		if (entries.length === 0) return;
		const index = activeIndex;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			focusRow(Math.min(entries.length - 1, index + 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			if (index <= 0) {
				setActiveIndex(-1);
				inputRef.current?.focus();
			} else {
				focusRow(index - 1);
			}
		} else if (event.key === "Home") {
			event.preventDefault();
			focusRow(0);
		} else if (event.key === "End") {
			event.preventDefault();
			focusRow(entries.length - 1);
		} else if (event.key === "Enter") {
			const entry = entries[index];
			if (entry === undefined) return;
			event.preventDefault();
			activate(entry, {pin: false});
			if (entry.isDirectory) inputRef.current?.focus();
		}
	}

	if (data?.kind === "no-cwd") {
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
	if (data?.kind === "search" && data.capped) {
		footer = `Only the first ${data.results.length} results are shown. Keep typing to narrow.`;
	} else if (data !== undefined && data.partial) {
		footer = PARTIAL_FOOTER;
	}

	let emptyMessage: string | null = null;
	if (filesQuery.isError && data === undefined) emptyMessage = "Couldn’t read this folder.";
	else if (data !== undefined && entries.length === 0) {
		emptyMessage = isSearch ? "No matching files" : "Folder is empty";
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-8 shrink-0 items-center px-2">
				<label className="relative flex h-6 w-full items-center">
					<Search
						className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-t6"
						aria-hidden="true"
					/>
					<input
						ref={inputRef}
						type="text"
						aria-label="Filter files"
						aria-controls={treeId}
						aria-describedby={hintId}
						spellCheck={false}
						autoComplete="off"
						value={query}
						onChange={(event) => changeQuery(event.target.value)}
						onKeyDown={handleInputKeyDown}
						placeholder={cwd === undefined ? "Search files…" : "Filter files… (? for contents)"}
						className="h-6 w-full rounded-md border border-strong bg-surface-1 pl-7 pr-6 text-xs text-primary outline-none placeholder:text-t6 focus:border-accent-100/60"
						style={{textOverflow: "ellipsis"}}
					/>
					{query !== "" && (
						<button
							type="button"
							aria-label="Clear filter"
							onClick={() => {
								changeQuery("");
								inputRef.current?.focus();
							}}
							className="absolute right-1 flex size-4 cursor-pointer items-center justify-center rounded-r5 text-t6 hover:text-primary"
						>
							<X aria-hidden="true" className="size-3" />
						</button>
					)}
				</label>
				<p id={hintId} className="sr-only">
					Results update as you type. Press Down Arrow to go to results, and Up Arrow on the first result to
					return here.
				</p>
			</div>
			{contentQuery !== null && cwd !== undefined ? (
				<ContentSearchResults
					query={contentQuery}
					cwd={cwd}
					inputRef={inputRef}
					focusFirstRef={focusFirstMatchRef}
					onOpenFile={onOpenFile}
					onAsk={onAsk}
				/>
			) : (
				<>
					{goUp !== null && (
						<div className="shrink-0 px-2">
							<button
								type="button"
								onClick={() => changeQuery(goUp.query)}
								className="flex h-6 max-w-full cursor-pointer items-center gap-1 rounded-r5 px-1.5 text-body text-secondary hover:bg-fill-ghost-hover hover:text-primary"
							>
								<ArrowUp aria-hidden="true" className="size-3.5 shrink-0" />
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
						onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
						onFocus={(event) => {
							if (event.target === event.currentTarget && entries.length > 0) {
								focusRow(Math.max(0, activeIndex));
							}
						}}
						className="min-h-0 flex-1 overflow-y-auto px-1 py-1.25 outline-none [contain:strict]"
					>
						{emptyMessage !== null ? (
							<p className="px-2 py-1.5 text-footnote text-ink-muted select-none">{emptyMessage}</p>
						) : (
							<div role="none" style={{height: entries.length * ROW_HEIGHT, position: "relative"}}>
								{entries.slice(firstRow, lastRow).map((entry, offset) => {
									const index = firstRow + offset;
									const Icon = entry.isDirectory ? Folder : getFileIcon(entry.name);
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
												onFocus={() => setActiveIndex(index)}
												className="absolute left-0 flex h-6 w-full items-center rounded-r5 text-body text-primary outline-none select-none hover:bg-fill-ghost-hover focus-visible:bg-fill-ghost-hover"
												style={{top: index * ROW_HEIGHT, paddingLeft: 8}}
											>
												<button
													type="button"
													data-tree-primary
													tabIndex={-1}
													onClick={() => activate(entry, {pin: false})}
													onDoubleClick={() => {
														if (!entry.isDirectory)
															onOpenFile?.(entry.relPath, {pin: true});
													}}
													className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1 border-0 bg-transparent pr-2 text-left outline-none"
												>
													<Icon
														aria-hidden="true"
														className="size-3 shrink-0 self-center text-ink-muted"
													/>
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
						)}
						{footer !== null && emptyMessage === null && (
							<div
								className="py-1.5 pr-2 text-footnote text-ink-muted select-none"
								style={{paddingLeft: 8}}
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
